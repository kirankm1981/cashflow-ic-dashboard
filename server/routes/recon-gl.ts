import type { Express } from "express";
import { storage } from "../storage";
import { icReconGlFiles, icReconGlRawRows, icMatrixMappingGl, icMatrixMappingCompany, icRptAuditEntries } from "@shared/schema";
import type { InsertTransaction, InsertSummarizedLine } from "@shared/schema";
import { eq, sql, asc, inArray } from "drizzle-orm";
import { normalizeText } from "../utils/normalize";
import { requireWriteAccess } from "../middleware/auth";

import { upload, cleanupFile, logUpload } from "../utils/upload-config";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";
import { extractChequeNo } from "../utils/extract-cheque";
import * as XLSX from "xlsx";

function yieldLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

async function buildRptTxnTypeOrder(): Promise<Map<string, number>> {
  const { db } = await import("../db");
  const { icMatrixMappingGl } = await import("@shared/schema");
  const glMappings = await db.select({
    icTxnType: icMatrixMappingGl.icTxnType,
    rptTxnType: icMatrixMappingGl.rptTxnType,
  }).from(icMatrixMappingGl);

  const icTxnOrder = new Map<string, number>();
  const rptByIcTxn = new Map<string, Set<string>>();
  for (const g of glMappings) {
    const ic = (g.icTxnType || "").trim();
    const rpt = (g.rptTxnType || "").trim();
    if (!ic || !rpt) continue;
    if (!icTxnOrder.has(ic)) icTxnOrder.set(ic, icTxnOrder.size);
    if (!rptByIcTxn.has(ic)) rptByIcTxn.set(ic, new Set());
    rptByIcTxn.get(ic)!.add(rpt);
  }

  const rptOrder = new Map<string, number>();
  let idx = 0;
  const sortedIcTypes = Array.from(icTxnOrder.entries()).sort((a, b) => a[1] - b[1]);
  for (const [ic] of sortedIcTypes) {
    const rptTypes = Array.from(rptByIcTxn.get(ic) || []).sort();
    for (const rpt of rptTypes) {
      if (!rptOrder.has(rpt)) rptOrder.set(rpt, idx++);
    }
  }
  return rptOrder;
}

function sortByRptOrder(cols: string[], rptOrder: Map<string, number>): string[] {
  return [...cols].sort((a, b) => {
    const oa = rptOrder.get(a) ?? 9999;
    const ob = rptOrder.get(b) ?? 9999;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  });
}

function parseMultiParam(v: any): string[] {
  const s = String(v || "").trim();
  return s ? s.split(",").map(x => x.trim()).filter(Boolean) : [];
}

function buildIcRptCondition(icTypeFilter: string, colRef: any): ReturnType<typeof sql> {
  const types = parseMultiParam(icTypeFilter);
  if (types.length === 1 && types[0].toUpperCase() === "IC") return sql`${colRef} LIKE 'IC\_%' ESCAPE '\\'`;
  if (types.length === 1 && types[0].toUpperCase() === "RPT") return sql`${colRef} LIKE 'RPT\_%' ESCAPE '\\'`;
  return sql`(${colRef} LIKE 'IC\_%' ESCAPE '\\' OR ${colRef} LIKE 'RPT\_%' ESCAPE '\\')`;
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(String(v).replace(/,/g, ""));
  return isNaN(n) ? 0 : n;
}

function excelSerialToDate(serial: number): Date {
  const utcDays = Math.floor(serial) - 25569;
  const utcMs = utcDays * 86400000;
  const fractionalDay = serial - Math.floor(serial);
  const timeMs = Math.round(fractionalDay * 86400000);
  return new Date(utcMs + timeMs);
}

function formatDateValue(dt: Date, utc = true): string {
  const dd = String(utc ? dt.getUTCDate() : dt.getDate()).padStart(2, "0");
  const mm = String((utc ? dt.getUTCMonth() : dt.getMonth()) + 1).padStart(2, "0");
  const yyyy = utc ? dt.getUTCFullYear() : dt.getFullYear();
  const hh = utc ? dt.getUTCHours() : dt.getHours();
  const min = utc ? dt.getUTCMinutes() : dt.getMinutes();
  const ss = utc ? dt.getUTCSeconds() : dt.getSeconds();
  if (hh > 0 || min > 0 || ss > 0) {
    return `${dd}-${mm}-${yyyy} ${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
  }
  return `${dd}-${mm}-${yyyy}`;
}


function findHeaderIdx(headers: string[], patterns: RegExp[]): number {
  for (const p of patterns) {
    const idx = headers.findIndex((h: string) => p.test(h));
    if (idx >= 0) return idx;
  }
  return -1;
}

function cellToString(val: any): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "string" || typeof val === "number" || typeof val === "boolean") return String(val);
  if (typeof val === "object") {
    if (val.result !== undefined) return String(val.result);
    if (val.text !== undefined) return String(val.text);
    if (val.richText && Array.isArray(val.richText)) return val.richText.map((r: any) => r.text || "").join("");
    if (val instanceof Date) return val.toISOString();
  }
  return String(val);
}

function extractMetadataFromRows(preHeaderRows: any[][], headerRowIdx: number, originalFilename: string) {
  let enterpriseName: string | null = null;
  let reportPeriod: string | null = null;

  for (let i = 0; i < headerRowIdx; i++) {
    const row = preHeaderRows[i];
    for (let j = 0; j < row.length; j++) {
      const cellVal = cellToString(row[j]).trim();
      if (!cellVal) continue;
      const periodMatch = cellVal.match(/(?:period|from)\s*[:\-]?\s*(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/i)
        || cellVal.match(/(\d{1,2}[\-\/\.]\w{3,9}[\-\/\.]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[\-\/\.]\w{3,9}[\-\/\.]\d{2,4})/i)
        || cellVal.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-]\d{2,4})\s*(?:to|-)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-]\d{2,4})/i)
        || cellVal.match(/(?:FY|Year|AY)\s*[:\-]?\s*(\d{4}[\-\/]\d{2,4})/i);
      if (periodMatch && !reportPeriod) reportPeriod = cellVal;
      if (!enterpriseName && i === 0 && !periodMatch && cellVal.length > 2 && !/^(ledger|abstract|report|trial|balance|period|date)/i.test(cellVal)) {
        enterpriseName = cellVal;
      }
    }
  }

  if (!enterpriseName && preHeaderRows.length > 0) {
    for (const cell of preHeaderRows[0]) {
      const v = cellToString(cell).trim();
      if (v && v.length > 2 && !/^(ledger|abstract|report|trial|balance|period|date|from|to)/i.test(v)) {
        enterpriseName = v;
        break;
      }
    }
  }

  if (!reportPeriod) {
    const fnPeriod = originalFilename.match(/\(([A-Za-z]{3,9}\s*'?\d{2,4}\s+to\s+[A-Za-z]{3,9}\s*'?\d{2,4})\)/i)
      || originalFilename.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4}\s*(?:to|-)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4})/i)
      || originalFilename.match(/((?:Q[1-4]|FY|H[12])\s*'?\d{2,4}(?:\s*[-\/]\s*\d{2,4})?)/i);
    if (fnPeriod) reportPeriod = fnPeriod[1].trim();
  }

  if (!enterpriseName) {
    const fnEnterprise = originalFilename.match(/\d+\s*(?:AM|PM)\s+([\w\s]+?)(?:\s*\()/i);
    if (fnEnterprise) enterpriseName = fnEnterprise[1].trim();
  }

  return { enterpriseName, reportPeriod };
}

function parseGlWithChildProcess(filePath: string, db: any, fileId: number): Promise<{ tmpFile: string; rowCount: number }> {
  return new Promise((resolve, reject) => {
    let scriptDir: string;
    try {
      scriptDir = path.dirname(fileURLToPath(import.meta.url));
    } catch {
      scriptDir = path.resolve("server", "routes");
    }
    const scriptPath = path.resolve(scriptDir, "..", "parse-gl-child.cjs");
    const actualScript = fs.existsSync(scriptPath) ? scriptPath : path.resolve("server", "parse-gl-child.cjs");
    
    console.log(`[recon-gl] Forking child process: ${actualScript}`);
    const heapMB = process.env.CHILD_HEAP_MB || "2048";
    const child = fork(actualScript, [filePath], {
      execArgv: [`--max-old-space-size=${heapMB}`],
      stdio: ["pipe", "pipe", "pipe", "ipc"],
    });

    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        child.kill("SIGKILL");
        reject(new Error("GL parsing child process timed out (20 min)"));
      }
    }, 1200000);

    child.on("message", async (msg: any) => {
      if (msg.type === "status") {
        console.log(`[recon-gl] Child: ${msg.message}`);
        try {
          await db.update(icReconGlFiles)
            .set({ statusMessage: msg.message })
            .where(eq(icReconGlFiles.id, fileId));
        } catch {}
      } else if (msg.type === "done") {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          resolve({ tmpFile: msg.tmpFile, rowCount: msg.rowCount });
        }
      } else if (msg.type === "error") {
        clearTimeout(timer);
        if (!settled) {
          settled = true;
          reject(new Error(msg.error));
        }
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      console.error(`[recon-gl] Child stderr: ${data.toString().trim()}`);
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Child process error: ${err.message}`));
      }
    });

    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      if (!settled) {
        settled = true;
        reject(new Error(`Child process exited with code ${code}, signal ${signal} (possible OOM)`));
      }
    });
  });
}

async function streamParseWithSheetJS(
  filePath: string,
  db: any,
  batchId: string,
  fileId: number,
  originalFilename: string,
  startTime: number,
): Promise<{ inserted: number; totalTransactionRows: number; uniqueDocNos: Set<string>; preHeaderRows: any[][]; headerRowIdx: number }> {
  await db.update(icReconGlFiles)
    .set({ statusMessage: "Reading file (this may take 30-60 seconds for large files)..." })
    .where(eq(icReconGlFiles.id, fileId));

  const childResult = await parseGlWithChildProcess(filePath, db, fileId);
  const { tmpFile, rowCount } = childResult;
  console.log(`[recon-gl] BG: Child process wrote ${rowCount} rows to temp file`);

  await db.update(icReconGlFiles)
    .set({ statusMessage: `Parsed ${rowCount} rows, loading into memory...` })
    .where(eq(icReconGlFiles.id, fileId));

  // Stream-parse the JSON file in chunks instead of loading it all at once.
  // For files under 30MB on disk we still use the simple approach; for larger
  // temp files we use a line-by-line JSON array parser to keep memory bounded.
  const tmpStat = fs.statSync(tmpFile);
  const tmpSizeMB = tmpStat.size / (1024 * 1024);
  let allRows: any[][];

  if (tmpSizeMB < 80) {
    // Small-to-medium: safe to load in one shot
    const rawJson = fs.readFileSync(tmpFile, "utf-8");
    allRows = JSON.parse(rawJson);
  } else {
    // Large file: read in chunks to avoid holding raw string + parsed array simultaneously
    console.log(`[recon-gl] BG: Temp JSON is ${tmpSizeMB.toFixed(0)}MB — using chunked reader`);
    allRows = [];
    const CHUNK_SIZE = 64 * 1024; // 64KB read chunks
    const fd = fs.openSync(tmpFile, "r");
    const buf = Buffer.alloc(CHUNK_SIZE);
    let remainder = "";
    let depth = 0;
    let current = "";
    let bytesRead: number;
    let pos = 0;

    while ((bytesRead = fs.readSync(fd, buf, 0, CHUNK_SIZE, pos)) > 0) {
      const text = remainder + buf.toString("utf-8", 0, bytesRead);
      remainder = "";
      for (let ci = 0; ci < text.length; ci++) {
        const ch = text[ci];
        if (depth === 0) {
          if (ch === "[") { depth = 1; continue; }
          if (ch === "]") break;
          continue;
        }
        if (depth === 1) {
          if (ch === "[") { depth = 2; current = "["; continue; }
          if (ch === "]") break; // end of outer array
          continue; // skip commas/whitespace between rows
        }
        // depth >= 2: inside a row array
        current += ch;
        if (ch === "[") depth++;
        else if (ch === "]") {
          depth--;
          if (depth === 1) {
            try { allRows.push(JSON.parse(current)); } catch {}
            current = "";
          }
        }
      }
      pos += bytesRead;
    }
    fs.closeSync(fd);
  }
  try { fs.unlinkSync(tmpFile); } catch {}

  const parseTime = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`[recon-gl] BG: SheetJS parsed ${allRows.length} rows in ${parseTime}s`);

  let headerRowIdx = -1;
  for (let i = 0; i < Math.min(10, allRows.length); i++) {
    const firstCell = cellToString(allRows[i][0]).trim().toLowerCase();
    if (firstCell === "type" || firstCell === "sl no" || firstCell === "sr no") {
      headerRowIdx = i;
      break;
    }
  }
  if (headerRowIdx === -1) {
    throw new Error("Could not detect header row. Expected a row with 'Type' in the first column within the first 10 rows.");
  }

  const preHeaderRows = allRows.slice(0, headerRowIdx);
  const headers = allRows[headerRowIdx].map((h: any) => cellToString(h).trim());

  const typeIdx    = findHeaderIdx(headers, [/^type$/i]);
  const companyIdx = findHeaderIdx(headers, [/^company$/i, /^company\s*name$/i, /^entity$/i]);
  const debitIdx   = findHeaderIdx(headers, [/^debit$/i, /^dr$/i, /^debit\s*amount$/i]);
  const creditIdx  = findHeaderIdx(headers, [/^credit$/i, /^cr$/i, /^credit\s*amount$/i]);
  const docNoIdx   = findHeaderIdx(headers, [/^document\s*no$/i, /^doc\s*no$/i, /^voucher\s*no$/i]);

  const missing: string[] = [];
  if (companyIdx < 0) missing.push("Company");
  if (debitIdx < 0)   missing.push("Debit");
  if (creditIdx < 0)  missing.push("Credit");
  if (typeIdx < 0)    missing.push("Type");
  if (missing.length > 0) throw new Error(`Missing required columns: ${missing.join(", ")}`);

  const dateColIndices = new Set<number>();
  const dateColPatterns = [/created\s*on/i, /last\s*modified\s*on/i, /doc\s*date/i, /cheque\s*date/i, /brs\s*date/i];
  for (let ci = 0; ci < headers.length; ci++) {
    for (const p of dateColPatterns) {
      if (p.test(headers[ci])) { dateColIndices.add(ci); break; }
    }
  }

  const dataRows = allRows.slice(headerRowIdx + 1).filter(
    (r: any[]) => !r.every((c: any) => String(c ?? "").trim() === "")
  );
  const transactionRows = dataRows.filter(
    (r: any[]) => cellToString(r[typeIdx]).trim().toUpperCase() === "TRANSACTION"
  );

  if (transactionRows.length === 0) throw new Error("No TRANSACTION rows found in the file.");

  await db.update(icReconGlFiles)
    .set({ status: "inserting", statusMessage: `Inserting ${transactionRows.length} rows...` })
    .where(eq(icReconGlFiles.id, fileId));

  const BATCH_SIZE = 5000;
  let inserted = 0;
  const uniqueDocNos = new Set<string>();

  for (let i = 0; i < transactionRows.length; i += BATCH_SIZE) {
    const chunk = transactionRows.slice(i, i + BATCH_SIZE);
    const rowInserts = chunk.map((r: any[]) => {
      const raw: Record<string, any> = {};
      for (let ci = 0; ci < headers.length; ci++) {
        const hdr = headers[ci];
        if (!hdr) continue;
        const val = r[ci];
        if (val === null || val === undefined || val === "") {
          raw[hdr] = "";
        } else if (dateColIndices.has(ci) && typeof val === "number" && val > 25000 && val < 100000) {
          raw[hdr] = formatDateValue(excelSerialToDate(val), true);
        } else if (val instanceof Date) {
          raw[hdr] = formatDateValue(val, false);
        } else {
          raw[hdr] = cellToString(val);
        }
      }
      const company   = cellToString(r[companyIdx]).trim();
      const netAmount = parseNum(r[debitIdx]) - parseNum(r[creditIdx]);
      raw["Net Amount"] = netAmount;
      if (docNoIdx >= 0) {
        const dn = cellToString(r[docNoIdx]).trim();
        if (dn) uniqueDocNos.add(dn);
      }
      return { batchId, rowData: raw, company, netAmount };
    });

    await db.insert(icReconGlRawRows).values(rowInserts);
    inserted += rowInserts.length;

    if (inserted % 20000 < BATCH_SIZE) {
      console.log(`[recon-gl] BG: Inserted ${inserted} / ${transactionRows.length} rows...`);
      await db.update(icReconGlFiles)
        .set({ statusMessage: `Inserting rows... ${inserted} / ${transactionRows.length}` })
        .where(eq(icReconGlFiles.id, fileId));
      await yieldLoop();
    }
  }

  return { inserted, totalTransactionRows: transactionRows.length, uniqueDocNos, preHeaderRows, headerRowIdx };
}

async function processUploadInBackground(filePath: string, originalFilename: string, label: string, batchId: string, fileId: number) {
  try {
    const { db } = await import("../db");
    const startTime = Date.now();
    console.log(`[recon-gl] BG: Processing started: ${originalFilename}`);
    await db.update(icReconGlFiles).set({ status: "parsing", statusMessage: "Parsing file..." }).where(eq(icReconGlFiles.id, fileId));

    const result = await streamParseWithSheetJS(filePath, db, batchId, fileId, originalFilename, startTime);
    console.log(`[recon-gl] BG: SheetJS parse + insert succeeded`);

    cleanupFile(filePath);

    const { inserted, totalTransactionRows, uniqueDocNos, preHeaderRows, headerRowIdx } = result;
    const { enterpriseName, reportPeriod } = extractMetadataFromRows(preHeaderRows, headerRowIdx, originalFilename);
    const totalUniqueTransactions = uniqueDocNos.size || totalTransactionRows;

    await db.update(icReconGlFiles)
      .set({
        enterpriseName: enterpriseName || null,
        reportPeriod: reportPeriod || null,
        totalRecords: totalUniqueTransactions,
        status: "uploaded",
        statusMessage: `${inserted} rows stored`,
      })
      .where(eq(icReconGlFiles.id, fileId));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logUpload("RECON-GL", "UPLOAD OK", `${originalFilename} — ${inserted} raw rows, ${totalUniqueTransactions} unique txns in ${elapsed}s`);
  } catch (error: any) {
    logUpload("RECON-GL", "UPLOAD ERROR", `${originalFilename}: ${error.message}`);
    console.error(`[recon-gl] BG: Error processing ${originalFilename}:`, error);
    cleanupFile(filePath);
    try {
      const { db } = await import("../db");
      await db.update(icReconGlFiles).set({ status: "error", statusMessage: error.message || "Processing failed" }).where(eq(icReconGlFiles.id, fileId));
    } catch {}
  }
}

async function processGlInBackground(fileIds: number[]) {
  try {
    const { db } = await import("../db");
    const { transactions, summarizedLines, uploadBatches } = await import("@shared/schema");

    const glMappings = await db.select().from(icMatrixMappingGl);
    const companyMappings = await db.select().from(icMatrixMappingCompany);

    const glMap = new Map<string, typeof glMappings[0]>();
    for (const g of glMappings) {
      glMap.set(normalizeText(g.glName), g);
    }
    const companyMap = new Map<string, string>();
    for (const c of companyMappings) {
      companyMap.set(normalizeText(c.companyNameErp), c.companyCode);
    }

    const unprocessedFiles = await db.select().from(icReconGlFiles).where(eq(icReconGlFiles.processed, false));
    const filesToProcess = unprocessedFiles.filter(f => f.status === "uploaded");

    for (const file of filesToProcess) {
      try {
        console.log(`[recon-gl] BG: Processing file ${file.fileName} (batch ${file.batchId})...`);
        await db.update(icReconGlFiles).set({ status: "processing", statusMessage: "Applying mappings..." }).where(eq(icReconGlFiles.id, file.id));

        const STREAM_BATCH = 2000;
        const UPDATE_BATCH = 500;
        let offset = 0;
        let totalMapped = 0;
        const txns: InsertTransaction[] = [];

        while (true) {
          const rawRows = await db.select()
            .from(icReconGlRawRows)
            .where(eq(icReconGlRawRows.batchId, file.batchId))
            .orderBy(asc(icReconGlRawRows.id))
            .limit(STREAM_BATCH)
            .offset(offset);

          if (rawRows.length === 0) break;

          const pendingUpdates: { id: number; rowData: any }[] = [];

          for (const raw of rawRows) {
            const rowData = typeof raw.rowData === "string" ? JSON.parse(raw.rowData) : raw.rowData as Record<string, any>;
            const company = rowData["Company"] || raw.company || "";
            const accountHead = rowData["Account Head"] || "";
            const subAccountHead = rowData["Sub Account Head"] || "";
            const debit = Number(rowData["Debit"] || 0);
            const credit = Number(rowData["Credit"] || 0);
            const netAmount = Number(rowData["Net Amount"] ?? (debit - credit));
            const documentNo = rowData["Document No"] || rowData["Doc No"] || rowData["Voucher No"] || null;
            const docDate = rowData["Doc Date"] || rowData["Document Date"] || rowData["Date"] || null;
            const narration = rowData["Narration"] || rowData["Description"] || rowData["Remarks"] || rowData["Particulars"] || null;
            const buRaw = rowData["Business Unit"] || null;

            const isInterCompanyAcct = /^INTER\s*COMPANY/i.test(accountHead);
            let glMatch = !isInterCompanyAcct && subAccountHead ? glMap.get(normalizeText(subAccountHead)) : undefined;
            if (!glMatch && !isInterCompanyAcct) {
              glMatch = accountHead ? glMap.get(normalizeText(accountHead)) : undefined;
            }
            let icRptGlName = glMatch ? glMatch.newCoaGlName : accountHead;
            let icCounterParty = glMatch ? glMatch.icCounterParty : null;
            let icCounterPartyCode = glMatch ? glMatch.icCounterPartyCode : null;
            const companyCode = companyMap.get(normalizeText(company)) || null;
            let icTxnType = glMatch ? glMatch.icTxnType : null;

            if (isInterCompanyAcct && subAccountHead) {
              const cpCode = companyMap.get(normalizeText(subAccountHead)) || null;
              if (cpCode && cpCode !== companyCode) {
                icRptGlName = "IC_Inter_Company_Account";
                icCounterParty = subAccountHead;
                icCounterPartyCode = cpCode;
                icTxnType = "INTER_COMPANY";
              }
            }

            rowData["Company Code"] = companyCode || "";
            rowData["IC-RPT GL Name"] = icRptGlName || "";
            rowData["IC Counter Party"] = icCounterParty || "";
            rowData["IC Counter Party Code"] = icCounterPartyCode || "";
            rowData["IC Txn Type"] = icTxnType || "";
            rowData["RPT Group"] = glMatch ? (glMatch.rptGroup || "") : "";
            rowData["C/NC"] = glMatch?.currentNonCurrent || "";
            rowData["FS Group"] = glMatch?.fsGroup || "";
            rowData["FS Heading"] = glMatch?.fsHeading || "";

            pendingUpdates.push({ id: raw.id, rowData });

            if (!icRptGlName || !icRptGlName.startsWith("IC_")) continue;
            if (!companyCode || !icCounterPartyCode) continue;

            txns.push({
              uploadBatchId: file.batchId,
              company: companyCode,
              counterParty: icCounterPartyCode,
              businessUnit: buRaw || null,
              accountHead: accountHead || null,
              subAccountHead: subAccountHead || null,
              debit,
              credit,
              netAmount,
              documentNo: typeof documentNo === "string" ? documentNo.trim() || null : null,
              docDate: typeof docDate === "string" ? docDate.trim() || null : null,
              narration: typeof narration === "string" ? narration.trim() || null : null,
              icGl: icRptGlName,
              rawRowData: JSON.stringify(rowData),
              reconStatus: "unmatched",
              reconId: null,
              reconRule: null,
            });
          }

          for (let ui = 0; ui < pendingUpdates.length; ui += UPDATE_BATCH) {
            const chunk = pendingUpdates.slice(ui, ui + UPDATE_BATCH);
            const updatePromises = chunk.map(u =>
              db.update(icReconGlRawRows).set({ rowData: u.rowData }).where(eq(icReconGlRawRows.id, u.id))
            );
            await Promise.all(updatePromises);
          }

          totalMapped += rawRows.length;
          offset += STREAM_BATCH;

          if (totalMapped % 10000 < STREAM_BATCH) {
            console.log(`[recon-gl] BG: Mapped ${totalMapped} rows...`);
            await db.update(icReconGlFiles)
              .set({ statusMessage: `Mapping rows... ${totalMapped}` })
              .where(eq(icReconGlFiles.id, file.id));
            await yieldLoop();
          }

          if (rawRows.length < STREAM_BATCH) break;
        }

        console.log(`[recon-gl] BG: Mapping complete — ${totalMapped} rows mapped`);

        if (txns.length > 0) {
          await db.update(icReconGlFiles).set({ statusMessage: `Creating ${txns.length} IC transactions...` }).where(eq(icReconGlFiles.id, file.id));

          const inserted = await storage.insertTransactions(txns);

          await storage.insertUploadBatch({
            batchId: file.batchId,
            fileName: file.fileName,
            totalRecords: inserted.length,
          });

          const groupMap = new Map<string, {
            company: string;
            counterParty: string;
            documentNo: string | null;
            docDate: string | null;
            narration: string | null;
            icGl: string | null;
            chequeNo: string | null;
            icTxnType: string | null;
            netAmount: number;
            transactionCount: number;
          }>();

          for (const t of inserted) {
            const rawData = t.rawRowData ? (typeof t.rawRowData === "string" ? JSON.parse(t.rawRowData) : t.rawRowData) : {};
            const txnType = rawData["IC Txn Type"] || null;
            const key = `${(t.company || "").trim().toUpperCase()}||${(t.documentNo || "").trim().toUpperCase()}||${(t.counterParty || "").trim().toUpperCase()}||${(txnType || "").trim().toUpperCase()}`;
            if (!groupMap.has(key)) {
              groupMap.set(key, {
                company: t.company,
                counterParty: t.counterParty,
                documentNo: t.documentNo,
                docDate: t.docDate,
                narration: t.narration,
                icGl: t.icGl || null,
                chequeNo: extractChequeNo(t.rawRowData),
                icTxnType: txnType,
                netAmount: 0,
                transactionCount: 0,
              });
            }
            const group = groupMap.get(key)!;
            group.netAmount += t.netAmount || 0;
            group.transactionCount++;
            if (!group.docDate && t.docDate) group.docDate = t.docDate;
            if (!group.narration && t.narration) group.narration = t.narration;
            if (!group.icGl && t.icGl) group.icGl = t.icGl;
            if (!group.chequeNo) group.chequeNo = extractChequeNo(t.rawRowData);
            if (!group.icTxnType && txnType) group.icTxnType = txnType;
          }

          const summarizedLineEntries: InsertSummarizedLine[] = Array.from(groupMap.values())
            .filter(g => Math.abs(Math.round(g.netAmount * 100) / 100) >= 0.01)
            .map(g => ({
              uploadBatchId: file.batchId,
              company: g.company,
              counterParty: g.counterParty,
              documentNo: g.documentNo,
              docDate: g.docDate,
              narration: g.narration,
              icGl: g.icGl,
              chequeNo: g.chequeNo,
              icTxnType: g.icTxnType,
              netAmount: Math.round(g.netAmount * 100) / 100,
              transactionCount: g.transactionCount,
              reconStatus: "unmatched",
              reconId: null,
              reconRule: null,
            }));

          const insertedLines = await storage.insertSummarizedLines(summarizedLineEntries);

          await db.update(icReconGlFiles)
            .set({ icRecords: inserted.length, processed: true, status: "processed", statusMessage: `${inserted.length} IC records, ${insertedLines.length} summarized lines` })
            .where(eq(icReconGlFiles.id, file.id));

          console.log(`[recon-gl] BG: File ${file.fileName} processed — ${inserted.length} IC records, ${insertedLines.length} summarized lines`);
        } else {
          await db.update(icReconGlFiles)
            .set({ icRecords: 0, processed: true, status: "processed", statusMessage: "No IC transactions found" })
            .where(eq(icReconGlFiles.id, file.id));
          console.log(`[recon-gl] BG: File ${file.fileName} processed — 0 IC records`);
        }
      } catch (fileError: any) {
        console.error(`[recon-gl] BG: Error processing file ${file.fileName}:`, fileError);
        await db.update(icReconGlFiles).set({ status: "error", statusMessage: fileError.message || "Processing failed" }).where(eq(icReconGlFiles.id, file.id));
      }
    }

    console.log(`[recon-gl] BG: GL processing complete for ${filesToProcess.length} files`);
  } catch (error: any) {
    console.error("[recon-gl] BG: GL process error:", error);
  } finally {
    processLock = false;
  }
}

let processLock = false;

export function registerReconGlRoutes(app: Express) {
  app.get("/api/recon/gl-files", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const files = await db.select().from(icReconGlFiles);

      for (const f of files) {
        let changed = false;
        if (!f.reportPeriod) {
          const fnPeriod = (f.fileName || "").match(/\(([A-Za-z]{3,9}\s*'?\d{2,4}\s+to\s+[A-Za-z]{3,9}\s*'?\d{2,4})\)/i)
            || (f.fileName || "").match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4}\s*(?:to|-)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4})/i);
          if (fnPeriod) {
            f.reportPeriod = fnPeriod[1].trim();
            changed = true;
          }
        }
        if (!f.enterpriseName) {
          const fnEnt = (f.fileName || "").match(/\d+\s*(?:AM|PM)\s+([\w\s]+?)(?:\s*\()/i);
          if (fnEnt) {
            f.enterpriseName = fnEnt[1].trim();
            changed = true;
          }
        }
        if (changed) {
          await db.update(icReconGlFiles)
            .set({ enterpriseName: f.enterpriseName, reportPeriod: f.reportPeriod })
            .where(eq(icReconGlFiles.id, f.id));
        }
      }

      res.json(files);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const detail = error.message || String(error);
      const message = isOperational ? detail : `Internal server error: ${detail}`;
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/mapping-status", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const glMappings = await db.select().from(icMatrixMappingGl);
      const companyMappings = await db.select().from(icMatrixMappingCompany);
      res.json({
        hasMapping: glMappings.length > 0 && companyMappings.length > 0,
        glMappings: glMappings.length,
        companyMappings: companyMappings.length,
      });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const detail = error.message || String(error);
      const message = isOperational ? detail : `Internal server error: ${detail}`;
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/recon/upload-gl", requireWriteAccess, upload.single("file"), async (req, res) => {
    req.setTimeout(1200000);
    res.setTimeout(1200000);
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const label = (req.body.label || "GL Dump").trim();
      const batchId = randomUUID();
      const originalFilename = req.file.originalname || "gl_dump.xlsx";
      const filePath = req.file.path;
      const fileSize = req.file.size;

      logUpload("RECON-GL", "UPLOAD START", `File: ${originalFilename} (${(fileSize / 1048576).toFixed(1)} MB), label: ${label}, batch: ${batchId}`);

      const { db } = await import("../db");
      const [fileRecord] = await db.insert(icReconGlFiles).values({
        batchId,
        fileName: originalFilename,
        label,
        enterpriseName: null,
        reportPeriod: null,
        totalRecords: 0,
        icRecords: 0,
        processed: false,
        status: "parsing",
        statusMessage: "File accepted, parsing...",
      }).returning();

      res.json({
        batchId,
        fileId: fileRecord.id,
        fileName: originalFilename,
        label,
        status: "parsing",
        message: "File accepted and processing in background",
      });

      processUploadInBackground(filePath, originalFilename, label, batchId, fileRecord.id).catch(err => {
        console.error("[recon-gl] Background upload processing failed:", err);
      });

    } catch (error: any) {
      if (req.file?.path) cleanupFile(req.file.path);
      logUpload("RECON-GL", "UPLOAD ERROR", `${req.file?.originalname}: ${error.message}`);
      console.error("GL dump upload error:", error);
      res.status(error.status || 500).json({ message: error.message || String(error) });
    }
  });

  app.post("/api/recon/process-gl", requireWriteAccess, async (req, res) => {
    if (processLock) {
      return res.status(409).json({ message: "GL processing is already in progress. Please wait." });
    }

    try {
      const { db } = await import("../db");

      const glMappings = await db.select().from(icMatrixMappingGl);
      const companyMappings = await db.select().from(icMatrixMappingCompany);

      if (glMappings.length === 0 || companyMappings.length === 0) {
        return res.status(400).json({ message: "Both GL Mapping and Company Code mapping must be uploaded in IC Matrix before processing." });
      }

      const unprocessedFiles = await db.select().from(icReconGlFiles).where(eq(icReconGlFiles.processed, false));
      const filesToProcess = unprocessedFiles.filter(f => f.status === "uploaded");
      if (filesToProcess.length === 0) {
        const stillParsing = unprocessedFiles.filter(f => f.status === "parsing" || f.status === "inserting");
        if (stillParsing.length > 0) {
          return res.status(409).json({ message: `${stillParsing.length} file(s) still being uploaded. Please wait for them to finish.` });
        }
        return res.status(400).json({ message: "No unprocessed GL files found. Upload GL dump files first." });
      }

      processLock = true;

      res.json({
        message: `Processing ${filesToProcess.length} file(s) in background`,
        filesQueued: filesToProcess.length,
        status: "processing",
      });

      processGlInBackground(filesToProcess.map(f => f.id)).catch(err => {
        console.error("[recon-gl] Background GL processing failed:", err);
        processLock = false;
      });

    } catch (error: any) {
      processLock = false;
      console.error("GL process error:", error);
      const isOperational = error.status && error.status < 500;
      const detail = error.message || String(error);
      const message = isOperational ? detail : `Internal server error: ${detail}`;
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/recon/gl-file/:id", requireWriteAccess, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      const { db } = await import("../db");
      const { eq } = await import("drizzle-orm");
      const { transactions, summarizedLines, uploadBatches } = await import("@shared/schema");

      const [file] = await db.select().from(icReconGlFiles).where(eq(icReconGlFiles.id, id));
      if (!file) return res.status(404).json({ message: "GL file not found" });

      await db.delete(transactions).where(eq(transactions.uploadBatchId, file.batchId));
      await db.delete(summarizedLines).where(eq(summarizedLines.uploadBatchId, file.batchId));
      await db.delete(uploadBatches).where(eq(uploadBatches.batchId, file.batchId));
      await db.delete(icReconGlRawRows).where(eq(icReconGlRawRows.batchId, file.batchId));
      await db.delete(icReconGlFiles).where(eq(icReconGlFiles.id, id));

      res.json({ deleted: true });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const detail = error.message || String(error);
      const message = isOperational ? detail : `Internal server error: ${detail}`;
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/download-mapped-data", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag, asc: ascOrder } = await import("drizzle-orm");

      const [countResult] = await db.select({ cnt: sqlTag<number>`count(*)` }).from(icReconGlRawRows);
      if (!countResult || countResult.cnt === 0) {
        return res.status(404).json({ message: "No mapped data available for download." });
      }

      const [firstRow] = await db.select({ rowData: icReconGlRawRows.rowData }).from(icReconGlRawRows).limit(1);
      const parsed0 = typeof firstRow.rowData === "string" ? JSON.parse(firstRow.rowData) : firstRow.rowData;
      const headers = Object.keys(parsed0);

      const sheetData: any[][] = [headers];

      const batchSize = 5000;
      let offset = 0;
      while (true) {
        const batch = await db.select({ rowData: icReconGlRawRows.rowData })
          .from(icReconGlRawRows)
          .orderBy(ascOrder(icReconGlRawRows.id))
          .limit(batchSize)
          .offset(offset);
        if (batch.length === 0) break;
        for (const row of batch) {
          const parsed = typeof row.rowData === "string" ? JSON.parse(row.rowData) : row.rowData as Record<string, any>;
          sheetData.push(headers.map(h => parsed[h] !== undefined ? parsed[h] : ""));
        }
        offset += batchSize;
        if (batch.length < batchSize) break;
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      XLSX.utils.book_append_sheet(wb, ws, "Mapped GL Data");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Disposition", "attachment; filename=IC_Recon_Mapped_GL_Data.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buffer);
    } catch (error: any) {
      console.error("Download mapped data error:", error);
      res.status(500).json({ message: "Failed to generate download" });
    }
  });

  app.get("/api/recon/rpt-data", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows, icMatrixMappingGl } = await import("@shared/schema");

      const page = Math.max(1, parseInt(String(req.query.page || "1")) || 1);
      const limit = Math.min(200, Math.max(1, parseInt(String(req.query.limit || "50")) || 50));
      const search = String(req.query.search || "").trim();
      const parseMulti = (v: any) => {
        const s = String(v || "").trim();
        return s ? s.split(",").map(x => x.trim()).filter(Boolean) : [];
      };
      const icTxnTypes = parseMulti(req.query.icTxnType);
      const rptTypes = parseMulti(req.query.rptType);
      const companyFilters = parseMulti(req.query.company);
      const counterPartyFilters = parseMulti(req.query.counterParty);
      const rptTxnTypeDetailedFilters = parseMulti(req.query.rptTxnTypeDetailed);

      const [allIcRows, glMappings] = await Promise.all([
        db.select({ rowData: icReconGlRawRows.rowData })
          .from(icReconGlRawRows)
          .where(sql`(${icReconGlRawRows.rowData}->>'IC Counter Party Code') IS NOT NULL AND (${icReconGlRawRows.rowData}->>'IC Counter Party Code') != ''`),
        db.select({
          newCoaGlName: icMatrixMappingGl.newCoaGlName,
          rptTxnType: icMatrixMappingGl.rptTxnType,
        }).from(icMatrixMappingGl)
          .where(sql`${icMatrixMappingGl.rptTxnType} IS NOT NULL AND ${icMatrixMappingGl.rptTxnType} != ''`),
      ]);

      const glToRptTxnType = new Map<string, string>();
      for (const m of glMappings) {
        if (m.newCoaGlName && m.rptTxnType) {
          glToRptTxnType.set(m.newCoaGlName.trim().toLowerCase(), m.rptTxnType.trim());
        }
      }

      const icTxnTypesSet = new Set<string>();
      const rptTxnTypeDetailedSet = new Set<string>();
      const companiesMap = new Map<string, string>();
      const counterPartiesMap = new Map<string, string>();

      let rows = allIcRows.map(r => {
        const d = typeof r.rowData === "string" ? JSON.parse(r.rowData) : r.rowData as Record<string, any>;
        const icGl = (d["IC-RPT GL Name"] || "").trim();
        const txnType = (d["IC Txn Type"] || "").trim();
        if (txnType) icTxnTypesSet.add(txnType);
        const prefix = icGl.startsWith("RPT_") ? "RPT" : icGl.startsWith("IC_") ? "IC" : "";
        const companyCode = (d["Company Code"] || "").trim();
        const companyName = (d["Company"] || "").trim();
        const cpCode = (d["IC Counter Party Code"] || "").trim();
        const cpName = (d["IC Counter Party"] || "").trim();
        if (companyCode && companyName) companiesMap.set(companyCode, companyName);
        if (cpCode && cpName) counterPartiesMap.set(cpCode, cpName);
        const rptTxnTypeDetailed = glToRptTxnType.get(icGl.toLowerCase()) || "";
        if (rptTxnTypeDetailed) rptTxnTypeDetailedSet.add(rptTxnTypeDetailed);
        return {
          company: companyName,
          companyCode,
          counterPartyCode: cpCode,
          counterPartyName: cpName,
          documentNo: d["Document No"] || "",
          docDate: d["Doc Date"] || "",
          accountHead: d["Account Head"] || "",
          subAccountHead: d["Sub Account Head"] || "",
          icRptGlName: icGl,
          icTxnType: txnType,
          rptTxnTypeDetailed,
          rptType: prefix,
          netAmount: parseNum(d["Debit"]) - parseNum(d["Credit"]),
        };
      }).filter(r => r.rptType);

      if (icTxnTypes.length) {
        const set = new Set(icTxnTypes);
        rows = rows.filter(r => set.has(r.icTxnType));
      }
      if (rptTypes.length) {
        const set = new Set(rptTypes);
        rows = rows.filter(r => set.has(r.rptType));
      }
      if (companyFilters.length) {
        const set = new Set(companyFilters);
        rows = rows.filter(r => set.has(r.companyCode));
      }
      if (counterPartyFilters.length) {
        const set = new Set(counterPartyFilters);
        rows = rows.filter(r => set.has(r.counterPartyCode));
      }
      if (rptTxnTypeDetailedFilters.length) {
        const set = new Set(rptTxnTypeDetailedFilters);
        rows = rows.filter(r => set.has(r.rptTxnTypeDetailed));
      }
      if (search) {
        const s = search.toLowerCase();
        rows = rows.filter(r =>
          r.company.toLowerCase().includes(s) ||
          r.companyCode.toLowerCase().includes(s) ||
          r.counterPartyName.toLowerCase().includes(s) ||
          r.documentNo.toLowerCase().includes(s) ||
          r.icRptGlName.toLowerCase().includes(s) ||
          r.accountHead.toLowerCase().includes(s) ||
          r.subAccountHead.toLowerCase().includes(s) ||
          r.rptTxnTypeDetailed.toLowerCase().includes(s)
        );
      }

      const total = rows.length;
      const totalPages = Math.ceil(total / limit);
      const paginated = rows.slice((page - 1) * limit, page * limit);

      const companies = Array.from(companiesMap.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));
      const counterParties = Array.from(counterPartiesMap.entries()).map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name));

      res.json({
        data: paginated,
        page,
        totalPages,
        total,
        icTxnTypes: Array.from(icTxnTypesSet).sort(),
        rptTxnTypesDetailed: Array.from(rptTxnTypeDetailedSet).sort(),
        companies,
        counterParties,
      });
    } catch (error: any) {
      console.error("RPT data error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-summary", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows, icMatrixMappingGl } = await import("@shared/schema");

      const [allIcRows, glMappings] = await Promise.all([
        db.select({ rowData: icReconGlRawRows.rowData })
          .from(icReconGlRawRows)
          .where(sql`(${icReconGlRawRows.rowData}->>'IC Counter Party Code') IS NOT NULL AND (${icReconGlRawRows.rowData}->>'IC Counter Party Code') != ''`),
        db.select({
          newCoaGlName: icMatrixMappingGl.newCoaGlName,
          rptTxnType: icMatrixMappingGl.rptTxnType,
        }).from(icMatrixMappingGl)
          .where(sql`${icMatrixMappingGl.rptTxnType} IS NOT NULL AND ${icMatrixMappingGl.rptTxnType} != ''`),
      ]);

      const glToRptTxnType = new Map<string, string>();
      for (const m of glMappings) {
        if (m.newCoaGlName && m.rptTxnType) {
          glToRptTxnType.set(m.newCoaGlName.trim().toLowerCase(), m.rptTxnType.trim());
        }
      }

      const groups: Record<string, { company: string; companyName: string; counterParty: string; counterPartyName: string; transactionType: string; rptTxnTypeDetailed: string; rptType: string; amount: number; rowCount: number }> = {};

      for (const r of allIcRows) {
        const d = typeof r.rowData === "string" ? JSON.parse(r.rowData) : r.rowData as Record<string, any>;
        const icGl = (d["IC-RPT GL Name"] || "").trim();
        const prefix = icGl.startsWith("RPT_") ? "RPT" : icGl.startsWith("IC_") ? "IC" : "";
        if (!prefix) continue;

        const companyCode = d["Company Code"] || "";
        const companyName = d["Company"] || companyCode;
        const cpCode = d["IC Counter Party Code"] || "";
        const cpName = d["IC Counter Party"] || cpCode;
        const txnType = d["IC Txn Type"] || "";
        const rptTxnTypeDetailed = glToRptTxnType.get(icGl.toLowerCase()) || "";
        const key = `${companyCode}|${cpCode}|${txnType}|${rptTxnTypeDetailed}|${prefix}`;
        const net = parseNum(d["Debit"]) - parseNum(d["Credit"]);

        if (!groups[key]) {
          groups[key] = {
            company: companyCode,
            companyName: companyName,
            counterParty: cpCode,
            counterPartyName: cpName,
            transactionType: txnType,
            rptTxnTypeDetailed,
            rptType: prefix,
            amount: 0,
            rowCount: 0,
          };
        }
        groups[key].amount += net;
        groups[key].rowCount += 1;
      }

      const data = Object.values(groups).sort((a, b) => a.company.localeCompare(b.company) || a.counterParty.localeCompare(b.counterParty));

      res.json({ data, total: data.length });
    } catch (error: any) {
      console.error("RPT summary error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/download-rpt-data", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");

      const allIcRows = await db.select({ rowData: icReconGlRawRows.rowData })
        .from(icReconGlRawRows)
        .where(sql`(${icReconGlRawRows.rowData}->>'IC Counter Party Code') IS NOT NULL AND (${icReconGlRawRows.rowData}->>'IC Counter Party Code') != ''`);

      const rows = allIcRows.map(r => {
        const d = typeof r.rowData === "string" ? JSON.parse(r.rowData) : r.rowData as Record<string, any>;
        const icGl = (d["IC-RPT GL Name"] || "").trim();
        const prefix = icGl.startsWith("RPT_") ? "RPT" : icGl.startsWith("IC_") ? "IC" : "";
        if (!prefix) return null;
        return {
          "Company": d["Company"] || "",
          "Company Code": d["Company Code"] || "",
          "Document No": d["Document No"] || "",
          "Doc Date": d["Doc Date"] || "",
          "Account Head": d["Account Head"] || "",
          "Sub Account Head": d["Sub Account Head"] || "",
          "IC-RPT GL Name": icGl,
          "IC Txn Type": d["IC Txn Type"] || "",
          "RPT Type": prefix,
          "IC Counter Party Code": d["IC Counter Party Code"] || "",
          "Debit": parseNum(d["Debit"]),
          "Credit": parseNum(d["Credit"]),
          "Net Amount": parseNum(d["Debit"]) - parseNum(d["Credit"]),
          "Narration": d["Narration"] || "",
        };
      }).filter(Boolean);

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows as any[]);
      XLSX.utils.book_append_sheet(wb, ws, "RPT Detail");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Recon_RPT_Data.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      console.error("Download RPT data error:", error);
      res.status(500).json({ message: "Failed to generate download" });
    }
  });

  app.get("/api/recon/download-rpt-summary", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const codeToName: Record<string, string> = {};
      for (const m of companyMappings) {
        if (m.companyCode && m.companyName) codeToName[m.companyCode] = m.companyName;
      }

      const allIcRows = await db.select({ rowData: icReconGlRawRows.rowData })
        .from(icReconGlRawRows)
        .where(sql`(${icReconGlRawRows.rowData}->>'IC Counter Party Code') IS NOT NULL AND (${icReconGlRawRows.rowData}->>'IC Counter Party Code') != ''`);

      const groups: Record<string, { companyCode: string; companyName: string; cpCode: string; cpName: string; txnType: string; rptType: string; amount: number; count: number }> = {};

      for (const r of allIcRows) {
        const d = typeof r.rowData === "string" ? JSON.parse(r.rowData) : r.rowData as Record<string, any>;
        const icGl = (d["IC-RPT GL Name"] || "").trim();
        const prefix = icGl.startsWith("RPT_") ? "RPT" : icGl.startsWith("IC_") ? "IC" : "";
        if (!prefix) continue;
        const cc = d["Company Code"] || "";
        const cp = d["IC Counter Party Code"] || "";
        const txn = d["IC Txn Type"] || "";
        const key = `${cc}|${cp}|${txn}|${prefix}`;
        const net = parseNum(d["Debit"]) - parseNum(d["Credit"]);
        if (!groups[key]) {
          groups[key] = { companyCode: cc, companyName: codeToName[cc] || d["Company"] || cc, cpCode: cp, cpName: codeToName[cp] || "", txnType: txn, rptType: prefix, amount: 0, count: 0 };
        }
        groups[key].amount += net;
        groups[key].count += 1;
      }

      const rows = Object.values(groups).sort((a, b) => a.companyCode.localeCompare(b.companyCode)).map(g => ({
        "Company Code": g.companyCode,
        "Company Name": g.companyName,
        "Counter Party Code": g.cpCode,
        "Counter Party Name": g.cpName,
        "Transaction Type": g.txnType,
        "RPT Type": g.rptType,
        "Net Amount": g.amount,
        "Row Count": g.count,
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "RPT Summary");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Recon_RPT_Summary.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      console.error("Download RPT summary error:", error);
      res.status(500).json({ message: "Failed to generate download" });
    }
  });

  app.get("/api/recon/rpt-audit-entries", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixMappingGl } = await import("@shared/schema");
      const [entries, glMappings] = await Promise.all([
        db.select().from(icRptAuditEntries),
        db.select().from(icMatrixMappingGl),
      ]);

      const glMap = new Map<string, typeof glMappings[0]>();
      for (const g of glMappings) {
        if (g.newCoaGlName) glMap.set(g.newCoaGlName.trim().toLowerCase(), g);
        if (g.glName) glMap.set(g.glName.trim().toLowerCase(), g);
      }

      const allIcTxnTypes = new Set<string>();
      const allRptTxnTypes = new Set<string>();

      const enriched = entries.map(e => {
        const glInfo = glMap.get((e.rptLedger || "").trim().toLowerCase());
        const icTxnTypeVal = e.icTxnType || glInfo?.icTxnType || "";
        const rptTxnTypeVal = e.rptTxnType || glInfo?.rptTxnType || "";
        const ledger = (e.rptLedger || "").trim();
        let icTypeVal = e.icType || "";
        if (!icTypeVal) {
          if (ledger.startsWith("IC_")) icTypeVal = "IC";
          else if (ledger.startsWith("RPT_")) icTypeVal = "RPT";
          else if (glInfo?.newCoaGlName?.startsWith("IC_") || glInfo?.glName?.startsWith("IC_")) icTypeVal = "IC";
          else if (glInfo?.newCoaGlName?.startsWith("RPT_") || glInfo?.glName?.startsWith("RPT_")) icTypeVal = "RPT";
        }
        if (icTxnTypeVal) allIcTxnTypes.add(icTxnTypeVal);
        if (rptTxnTypeVal) allRptTxnTypes.add(rptTxnTypeVal);
        return { ...e, icTxnType: icTxnTypeVal, rptTxnType: rptTxnTypeVal, icType: icTypeVal };
      });

      const icTxnTypeFilter = req.query.icTxnType ? String(req.query.icTxnType).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const icTypeFilter = req.query.icType ? String(req.query.icType).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const rptTxnTypeFilter = req.query.rptTxnType ? String(req.query.rptTxnType).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      const filtered = enriched.filter(e => {
        if (icTxnTypeFilter.length && e.icTxnType && !icTxnTypeFilter.includes(e.icTxnType.toLowerCase())) return false;
        if (icTypeFilter.length && e.icType && !icTypeFilter.includes(e.icType.toLowerCase())) return false;
        if (rptTxnTypeFilter.length && e.rptTxnType && !rptTxnTypeFilter.includes(e.rptTxnType.toLowerCase())) return false;
        return true;
      });

      res.json({
        data: filtered,
        icTxnTypes: Array.from(allIcTxnTypes).sort(),
        rptTxnTypes: Array.from(allRptTxnTypes).sort(),
      });
    } catch (error: any) {
      console.error("Get AE entries error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.post("/api/recon/rpt-audit-entries", requireWriteAccess, async (req, res) => {
    try {
      const { db } = await import("../db");
      const b = req.body;
      if (!b.entityCompanyCode || !b.rptLedger) return res.status(400).json({ message: "Entity Company Code and RPT Ledger are required" });
      const amt = Number(b.amount);
      if (isNaN(amt) || amt === 0) return res.status(400).json({ message: "Amount must be a non-zero number" });
      let username: string | null = null;
      const userId = (req.session as any)?.userId;
      if (userId) {
        const { users } = await import("@shared/schema");
        const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, userId)).limit(1);
        username = u?.username || String(userId);
      }
      const [entry] = await db.insert(icRptAuditEntries).values({
        entityCompanyCode: String(b.entityCompanyCode).trim(),
        entityName: b.entityName || null,
        rptLedger: String(b.rptLedger).trim(),
        rptCounterPartyCode: b.rptCounterPartyCode || null,
        rptCounterPartyName: b.rptCounterPartyName || null,
        amount: amt,
        natureOfBalance: b.natureOfBalance || null,
        narration: b.narration || null,
        icTxnType: b.icTxnType || null,
        rptTxnType: b.rptTxnType || null,
        icType: b.icType || null,
        createdBy: username,
      }).returning();
      res.json(entry);
    } catch (error: any) {
      console.error("Create AE entry error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.put("/api/recon/rpt-audit-entries/:id", requireWriteAccess, async (req, res) => {
    try {
      const { db } = await import("../db");
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      const { entityCompanyCode, entityName, rptLedger, rptCounterPartyCode, rptCounterPartyName, amount, natureOfBalance, narration, icTxnType, rptTxnType, icType } = req.body;
      const [updated] = await db.update(icRptAuditEntries).set({
        entityCompanyCode, entityName, rptLedger, rptCounterPartyCode, rptCounterPartyName: rptCounterPartyName || null, amount: Number(amount), natureOfBalance, narration,
        icTxnType: icTxnType || null, rptTxnType: rptTxnType || null, icType: icType || null,
      }).where(eq(icRptAuditEntries.id, id)).returning();
      if (!updated) return res.status(404).json({ message: "Entry not found" });
      res.json(updated);
    } catch (error: any) {
      console.error("Update AE entry error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.delete("/api/recon/rpt-audit-entries/:id", requireWriteAccess, async (req, res) => {
    try {
      const { db } = await import("../db");
      const id = parseInt(String(req.params.id));
      if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
      await db.delete(icRptAuditEntries).where(eq(icRptAuditEntries.id, id));
      res.json({ success: true });
    } catch (error: any) {
      console.error("Delete AE entry error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.post("/api/recon/rpt-audit-entries-batch-delete", requireWriteAccess, async (req, res) => {
    try {
      const { db } = await import("../db");
      const { inArray } = await import("drizzle-orm");
      const ids: number[] = req.body.ids;
      if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: "No ids provided" });
      await db.delete(icRptAuditEntries).where(inArray(icRptAuditEntries.id, ids));
      res.json({ success: true, deleted: ids.length });
    } catch (error: any) {
      console.error("Batch delete AE entries error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.delete("/api/recon/rpt-audit-entries-clear", requireWriteAccess, async (_req, res) => {
    try {
      const { db } = await import("../db");
      await db.delete(icRptAuditEntries);
      res.json({ success: true });
    } catch (error: any) {
      console.error("Clear AE entries error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-audit-entries/ref-data", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixMappingCompany, icMatrixMappingGl } = await import("@shared/schema");
      const [companies, glMappings] = await Promise.all([
        db.select({ companyCode: icMatrixMappingCompany.companyCode, companyName: icMatrixMappingCompany.companyName, companyNameErp: icMatrixMappingCompany.companyNameErp }).from(icMatrixMappingCompany).orderBy(icMatrixMappingCompany.companyCode),
        db.select({ icTxnType: icMatrixMappingGl.icTxnType, rptTxnType: icMatrixMappingGl.rptTxnType }).from(icMatrixMappingGl),
      ]);
      const entityCodes = companies.map(c => c.companyCode);
      const entityNames = companies.map(c => c.companyNameErp);
      const icTxnTypes = [...new Set(glMappings.map(g => g.icTxnType).filter(Boolean))].sort() as string[];
      const rptTxnTypes = [...new Set(glMappings.map(g => g.rptTxnType).filter(Boolean))].sort() as string[];
      res.json({ entityCodes, entityNames, icTxnTypes, rptTxnTypes, companies });
    } catch (error: any) {
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-audit-entries/template", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixMappingCompany, icMatrixTbData } = await import("@shared/schema");

      const [companyMappings, rptLedgers, rptCpRows] = await Promise.all([
        db.select({ companyCode: icMatrixMappingCompany.companyCode, companyNameErp: icMatrixMappingCompany.companyNameErp }).from(icMatrixMappingCompany).orderBy(icMatrixMappingCompany.companyCode),
        db.selectDistinct({ glName: icMatrixTbData.newCoaGlName }).from(icMatrixTbData).where(sql`(${icMatrixTbData.newCoaGlName} LIKE 'IC\_%' ESCAPE '\\' OR ${icMatrixTbData.newCoaGlName} LIKE 'RPT\_%' ESCAPE '\\')`),
        db.selectDistinct({ code: icMatrixTbData.icCounterPartyCode, name: icMatrixTbData.icCounterParty }).from(icMatrixTbData).where(sql`${icMatrixTbData.icCounterPartyCode} IS NOT NULL AND ${icMatrixTbData.icCounterPartyCode} != ''`),
      ]);

      const wb = XLSX.utils.book_new();

      const uploadHeaders = [
        "Entity Company Code", "Entity Name", "RPT Ledger",
        "RPT Counter Party Code", "RPT Counter Party Name", "Amount", "Nature of Balance", "Narration",
        "IC Txn Type", "RPT Txn Type", "IC/RPT Type",
      ];
      const uploadWs = XLSX.utils.aoa_to_sheet([uploadHeaders]);
      uploadWs["!cols"] = [{ wch: 18 }, { wch: 50 }, { wch: 60 }, { wch: 22 }, { wch: 50 }, { wch: 15 }, { wch: 18 }, { wch: 40 }, { wch: 15 }, { wch: 18 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, uploadWs, "AE Upload");

      const refRows: any[][] = [["Entity Company Code", "Entity Name (ERP)", "RPT Ledgers", "RPT Counter Party Code", "RPT Counter Party Name"]];
      const ledgerList = rptLedgers.map(r => r.glName).filter(Boolean).sort() as string[];
      const cpList = rptCpRows.map(r => ({ code: r.code || "", name: r.name || "" })).sort((a, b) => a.code.localeCompare(b.code));
      const maxRows = Math.max(companyMappings.length, ledgerList.length, cpList.length);
      for (let i = 0; i < maxRows; i++) {
        refRows.push([
          companyMappings[i]?.companyCode || "",
          companyMappings[i]?.companyNameErp || "",
          ledgerList[i] || "",
          cpList[i]?.code || "",
          cpList[i]?.name || "",
        ]);
      }
      const refWs = XLSX.utils.aoa_to_sheet(refRows);
      refWs["!cols"] = [{ wch: 18 }, { wch: 55 }, { wch: 65 }, { wch: 22 }, { wch: 55 }];
      XLSX.utils.book_append_sheet(wb, refWs, "Reference Data");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=AE_Upload_Template.xlsx");
      res.send(buf);
    } catch (error: any) {
      console.error("AE template download error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.post("/api/recon/rpt-audit-entries/upload", requireWriteAccess, upload.single("file"), async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixMappingCompany, icMatrixTbData } = await import("@shared/schema");

      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const fs = await import("fs");
      const fileBuffer = fs.readFileSync(req.file.path);
      const wb = XLSX.read(fileBuffer, { type: "buffer" });
      const sheetName = wb.SheetNames.find(s => s.toLowerCase().includes("upload")) || wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) {
        cleanupFile(req.file.path);
        return res.status(400).json({ message: "No upload sheet found" });
      }

      const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });
      if (rows.length < 2) {
        cleanupFile(req.file.path);
        return res.status(400).json({ message: "No data rows found in the upload sheet" });
      }

      const [companyMappings, rptLedgerRows, rptCpRows] = await Promise.all([
        db.select({ companyCode: icMatrixMappingCompany.companyCode, companyNameErp: icMatrixMappingCompany.companyNameErp }).from(icMatrixMappingCompany),
        db.selectDistinct({ glName: icMatrixTbData.newCoaGlName }).from(icMatrixTbData).where(sql`(${icMatrixTbData.newCoaGlName} LIKE 'IC\_%' ESCAPE '\\' OR ${icMatrixTbData.newCoaGlName} LIKE 'RPT\_%' ESCAPE '\\')`),
        db.selectDistinct({ code: icMatrixTbData.icCounterPartyCode }).from(icMatrixTbData).where(sql`${icMatrixTbData.icCounterPartyCode} IS NOT NULL AND ${icMatrixTbData.icCounterPartyCode} != ''`),
      ]);

      const validCodes = new Set(companyMappings.map(c => c.companyCode.trim().toLowerCase()));
      const codeToName = new Map(companyMappings.map(c => [c.companyCode.trim().toLowerCase(), c.companyNameErp.trim()]));
      const validLedgers = new Set(rptLedgerRows.map(r => (r.glName || "").trim().toLowerCase()));
      const validCpCodes = new Set(rptCpRows.map(r => (r.code || "").trim().toLowerCase()));
      for (const c of companyMappings) validCpCodes.add(c.companyCode.trim().toLowerCase());

      let uploadUsername: string | null = null;
      const uploadUserId = (req.session as any)?.userId;
      if (uploadUserId) {
        const { users } = await import("@shared/schema");
        const [u] = await db.select({ username: users.username }).from(users).where(eq(users.id, uploadUserId)).limit(1);
        uploadUsername = u?.username || String(uploadUserId);
      }

      const errors: string[] = [];
      const validEntries: any[] = [];

      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        if (!row || row.length === 0 || row.every((c: any) => c === null || c === undefined || String(c).trim() === "")) continue;

        const entityCode = String(row[0] || "").trim();
        const entityName = String(row[1] || "").trim();
        const rptLedger = String(row[2] || "").trim();
        const rptCpCode = String(row[3] || "").trim();
        const rptCpName = String(row[4] || "").trim();
        const amount = Number(row[5]);
        const natureOfBalance = String(row[6] || "").trim();
        const narration = String(row[7] || "").trim();
        const uploadIcTxnType = String(row[8] || "").trim();
        const uploadRptTxnType = String(row[9] || "").trim();
        const uploadIcType = String(row[10] || "").trim();

        const rowNum = i + 1;
        const rowErrors: string[] = [];

        if (!entityCode) {
          rowErrors.push("Entity Company Code is required");
        } else if (!validCodes.has(entityCode.toLowerCase())) {
          rowErrors.push(`Entity Company Code '${entityCode}' not found in company mappings`);
        }

        if (entityName) {
          const expectedName = codeToName.get(entityCode.toLowerCase());
          if (expectedName && expectedName.toLowerCase() !== entityName.toLowerCase()) {
            rowErrors.push(`Entity Name '${entityName}' does not match expected '${expectedName}' for code '${entityCode}'`);
          }
        }

        if (!rptLedger) {
          rowErrors.push("RPT Ledger is required");
        } else if (!validLedgers.has(rptLedger.toLowerCase())) {
          rowErrors.push(`RPT Ledger '${rptLedger}' not found in existing ledgers`);
        }

        if (rptCpCode && !validCpCodes.has(rptCpCode.toLowerCase())) {
          rowErrors.push(`RPT Counter Party Code '${rptCpCode}' not found`);
        }

        if (isNaN(amount) || amount === 0) {
          rowErrors.push("Amount must be a non-zero number");
        }

        if (rowErrors.length > 0) {
          errors.push(`Row ${rowNum}: ${rowErrors.join("; ")}`);
        } else {
          const resolvedName = entityName || codeToName.get(entityCode.toLowerCase()) || entityCode;
          validEntries.push({
            entityCompanyCode: entityCode,
            entityName: resolvedName,
            rptLedger,
            rptCounterPartyCode: rptCpCode || null,
            rptCounterPartyName: rptCpName || null,
            amount,
            natureOfBalance: natureOfBalance || (amount > 0 ? "Debit" : "Credit"),
            narration: narration || null,
            icTxnType: uploadIcTxnType || null,
            rptTxnType: uploadRptTxnType || null,
            icType: uploadIcType || null,
            createdBy: uploadUsername,
          });
        }
      }

      if (errors.length > 0) {
        cleanupFile(req.file.path);
        return res.status(400).json({ message: "Validation errors found", errors, validCount: validEntries.length });
      }

      if (validEntries.length === 0) {
        cleanupFile(req.file.path);
        return res.status(400).json({ message: "No valid entries found in the upload" });
      }

      const inserted = await db.insert(icRptAuditEntries).values(validEntries).returning();
      cleanupFile(req.file.path);

      res.json({ success: true, count: inserted.length });
    } catch (error: any) {
      console.error("AE upload error:", error);
      if (req.file) cleanupFile(req.file.path);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  function buildEntityResolver(
    companyMappings: { companyCode: string; companyName: string | null; companyNameErp: string; group: string | null }[],
    entityListRows: { shortName: string; companyNameErp: string | null; group: string | null }[],
    rptCpNames?: Map<string, string>,
  ) {
    const codeToErpName = new Map<string, string>();
    const codeToGroup = new Map<string, string>();
    for (const c of companyMappings) {
      const key = c.companyCode.trim().toLowerCase();
      codeToErpName.set(key, c.companyNameErp.trim());
      if (c.group) codeToGroup.set(key, c.group.trim());
    }

    const erpNameToShort = new Map<string, string>();
    const erpNameToGroup = new Map<string, string>();
    for (const el of entityListRows) {
      if (el.companyNameErp) {
        const nameKey = el.companyNameErp.trim().toLowerCase();
        if (el.shortName) erpNameToShort.set(nameKey, el.shortName.trim());
        if (el.group) erpNameToGroup.set(nameKey, el.group.trim());
      }
    }

    function resolve(code: string): { name: string; short: string; group: string } {
      const key = code.trim().toLowerCase();
      const erpName = codeToErpName.get(key);
      if (erpName) {
        const erpKey = erpName.trim().toLowerCase();
        const short = erpNameToShort.get(erpKey) || code;
        const group = erpNameToGroup.get(erpKey) || codeToGroup.get(key) || "";
        return { name: erpName, short, group };
      }
      if (rptCpNames) {
        const cpName = rptCpNames.get(key);
        if (cpName) {
          const cpKey = cpName.trim().toLowerCase();
          const short = erpNameToShort.get(cpKey) || code;
          const group = erpNameToGroup.get(cpKey) || "Others";
          return { name: cpName, short, group };
        }
      }
      return { name: code, short: code, group: "" };
    }

    function resolveByName(fullName: string): { name: string; short: string; group: string } {
      const nameKey = fullName.trim().toLowerCase();
      const short = erpNameToShort.get(nameKey) || fullName;
      const group = erpNameToGroup.get(nameKey) || "Others";
      return { name: fullName, short, group };
    }

    function resolveName(code: string): string { return resolve(code).name; }
    function resolveShort(code: string): string { return resolve(code).short; }
    function resolveGroup(code: string): string { return resolve(code).group; }

    return { resolve, resolveByName, resolveName, resolveShort, resolveGroup };
  }

  app.get("/api/recon/rpt-report/detailed", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixTbData, icMatrixMappingCompany, icRptAuditEntries, icMatrixMappingGl, icEntityList } = await import("@shared/schema");

      const icTypeFilter = (req.query.icType as string || "").trim().toUpperCase();
      const icTxnTypeFilters = parseMultiParam(req.query.icTxnType);
      const entityFilters = parseMultiParam(req.query.entity);

      const [tbRows, companyMappings, aeEntries, glMappings, entityListRows] = await Promise.all([
        db.select({
          companyCode: icMatrixTbData.companyCode,
          company: icMatrixTbData.company,
          code: icMatrixTbData.code,
          accountHead: icMatrixTbData.accountHead,
          subAccountHead: icMatrixTbData.subAccountHead,
          newCoaGlName: icMatrixTbData.newCoaGlName,
          icCounterParty: icMatrixTbData.icCounterParty,
          icCounterPartyCode: icMatrixTbData.icCounterPartyCode,
          icTxnType: icMatrixTbData.icTxnType,
          rptTxnType: icMatrixTbData.rptTxnType,
          rptGroup: icMatrixTbData.rptGroup,
          openingDebit: icMatrixTbData.openingDebit,
          openingCredit: icMatrixTbData.openingCredit,
          periodDebit: icMatrixTbData.periodDebit,
          periodCredit: icMatrixTbData.periodCredit,
          closingDebit: icMatrixTbData.closingDebit,
          closingCredit: icMatrixTbData.closingCredit,
          netBalance: icMatrixTbData.netBalance,
        })
          .from(icMatrixTbData)
          .where(buildIcRptCondition(icTypeFilter, icMatrixTbData.newCoaGlName)),
        db.select().from(icMatrixMappingCompany),
        db.select().from(icRptAuditEntries),
        db.select({
          newCoaGlName: icMatrixMappingGl.newCoaGlName,
          rptGroup: icMatrixMappingGl.rptGroup,
        }).from(icMatrixMappingGl),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const glRptGroupMap = new Map<string, string>();
      for (const g of glMappings) {
        if (g.newCoaGlName && g.rptGroup) {
          glRptGroupMap.set(g.newCoaGlName.trim(), g.rptGroup.trim());
        }
      }

      const aeMap = new Map<string, number>();
      for (const ae of aeEntries) {
        const key = `${(ae.entityCompanyCode || "").trim().toLowerCase()}||${(ae.rptLedger || "").trim().toLowerCase()}`;
        aeMap.set(key, (aeMap.get(key) || 0) + ae.amount);
      }
      const matchedAeKeys = new Set<string>();

      const rptCpNames = new Map<string, string>();
      const allIcTxnTypes = new Set<string>();
      const allEntityNames = new Set<string>();
      for (const r of tbRows) {
        if (r.icCounterPartyCode && r.icCounterParty) {
          rptCpNames.set(r.icCounterPartyCode.trim().toLowerCase(), r.icCounterParty.trim());
        }
        const txnType = (r.icTxnType || "").trim();
        if (txnType) allIcTxnTypes.add(txnType);
      }
      const resolver = buildEntityResolver(companyMappings, entityListRows, rptCpNames);

      let data = tbRows
        .filter((r) => (r.companyCode || "").trim() !== "" && (r.icCounterPartyCode || "").trim() !== "")
        .map((r) => {
        const entity = resolver.resolve(r.companyCode || "");
        const cpFullName = (r.icCounterParty || "").trim();
        const cpByName = cpFullName ? resolver.resolveByName(cpFullName) : null;
        const cpByCode = resolver.resolve(r.icCounterPartyCode || "");
        const cpName = cpByCode.name !== (r.icCounterPartyCode || "").trim() ? cpByCode.name : (cpFullName || cpByCode.name);
        const cpShort = cpByName ? cpByName.short : cpByCode.short;
        const cpGroup = cpByName ? cpByName.group : cpByCode.group;
        const netBalance = r.netBalance || 0;
        const glName = (r.newCoaGlName || "").trim();
        const rptGroup = r.rptGroup || glRptGroupMap.get(glName) || null;
        const aeKey = `${(r.companyCode || "").trim().toLowerCase()}||${glName.toLowerCase()}`;
        const aeAmount = aeMap.get(aeKey) || 0;
        if (aeAmount !== 0) matchedAeKeys.add(aeKey);
        const adjClBal = Math.round((netBalance + aeAmount) * 100) / 100;
        allEntityNames.add(entity.name);
        return {
          companyCode: r.companyCode,
          entityName: entity.name,
          entityShort: entity.short,
          entityGroup: entity.group,
          code: r.code,
          accountHead: r.accountHead,
          subAccountHead: r.subAccountHead,
          newCoaGlName: r.newCoaGlName,
          icCounterParty: r.icCounterParty,
          icCounterPartyCode: r.icCounterPartyCode,
          cpName,
          cpShort,
          cpGroup,
          icTxnType: r.icTxnType,
          rptTxnType: r.rptTxnType,
          rptGroup,
          openingDebit: r.openingDebit || 0,
          openingCredit: r.openingCredit || 0,
          periodDebit: r.periodDebit || 0,
          periodCredit: r.periodCredit || 0,
          closingDebit: r.closingDebit || 0,
          closingCredit: r.closingCredit || 0,
          netBalance,
          aeAmount,
          adjClBal,
        };
      });

      for (const [aeKey, aeAmount] of aeMap.entries()) {
        if (matchedAeKeys.has(aeKey) || aeAmount === 0) continue;
        const [compCode, ledger] = aeKey.split("||");
        const matchingAes = aeEntries.filter(ae =>
          (ae.entityCompanyCode || "").trim().toLowerCase() === compCode &&
          (ae.rptLedger || "").trim().toLowerCase() === ledger
        );
        const firstAe = matchingAes[0];
        const entity = resolver.resolve(firstAe?.entityCompanyCode || compCode);
        const cpCode = firstAe?.rptCounterPartyCode || "";
        const cp = cpCode ? resolver.resolve(cpCode) : { name: firstAe?.rptCounterPartyName || "", short: "", group: "" };
        allEntityNames.add(entity.name);
        const aeIcTxnType = firstAe?.icTxnType || "";
        const aeRptTxnType = firstAe?.rptTxnType || "";
        if (aeIcTxnType) allIcTxnTypes.add(aeIcTxnType);
        data.push({
          companyCode: firstAe?.entityCompanyCode || compCode,
          entityName: entity.name,
          entityShort: entity.short,
          entityGroup: entity.group,
          code: null,
          accountHead: null,
          subAccountHead: null,
          newCoaGlName: firstAe?.rptLedger || ledger,
          icCounterParty: firstAe?.rptCounterPartyName || cp.name || null,
          icCounterPartyCode: cpCode || null,
          cpName: cp.name,
          cpShort: cp.short,
          cpGroup: cp.group,
          icTxnType: aeIcTxnType || null,
          rptTxnType: aeRptTxnType || null,
          rptGroup: firstAe?.icType || null,
          openingDebit: 0,
          openingCredit: 0,
          periodDebit: 0,
          periodCredit: 0,
          closingDebit: 0,
          closingCredit: 0,
          netBalance: 0,
          aeAmount,
          adjClBal: Math.round(aeAmount * 100) / 100,
        });
      }

      if (icTxnTypeFilters.length) {
        const set = new Set(icTxnTypeFilters);
        data = data.filter(r => set.has((r.icTxnType || "").trim()));
      }

      if (entityFilters.length) {
        const set = new Set(entityFilters);
        data = data.filter(r => set.has(r.entityName));
      }

      res.json({ data, total: data.length, icTxnTypes: Array.from(allIcTxnTypes).sort(), entityNames: Array.from(allEntityNames).sort() });
    } catch (error: any) {
      console.error("RPT detailed report error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-report/status", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixTbData, icMatrixMappingCompany, icRptAuditEntries, icEntityList } = await import("@shared/schema");

      const icTxnTypeFilters = parseMultiParam(req.query.icTxnType);
      const icTypeFilter = (req.query.icType as string || "").trim().toUpperCase();

      const [tbRows, companyMappings, aeEntries, entityListRows] = await Promise.all([
        db.select({
          companyCode: icMatrixTbData.companyCode,
          icCounterPartyCode: icMatrixTbData.icCounterPartyCode,
          icTxnType: icMatrixTbData.icTxnType,
          rptTxnType: icMatrixTbData.rptTxnType,
          newCoaGlName: icMatrixTbData.newCoaGlName,
          netBalance: icMatrixTbData.netBalance,
        })
          .from(icMatrixTbData)
          .where(buildIcRptCondition(icTypeFilter, icMatrixTbData.newCoaGlName)),
        db.select().from(icMatrixMappingCompany),
        db.select().from(icRptAuditEntries),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const allIcTxnTypes = new Set<string>();
      const resolver = buildEntityResolver(companyMappings, entityListRows);

      const aeMap = new Map<string, number>();
      for (const ae of aeEntries) {
        const key = `${(ae.entityCompanyCode || "").trim().toLowerCase()}||${(ae.rptLedger || "").trim().toLowerCase()}`;
        aeMap.set(key, (aeMap.get(key) || 0) + ae.amount);
      }

      const icTxnTypeSet = icTxnTypeFilters.length ? new Set(icTxnTypeFilters) : null;
      const dynamicColsSet = new Set<string>();
      const entityMap = new Map<string, {
        entityName: string;
        entityGroup: string;
        balances: Record<string, number>;
      }>();

      for (const r of tbRows) {
        const companyCode = (r.companyCode || "").trim();
        const cpCode = (r.icCounterPartyCode || "").trim();
        if (!companyCode || !cpCode) continue;

        const icTxnType = (r.icTxnType || "").trim();
        if (icTxnType) allIcTxnTypes.add(icTxnType);
        if (icTxnTypeSet && !icTxnTypeSet.has(icTxnType)) continue;

        const rptTxnType = (r.rptTxnType || "").trim();
        if (!rptTxnType) continue;

        dynamicColsSet.add(rptTxnType);

        const glName = (r.newCoaGlName || "").trim();
        const net = r.netBalance || 0;
        const aeKey = `${companyCode.trim().toLowerCase()}||${glName.toLowerCase()}`;
        const aeAmount = aeMap.get(aeKey) || 0;
        const adjClBal = Math.round((net + aeAmount) * 100) / 100;

        const entityGroup = resolver.resolveGroup(companyCode);
        const entityName = resolver.resolveName(companyCode);

        if (!entityMap.has(companyCode)) {
          entityMap.set(companyCode, { entityName, entityGroup, balances: {} });
        }
        const row = entityMap.get(companyCode)!;
        row.balances[rptTxnType] = (row.balances[rptTxnType] || 0) + adjClBal;
      }

      const rptOrder = await buildRptTxnTypeOrder();
      const dynamicColumns = sortByRptOrder(Array.from(dynamicColsSet), rptOrder);

      const groups = new Map<string, {
        entities: {
          entityName: string;
          balances: Record<string, number>;
          net: number;
          status: string;
        }[];
        totals: Record<string, number>;
        totalNet: number;
      }>();

      for (const [code, row] of entityMap) {
        const balances: Record<string, number> = {};
        let totalBal = 0;
        for (const col of dynamicColumns) {
          const v = Math.round((row.balances[col] || 0) * 100) / 100;
          if (v !== 0) balances[col] = v;
          totalBal += v;
        }
        const net = Math.round(totalBal * 100) / 100;
        const status = net > 0 ? "Net Lender" : net < 0 ? "Net Borrower" : "";
        const grp = row.entityGroup || "Other";

        if (!groups.has(grp)) {
          groups.set(grp, { entities: [], totals: {}, totalNet: 0 });
        }
        const g = groups.get(grp)!;
        g.entities.push({ entityName: row.entityName, balances, net, status });
        for (const col of dynamicColumns) {
          g.totals[col] = (g.totals[col] || 0) + (balances[col] || 0);
        }
        g.totalNet += net;
      }

      for (const g of groups.values()) {
        g.entities.sort((a, b) => a.entityName.localeCompare(b.entityName));
        for (const col of dynamicColumns) {
          g.totals[col] = Math.round((g.totals[col] || 0) * 100) / 100;
        }
        g.totalNet = Math.round(g.totalNet * 100) / 100;
      }

      const data = Array.from(groups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, g]) => ({
          group,
          totals: g.totals,
          totalNet: g.totalNet,
          entities: g.entities,
        }));

      res.json({ data, dynamicColumns, icTxnTypes: Array.from(allIcTxnTypes).sort() });
    } catch (error: any) {
      console.error("RPT report status error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-report/inter-group", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixTbData, icMatrixMappingCompany, icRptAuditEntries, icEntityList } = await import("@shared/schema");

      const icTxnTypeFilters = parseMultiParam(req.query.icTxnType);
      const icTypeFilter = (req.query.icType as string || "").trim().toUpperCase();

      const [tbRows, companyMappings, aeEntries, entityListRows] = await Promise.all([
        db.select({
          companyCode: icMatrixTbData.companyCode,
          icCounterPartyCode: icMatrixTbData.icCounterPartyCode,
          icTxnType: icMatrixTbData.icTxnType,
          rptTxnType: icMatrixTbData.rptTxnType,
          newCoaGlName: icMatrixTbData.newCoaGlName,
          netBalance: icMatrixTbData.netBalance,
        })
          .from(icMatrixTbData)
          .where(buildIcRptCondition(icTypeFilter, icMatrixTbData.newCoaGlName)),
        db.select().from(icMatrixMappingCompany),
        db.select().from(icRptAuditEntries),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const resolver = buildEntityResolver(companyMappings, entityListRows);

      const aeMap = new Map<string, number>();
      for (const ae of aeEntries) {
        const key = `${(ae.entityCompanyCode || "").trim().toLowerCase()}||${(ae.rptLedger || "").trim().toLowerCase()}`;
        aeMap.set(key, (aeMap.get(key) || 0) + ae.amount);
      }

      const icTxnTypeSet = icTxnTypeFilters.length ? new Set(icTxnTypeFilters) : null;
      const allIcTxnTypes = new Set<string>();
      const dynamicColsSet = new Set<string>();

      const pivotMap = new Map<string, { entityGroup: string; rptGroup: string; balances: Record<string, number> }>();

      for (const r of tbRows) {
        const companyCode = (r.companyCode || "").trim();
        const cpCode = (r.icCounterPartyCode || "").trim();
        if (!companyCode || !cpCode) continue;

        const entityGroup = resolver.resolveGroup(companyCode) || "Others";
        const cpGroup = resolver.resolveGroup(cpCode) || "Others";

        const icTxnType = (r.icTxnType || "").trim();
        if (icTxnType) allIcTxnTypes.add(icTxnType);
        if (icTxnTypeSet && !icTxnTypeSet.has(icTxnType)) continue;

        const rptTxnType = (r.rptTxnType || "").trim();
        if (!rptTxnType) continue;

        dynamicColsSet.add(rptTxnType);

        const glName = (r.newCoaGlName || "").trim();
        const net = r.netBalance || 0;
        const aeKey = `${companyCode.trim().toLowerCase()}||${glName.toLowerCase()}`;
        const aeAmount = aeMap.get(aeKey) || 0;
        const adjClBal = Math.round((net + aeAmount) * 100) / 100;

        const key = `${entityGroup}||${cpGroup}`;
        if (!pivotMap.has(key)) {
          pivotMap.set(key, { entityGroup, rptGroup: cpGroup, balances: {} });
        }
        const entry = pivotMap.get(key)!;
        entry.balances[rptTxnType] = (entry.balances[rptTxnType] || 0) + adjClBal;
      }

      const rptOrder = await buildRptTxnTypeOrder();
      const dynamicColumns = sortByRptOrder(Array.from(dynamicColsSet), rptOrder);

      const entityGroups = new Map<string, {
        rptRows: { rptGroup: string; balances: Record<string, number>; grandTotal: number }[];
        totals: Record<string, number>;
        grandTotal: number;
      }>();

      for (const entry of pivotMap.values()) {
        const eg = entry.entityGroup;
        if (!entityGroups.has(eg)) {
          entityGroups.set(eg, { rptRows: [], totals: {}, grandTotal: 0 });
        }
        const grp = entityGroups.get(eg)!;
        const rowBalances: Record<string, number> = {};
        let rowTotal = 0;
        for (const col of dynamicColumns) {
          const v = Math.round((entry.balances[col] || 0) * 100) / 100;
          if (v !== 0) rowBalances[col] = v;
          rowTotal += v;
        }
        rowTotal = Math.round(rowTotal * 100) / 100;
        grp.rptRows.push({ rptGroup: entry.rptGroup, balances: rowBalances, grandTotal: rowTotal });
        for (const col of dynamicColumns) {
          grp.totals[col] = (grp.totals[col] || 0) + (rowBalances[col] || 0);
        }
        grp.grandTotal += rowTotal;
      }

      for (const grp of entityGroups.values()) {
        grp.rptRows.sort((a, b) => a.rptGroup.localeCompare(b.rptGroup));
        for (const col of dynamicColumns) {
          grp.totals[col] = Math.round((grp.totals[col] || 0) * 100) / 100;
        }
        grp.grandTotal = Math.round(grp.grandTotal * 100) / 100;
      }

      const overallTotals: Record<string, number> = {};
      let overallGrandTotal = 0;
      for (const grp of entityGroups.values()) {
        for (const col of dynamicColumns) {
          overallTotals[col] = (overallTotals[col] || 0) + (grp.totals[col] || 0);
        }
        overallGrandTotal += grp.grandTotal;
      }
      for (const col of dynamicColumns) {
        overallTotals[col] = Math.round((overallTotals[col] || 0) * 100) / 100;
      }
      overallGrandTotal = Math.round(overallGrandTotal * 100) / 100;

      const data = Array.from(entityGroups.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([group, g]) => ({
          group,
          totals: g.totals,
          grandTotal: g.grandTotal,
          rptRows: g.rptRows,
        }));

      res.json({
        data,
        dynamicColumns,
        overallTotals,
        overallGrandTotal,
        icTxnTypes: Array.from(allIcTxnTypes).sort(),
      });
    } catch (error: any) {
      console.error("RPT inter-group report error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-report/pivot-groupwise", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixTbData, icMatrixMappingCompany, icRptAuditEntries, icEntityList } = await import("@shared/schema");

      const icTxnTypeFilters = parseMultiParam(req.query.icTxnType);
      const icTypeFilter = (req.query.icType as string || "").trim().toUpperCase();

      const [tbRows, companyMappings, aeEntries, entityListRows] = await Promise.all([
        db.select({
          companyCode: icMatrixTbData.companyCode,
          icCounterPartyCode: icMatrixTbData.icCounterPartyCode,
          icTxnType: icMatrixTbData.icTxnType,
          rptTxnType: icMatrixTbData.rptTxnType,
          newCoaGlName: icMatrixTbData.newCoaGlName,
          netBalance: icMatrixTbData.netBalance,
        })
          .from(icMatrixTbData)
          .where(buildIcRptCondition(icTypeFilter, icMatrixTbData.newCoaGlName)),
        db.select().from(icMatrixMappingCompany),
        db.select().from(icRptAuditEntries),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const resolver = buildEntityResolver(companyMappings, entityListRows);

      const aeMap = new Map<string, number>();
      for (const ae of aeEntries) {
        const key = `${(ae.entityCompanyCode || "").trim().toLowerCase()}||${(ae.rptLedger || "").trim().toLowerCase()}`;
        aeMap.set(key, (aeMap.get(key) || 0) + ae.amount);
      }

      const icTxnTypeSet = icTxnTypeFilters.length ? new Set(icTxnTypeFilters) : null;
      const allIcTxnTypes = new Set<string>();
      const dynamicColsSet = new Set<string>();
      const entityMap = new Map<string, {
        entityName: string;
        entityGroup: string;
        balances: Record<string, number>;
      }>();

      for (const r of tbRows) {
        const companyCode = (r.companyCode || "").trim();
        const cpCode = (r.icCounterPartyCode || "").trim();
        if (!companyCode || !cpCode) continue;

        const icTxnType = (r.icTxnType || "").trim();
        if (icTxnType) allIcTxnTypes.add(icTxnType);
        if (icTxnTypeSet && !icTxnTypeSet.has(icTxnType)) continue;

        const rptTxnType = (r.rptTxnType || "").trim();
        if (!rptTxnType) continue;

        dynamicColsSet.add(rptTxnType);
        const glName = (r.newCoaGlName || "").trim();
        const net = r.netBalance || 0;
        const aeKey = `${companyCode.trim().toLowerCase()}||${glName.toLowerCase()}`;
        const aeAmount = aeMap.get(aeKey) || 0;
        const adjClBal = Math.round((net + aeAmount) * 100) / 100;

        const entityGroup = resolver.resolveGroup(companyCode);
        const entityName = resolver.resolveName(companyCode);

        if (!entityMap.has(companyCode)) {
          entityMap.set(companyCode, { entityName, entityGroup, balances: {} });
        }
        const row = entityMap.get(companyCode)!;
        row.balances[rptTxnType] = (row.balances[rptTxnType] || 0) + adjClBal;
      }

      const rptOrder = await buildRptTxnTypeOrder();
      const dynamicColumns = sortByRptOrder(Array.from(dynamicColsSet), rptOrder);

      const groups = new Map<string, {
        entities: {
          entityName: string;
          balances: Record<string, number>;
          grandTotal: number;
        }[];
        totals: Record<string, number>;
        grandTotal: number;
      }>();

      for (const [code, row] of entityMap) {
        const balances: Record<string, number> = {};
        let totalBal = 0;
        for (const col of dynamicColumns) {
          const v = Math.round((row.balances[col] || 0) * 100) / 100;
          if (v !== 0) balances[col] = v;
          totalBal += v;
        }
        const grandTotal = Math.round(totalBal * 100) / 100;

        const gName = row.entityGroup || "(Ungrouped)";
        if (!groups.has(gName)) {
          groups.set(gName, { entities: [], totals: {}, grandTotal: 0 });
        }
        const grp = groups.get(gName)!;
        grp.entities.push({ entityName: row.entityName, balances, grandTotal });
        for (const col of dynamicColumns) {
          grp.totals[col] = (grp.totals[col] || 0) + (balances[col] || 0);
        }
        grp.grandTotal += grandTotal;
      }

      for (const grp of groups.values()) {
        grp.grandTotal = Math.round(grp.grandTotal * 100) / 100;
        grp.entities.sort((a, b) => a.entityName.localeCompare(b.entityName));
      }

      const overallTotals: Record<string, number> = {};
      let overallGrandTotal = 0;
      for (const grp of groups.values()) {
        for (const col of dynamicColumns) {
          overallTotals[col] = (overallTotals[col] || 0) + (grp.totals[col] || 0);
        }
        overallGrandTotal += grp.grandTotal;
      }
      overallGrandTotal = Math.round(overallGrandTotal * 100) / 100;

      const sortedData = Array.from(groups.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([group, grp]) => ({
          group,
          entities: grp.entities,
          totals: grp.totals,
          grandTotal: grp.grandTotal,
        }));

      res.json({
        data: sortedData,
        dynamicColumns,
        icTxnTypes: Array.from(allIcTxnTypes).sort(),
        overallTotals,
        overallGrandTotal,
      });
    } catch (error: any) {
      console.error("RPT pivot groupwise error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-report/summary-pivot", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixTbData, icMatrixMappingCompany, icRptAuditEntries, icMatrixMappingGl, icEntityList } = await import("@shared/schema");

      const icTypeFilter = (req.query.icType as string || "").trim().toUpperCase();
      const icTxnTypeFilters = parseMultiParam(req.query.icTxnType);

      const [tbRows, companyMappings, aeEntries, glMappings, entityListRows] = await Promise.all([
        db.select({
          companyCode: icMatrixTbData.companyCode,
          icCounterPartyCode: icMatrixTbData.icCounterPartyCode,
          icCounterParty: icMatrixTbData.icCounterParty,
          newCoaGlName: icMatrixTbData.newCoaGlName,
          netBalance: icMatrixTbData.netBalance,
          icTxnType: icMatrixTbData.icTxnType,
          rptTxnType: icMatrixTbData.rptTxnType,
          rptGroup: icMatrixTbData.rptGroup,
        })
          .from(icMatrixTbData)
          .where(buildIcRptCondition(icTypeFilter, icMatrixTbData.newCoaGlName)),
        db.select().from(icMatrixMappingCompany),
        db.select().from(icRptAuditEntries),
        db.select({
          newCoaGlName: icMatrixMappingGl.newCoaGlName,
          rptGroup: icMatrixMappingGl.rptGroup,
        }).from(icMatrixMappingGl),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const glRptGroupMap = new Map<string, string>();
      for (const g of glMappings) {
        if (g.newCoaGlName && g.rptGroup) {
          glRptGroupMap.set(g.newCoaGlName.trim(), g.rptGroup.trim());
        }
      }

      const rptCpNames = new Map<string, string>();
      for (const r of tbRows) {
        if (r.icCounterPartyCode && r.icCounterParty) {
          rptCpNames.set(r.icCounterPartyCode.trim().toLowerCase(), r.icCounterParty.trim());
        }
      }
      const resolver = buildEntityResolver(companyMappings, entityListRows, rptCpNames);

      const aeMap = new Map<string, number>();
      for (const ae of aeEntries) {
        const key = `${(ae.entityCompanyCode || "").trim().toLowerCase()}||${(ae.rptLedger || "").trim().toLowerCase()}`;
        aeMap.set(key, (aeMap.get(key) || 0) + ae.amount);
      }

      const icTxnTypeSet = icTxnTypeFilters.length ? new Set(icTxnTypeFilters) : null;
      const allIcTxnTypes = new Set<string>();
      const dynamicColsSet = new Set<string>();

      type CpRow = { cpName: string; balances: Record<string, number>; grandTotal: number };
      type RptGroupBlock = { rptGroup: string; counterParties: CpRow[]; totals: Record<string, number>; grandTotal: number };
      type EntityBlock = { entityBooks: string; entityShort: string; rptGroups: RptGroupBlock[]; totals: Record<string, number>; grandTotal: number };
      type GroupBlock = { entityGroup: string; entities: EntityBlock[]; totals: Record<string, number>; grandTotal: number };

      const pivotMap = new Map<string, { rptTxnType: string; net: number }[]>();

      for (const r of tbRows) {
        const companyCode = (r.companyCode || "").trim();
        const cpCode = (r.icCounterPartyCode || "").trim();
        if (!companyCode || !cpCode) continue;

        const icTxnType = (r.icTxnType || "").trim();
        if (icTxnType) allIcTxnTypes.add(icTxnType);
        if (icTxnTypeSet && !icTxnTypeSet.has(icTxnType)) continue;

        const rptTxnType = (r.rptTxnType || "").trim();
        if (!rptTxnType) continue;
        dynamicColsSet.add(rptTxnType);

        const glName = (r.newCoaGlName || "").trim();
        const rptGroup = r.rptGroup || glRptGroupMap.get(glName) || "Others";
        const net = r.netBalance || 0;
        const aeKey = `${companyCode.trim().toLowerCase()}||${glName.toLowerCase()}`;
        const aeAmount = aeMap.get(aeKey) || 0;
        const adjClBal = Math.round((net + aeAmount) * 100) / 100;

        const key = `${companyCode}||${rptGroup}||${cpCode}`;
        if (!pivotMap.has(key)) pivotMap.set(key, []);
        pivotMap.get(key)!.push({ rptTxnType, net: adjClBal });
      }

      const rptOrder = await buildRptTxnTypeOrder();
      const dynamicColumns = sortByRptOrder(Array.from(dynamicColsSet), rptOrder);

      const groupMap = new Map<string, Map<string, Map<string, Map<string, Record<string, number>>>>>();

      for (const [key, entries] of pivotMap) {
        const [companyCode, rptGroup, cpCode] = key.split("||");
        const entity = resolver.resolve(companyCode);
        const cp = resolver.resolve(cpCode);
        const entityGroup = entity.group || "(Ungrouped)";

        if (!groupMap.has(entityGroup)) groupMap.set(entityGroup, new Map());
        const entMap = groupMap.get(entityGroup)!;
        if (!entMap.has(companyCode)) entMap.set(companyCode, new Map());
        const rgMap = entMap.get(companyCode)!;
        if (!rgMap.has(rptGroup)) rgMap.set(rptGroup, new Map());
        const cpMap = rgMap.get(rptGroup)!;
        const cpKey = cpCode;
        if (!cpMap.has(cpKey)) cpMap.set(cpKey, {});
        const balances = cpMap.get(cpKey)!;

        for (const e of entries) {
          balances[e.rptTxnType] = (balances[e.rptTxnType] || 0) + e.net;
        }
      }

      const data: GroupBlock[] = [];
      const overallTotals: Record<string, number> = {};
      let overallGrandTotal = 0;

      const sortedGroups = Array.from(groupMap.entries()).sort(([a], [b]) => a.localeCompare(b));
      for (const [entityGroup, entMap] of sortedGroups) {
        const groupBlock: GroupBlock = { entityGroup, entities: [], totals: {}, grandTotal: 0 };

        const sortedEntities = Array.from(entMap.entries()).sort(([a], [b]) => {
          const nameA = resolver.resolveName(a);
          const nameB = resolver.resolveName(b);
          return nameA.localeCompare(nameB);
        });

        for (const [companyCode, rgMap] of sortedEntities) {
          const entity = resolver.resolve(companyCode);
          const entityBlock: EntityBlock = { entityBooks: entity.name, entityShort: entity.short, rptGroups: [], totals: {}, grandTotal: 0 };

          const sortedRptGroups = Array.from(rgMap.entries()).sort(([a], [b]) => a.localeCompare(b));
          for (const [rptGroup, cpMap] of sortedRptGroups) {
            const rptGroupBlock: RptGroupBlock = { rptGroup, counterParties: [], totals: {}, grandTotal: 0 };

            const sortedCps = Array.from(cpMap.entries()).sort(([a], [b]) => {
              const nameA = resolver.resolveName(a);
              const nameB = resolver.resolveName(b);
              return nameA.localeCompare(nameB);
            });

            for (const [cpCode, balances] of sortedCps) {
              const cp = resolver.resolve(cpCode);
              const roundedBal: Record<string, number> = {};
              let cpTotal = 0;
              for (const col of dynamicColumns) {
                const v = Math.round((balances[col] || 0) * 100) / 100;
                if (v !== 0) roundedBal[col] = v;
                cpTotal += v;
              }
              cpTotal = Math.round(cpTotal * 100) / 100;
              rptGroupBlock.counterParties.push({ cpName: cp.name, balances: roundedBal, grandTotal: cpTotal });
              for (const col of dynamicColumns) {
                rptGroupBlock.totals[col] = (rptGroupBlock.totals[col] || 0) + (roundedBal[col] || 0);
              }
              rptGroupBlock.grandTotal += cpTotal;
            }

            rptGroupBlock.grandTotal = Math.round(rptGroupBlock.grandTotal * 100) / 100;
            for (const col of dynamicColumns) {
              rptGroupBlock.totals[col] = Math.round((rptGroupBlock.totals[col] || 0) * 100) / 100;
            }

            entityBlock.rptGroups.push(rptGroupBlock);
            for (const col of dynamicColumns) {
              entityBlock.totals[col] = (entityBlock.totals[col] || 0) + (rptGroupBlock.totals[col] || 0);
            }
            entityBlock.grandTotal += rptGroupBlock.grandTotal;
          }

          entityBlock.grandTotal = Math.round(entityBlock.grandTotal * 100) / 100;
          for (const col of dynamicColumns) {
            entityBlock.totals[col] = Math.round((entityBlock.totals[col] || 0) * 100) / 100;
          }
          groupBlock.entities.push(entityBlock);
          for (const col of dynamicColumns) {
            groupBlock.totals[col] = (groupBlock.totals[col] || 0) + (entityBlock.totals[col] || 0);
          }
          groupBlock.grandTotal += entityBlock.grandTotal;
        }

        groupBlock.grandTotal = Math.round(groupBlock.grandTotal * 100) / 100;
        for (const col of dynamicColumns) {
          groupBlock.totals[col] = Math.round((groupBlock.totals[col] || 0) * 100) / 100;
          overallTotals[col] = (overallTotals[col] || 0) + (groupBlock.totals[col] || 0);
        }
        overallGrandTotal += groupBlock.grandTotal;
        data.push(groupBlock);
      }

      for (const col of dynamicColumns) {
        overallTotals[col] = Math.round((overallTotals[col] || 0) * 100) / 100;
      }
      overallGrandTotal = Math.round(overallGrandTotal * 100) / 100;

      res.json({ data, dynamicColumns, icTxnTypes: Array.from(allIcTxnTypes).sort(), overallTotals, overallGrandTotal });
    } catch (error: any) {
      console.error("RPT summary pivot error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-report/download", async (req, res) => {
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet([["RPT Report Download - Use individual tab downloads from frontend"]]);
      XLSX.utils.book_append_sheet(wb, ws, "Info");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="RPT_Report.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      console.error("Download RPT report error:", error);
      res.status(500).json({ message: "Failed to generate download" });
    }
  });

  app.get("/api/recon/rpt-report/entities", async (_req, res) => {
    try {
      const { icMatrixTbData, icMatrixMappingCompany, icEntityList } = await import("@shared/schema");
      const { db } = await import("../db");

      const [distinctCompanyCodes, companyMappings, entityListRows] = await Promise.all([
        db.selectDistinct({
          code: icMatrixTbData.companyCode,
        }).from(icMatrixTbData).where(
          sql`${icMatrixTbData.companyCode} IS NOT NULL AND ${icMatrixTbData.companyCode} != '' AND (${icMatrixTbData.newCoaGlName} LIKE 'IC\_%' ESCAPE '\\' OR ${icMatrixTbData.newCoaGlName} LIKE 'RPT\_%' ESCAPE '\\')`
        ),
        db.select().from(icMatrixMappingCompany),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const resolver = buildEntityResolver(companyMappings, entityListRows);

      const entities = distinctCompanyCodes
        .map(r => {
          const code = r.code || "";
          const info = resolver.resolve(code);
          return { code, name: info.name, shortName: info.short, group: info.group };
        })
        .filter(e => e.code)
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json({ entities });
    } catch (error: any) {
      console.error("Entities list error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });

  app.get("/api/recon/rpt-report/entity-working", async (req, res) => {
    try {
      const entityCodesRaw = String(req.query.entityCode || "").trim();
      if (!entityCodesRaw) return res.status(400).json({ message: "entityCode is required" });

      const entityCodes = entityCodesRaw.split(",").map(c => c.trim()).filter(Boolean);
      if (entityCodes.length === 0) return res.status(400).json({ message: "entityCode is required" });

      const entityCodesLower = entityCodes.map(c => c.toLowerCase().trim());
      const entityCodesSet = new Set(entityCodesLower);

      const { icMatrixTbData, icMatrixMappingCompany, icMatrixMappingGl, icEntityList } = await import("@shared/schema");
      const { db } = await import("../db");

      const [tbRows, companyMappings, glMappings, entityListRows] = await Promise.all([
        db.select({
          companyCode: icMatrixTbData.companyCode,
          accountHead: icMatrixTbData.accountHead,
          subAccountHead: icMatrixTbData.subAccountHead,
          newCoaGlName: icMatrixTbData.newCoaGlName,
          icCounterParty: icMatrixTbData.icCounterParty,
          icCounterPartyCode: icMatrixTbData.icCounterPartyCode,
          icTxnType: icMatrixTbData.icTxnType,
          rptTxnType: icMatrixTbData.rptTxnType,
          openingDebit: icMatrixTbData.openingDebit,
          openingCredit: icMatrixTbData.openingCredit,
          periodDebit: icMatrixTbData.periodDebit,
          periodCredit: icMatrixTbData.periodCredit,
          closingDebit: icMatrixTbData.closingDebit,
          closingCredit: icMatrixTbData.closingCredit,
          netBalance: icMatrixTbData.netBalance,
          currentNonCurrent: icMatrixTbData.currentNonCurrent,
          fsGroup: icMatrixTbData.fsGroup,
          fsHeading: icMatrixTbData.fsHeading,
          tbSource: icMatrixTbData.tbSource,
        })
          .from(icMatrixTbData)
          .where(sql`(LOWER(TRIM(${icMatrixTbData.companyCode})) IN (${sql.join(entityCodesLower.map(c => sql`${c}`), sql`, `)})) AND (TRIM(${icMatrixTbData.newCoaGlName}) LIKE 'IC\\_%' ESCAPE '\\' OR TRIM(${icMatrixTbData.newCoaGlName}) LIKE 'RPT\\_%' ESCAPE '\\')`),
        db.select().from(icMatrixMappingCompany),
        db.select({
          newCoaGlName: icMatrixMappingGl.newCoaGlName,
          icCounterPartyCode: icMatrixMappingGl.icCounterPartyCode,
          currentNonCurrent: icMatrixMappingGl.currentNonCurrent,
          fsGroup: icMatrixMappingGl.fsGroup,
          fsHeading: icMatrixMappingGl.fsHeading,
        }).from(icMatrixMappingGl),
        db.select({ shortName: icEntityList.shortName, companyNameErp: icEntityList.companyNameErp, group: icEntityList.group }).from(icEntityList),
      ]);

      const glMappingLookup = new Map<string, { currentNonCurrent: string; fsGroup: string; fsHeading: string }>();
      for (const m of glMappings) {
        if (!m.newCoaGlName) continue;
        const key = `${m.newCoaGlName.trim().toLowerCase()}||${(m.icCounterPartyCode || "").trim().toLowerCase()}`;
        glMappingLookup.set(key, {
          currentNonCurrent: (m.currentNonCurrent || "").trim(),
          fsGroup: (m.fsGroup || "").trim(),
          fsHeading: (m.fsHeading || "").trim(),
        });
      }

      const rptCpNames = new Map<string, string>();
      for (const r of tbRows) {
        if (r.icCounterPartyCode && r.icCounterParty) {
          rptCpNames.set(r.icCounterPartyCode.trim().toLowerCase(), r.icCounterParty.trim());
        }
      }
      const resolver = buildEntityResolver(companyMappings, entityListRows, rptCpNames);

      const entityInfo = entityCodes.length === 1
        ? resolver.resolve(entityCodes[0])
        : { name: entityCodes.map(c => resolver.resolveShort(c)).join(", "), short: entityCodes.join(","), group: "" };

      const { icMatrixTbFiles } = await import("@shared/schema");
      let period = "";
      try {
        const tbFiles = await db.select().from(icMatrixTbFiles).limit(1);
        if (tbFiles.length > 0 && tbFiles[0].period) period = tbFiles[0].period;
      } catch (_) {}
      if (!period) {
        const periodSet = new Set<string>();
        for (const tb of tbRows) { if (tb.tbSource) periodSet.add(tb.tbSource); }
        period = periodSet.size > 0 ? Array.from(periodSet)[0] : "";
      }

      function resolveCp(cpCode: string, cpFullName?: string) {
        const cpByCode = resolver.resolve(cpCode);
        if (cpFullName) {
          const cpByName = resolver.resolveByName(cpFullName);
          if (cpByName) return { short: cpByName.short, full: cpFullName };
        }
        return { short: cpByCode.short, full: cpByCode.name !== cpCode ? cpByCode.name : (cpFullName || cpByCode.name) };
      }

      const icTxnTypeFilter = req.query.icTxnType ? String(req.query.icTxnType).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const icTypeFilter = req.query.icType ? String(req.query.icType).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];
      const rptTxnTypeFilter = req.query.rptTxnType ? String(req.query.rptTxnType).split(",").map(s => s.trim().toLowerCase()).filter(Boolean) : [];

      type AccountRow = {
        entityName: string;
        accountHead: string;
        subAccountHead: string;
        rptLedgerName: string;
        counterPartyShort: string;
        counterPartyFull: string;
        currentNonCurrent: string;
        fsGroup: string;
        fsHeading: string;
        netOpb: number;
        movements: Record<string, number>;
        clbNet: number;
        clbTb: number;
        diff: number;
      };

      const accountMap = new Map<string, AccountRow>();
      const movementTypesSet = new Set<string>();
      const allIcTxnTypes = new Set<string>();
      const allRptTxnTypes = new Set<string>();

      for (const tb of tbRows) {
        const glName = (tb.newCoaGlName || "").trim();
        const icTxnType = (tb.icTxnType || "").trim();
        const rptTxnType = (tb.rptTxnType || "").trim();
        if (!rptTxnType) continue;

        const icRptPrefix = glName.startsWith("IC_") ? "IC" : glName.startsWith("RPT_") ? "RPT" : "";
        if (icTxnType) allIcTxnTypes.add(icTxnType);
        if (rptTxnType) allRptTxnTypes.add(rptTxnType);

        if (icTxnTypeFilter.length && (!icTxnType || !icTxnTypeFilter.includes(icTxnType.toLowerCase()))) continue;
        if (icTypeFilter.length && (!icRptPrefix || !icTypeFilter.includes(icRptPrefix.toLowerCase()))) continue;
        if (rptTxnTypeFilter.length && !rptTxnTypeFilter.includes(rptTxnType.toLowerCase())) continue;

        const subAccHead = (tb.subAccountHead || "").trim();
        const accHead = (tb.accountHead || "").trim();
        const cpCode = (tb.icCounterPartyCode || "").trim();
        const entityCode = (tb.companyCode || "").trim();
        const accKey = `${entityCode.toLowerCase()}||${glName.toLowerCase()}||${cpCode.toLowerCase()}`;

        if (!accountMap.has(accKey)) {
          const cpFullName = (tb.icCounterParty || "").trim();
          const cp = resolveCp(cpCode, cpFullName);

          const mappingKey = `${glName.toLowerCase()}||${cpCode.toLowerCase()}`;
          const mapInfo = glMappingLookup.get(mappingKey);
          const entityResolved = resolver.resolve(entityCode);

          accountMap.set(accKey, {
            entityName: entityResolved.name,
            accountHead: accHead,
            subAccountHead: subAccHead,
            rptLedgerName: glName,
            counterPartyShort: cp.short,
            counterPartyFull: cp.full,
            currentNonCurrent: mapInfo?.currentNonCurrent || (tb.currentNonCurrent || "").trim(),
            fsGroup: mapInfo?.fsGroup || (tb.fsGroup || "").trim(),
            fsHeading: mapInfo?.fsHeading || (tb.fsHeading || "").trim(),
            netOpb: 0,
            movements: {},
            clbNet: 0,
            clbTb: 0,
            diff: 0,
          });
        }

        const row = accountMap.get(accKey)!;
        row.netOpb += (tb.openingDebit || 0) - (tb.openingCredit || 0);
        row.clbTb += (tb.closingDebit || 0) - (tb.closingCredit || 0);

        const periodMov = (tb.periodDebit || 0) - (tb.periodCredit || 0);
        if (periodMov !== 0) {
          const movKey = rptTxnType.replace(/\s+/g, "_");
          movementTypesSet.add(rptTxnType);
          row.movements[movKey] = (row.movements[movKey] || 0) + periodMov;
        }
      }

      for (const row of accountMap.values()) {
        const totalMov = Object.values(row.movements).reduce((s, v) => s + v, 0);
        row.clbNet = Math.round((row.netOpb + totalMov) * 100) / 100;
        row.diff = Math.round((row.clbNet - row.clbTb) * 100) / 100;
      }

      const movementColumns = Array.from(movementTypesSet).sort().map(type => ({
        key: type.replace(/\s+/g, "_"),
        label: type.replace(/_/g, " "),
        group: type.split("_")[0] || type,
      }));

      const rows = Array.from(accountMap.values()).sort((a, b) => {
        const entCmp = a.entityName.localeCompare(b.entityName);
        if (entCmp !== 0) return entCmp;
        const cncCmp = a.currentNonCurrent.localeCompare(b.currentNonCurrent);
        if (cncCmp !== 0) return cncCmp;
        const fsgCmp = a.fsGroup.localeCompare(b.fsGroup);
        if (fsgCmp !== 0) return fsgCmp;
        return a.accountHead.localeCompare(b.accountHead);
      });

      const totals: { netOpb: number; movements: Record<string, number>; clbNet: number; clbTb: number; diff: number } = {
        netOpb: 0, movements: {}, clbNet: 0, clbTb: 0, diff: 0,
      };
      for (const row of rows) {
        totals.netOpb += row.netOpb;
        totals.clbNet += row.clbNet;
        totals.clbTb += row.clbTb;
        totals.diff += row.diff;
        for (const [k, v] of Object.entries(row.movements)) {
          totals.movements[k] = (totals.movements[k] || 0) + v;
        }
      }

      res.json({
        entity: { code: entityCodesRaw, name: entityInfo.name, shortName: entityInfo.short, group: entityInfo.group },
        period,
        movementColumns,
        rows,
        totals,
        icTxnTypes: Array.from(allIcTxnTypes).sort(),
        rptTxnTypes: Array.from(allRptTxnTypes).sort(),
      });
    } catch (error: any) {
      console.error("Entity RPT working report error:", error);
      res.status(500).json({ message: error.message || String(error) });
    }
  });
}
