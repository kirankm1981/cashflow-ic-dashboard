import type { Express } from "express";
import { storage } from "../storage";
import { icReconGlFiles, icReconGlRawRows, icMatrixMappingGl, icMatrixMappingCompany } from "@shared/schema";
import type { InsertTransaction, InsertSummarizedLine } from "@shared/schema";
import { eq } from "drizzle-orm";
import { normalizeText } from "../utils/normalize";

import { upload, cleanupFile } from "./upload";
import { parseFileInWorker } from "../file-processor";
import { randomUUID } from "crypto";
import fs from "fs";
import * as XLSX from "xlsx";

function extractChequeNo(t: any): string | null {
  try {
    const rawData = t.rawRowData ? JSON.parse(t.rawRowData) : {};
    for (const [k, v] of Object.entries(rawData)) {
      if (/cheque|chq|check/i.test(k) && /no|num|number/i.test(k) && v) {
        return String(v).trim();
      }
    }
  } catch {}
  return null;
}

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
      const message = isOperational ? error.message : "Internal server error";
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
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/recon/upload-gl", upload.single("file"), async (req, res) => {
    req.setTimeout(1200000);
    res.setTimeout(1200000);
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const label = (req.body.label || "GL Dump").trim();
      const batchId = randomUUID();

      const allRows: any[][] = await parseFileInWorker(req.file.path, "gl.xlsx", undefined, "parseTbSheet");

      let headerRowIdx = -1;
      for (let i = 0; i < Math.min(10, allRows.length); i++) {
        const row = allRows[i];
        const firstCell = String(row[0] || "").trim().toLowerCase();
        if (firstCell === "type" || firstCell === "sl no" || firstCell === "sr no") {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx === -1) {
        return res.status(400).json({ message: "Could not detect header row. Expected a row with 'Type' in the first column." });
      }

      let enterpriseName: string | null = null;
      let reportPeriod: string | null = null;

      for (let i = 0; i < headerRowIdx; i++) {
        const row = allRows[i];
        for (let j = 0; j < row.length; j++) {
          const cellVal = String(row[j] || "").trim();
          if (!cellVal) continue;

          const periodMatch = cellVal.match(/(?:period|from)\s*[:\-]?\s*(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[\-\/\.]\d{1,2}[\-\/\.]\d{2,4})/i)
            || cellVal.match(/(\d{1,2}[\-\/\.]\w{3,9}[\-\/\.]\d{2,4})\s*(?:to|-)\s*(\d{1,2}[\-\/\.]\w{3,9}[\-\/\.]\d{2,4})/i)
            || cellVal.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-]\d{2,4})\s*(?:to|-)\s*((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*[\s\-]\d{2,4})/i)
            || cellVal.match(/(?:FY|Year|AY)\s*[:\-]?\s*(\d{4}[\-\/]\d{2,4})/i);
          if (periodMatch && !reportPeriod) {
            reportPeriod = cellVal;
          }

          if (!enterpriseName && i === 0 && !periodMatch && cellVal.length > 2 && !/^(ledger|abstract|report|trial|balance|period|date)/i.test(cellVal)) {
            enterpriseName = cellVal;
          }
        }
      }

      if (!enterpriseName) {
        const row0Cells = allRows[0] || [];
        for (const cell of row0Cells) {
          const v = String(cell || "").trim();
          if (v && v.length > 2 && !/^(ledger|abstract|report|trial|balance|period|date|from|to)/i.test(v)) {
            enterpriseName = v;
            break;
          }
        }
      }

      const originalFileName = req.file.originalname || "gl_dump.xlsx";
      if (!reportPeriod) {
        const fnPeriod = originalFileName.match(/\(([A-Za-z]{3,9}\s*'?\d{2,4}\s+to\s+[A-Za-z]{3,9}\s*'?\d{2,4})\)/i)
          || originalFileName.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4}\s*(?:to|-)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4})/i)
          || originalFileName.match(/((?:Q[1-4]|FY|H[12])\s*'?\d{2,4}(?:\s*[-\/]\s*\d{2,4})?)/i);
        if (fnPeriod) {
          reportPeriod = fnPeriod[1].trim();
        }
      }

      if (!enterpriseName) {
        const fnEnterprise = originalFileName.match(/\d+\s*(?:AM|PM)\s+([\w\s]+?)(?:\s*\()/i);
        if (fnEnterprise) {
          enterpriseName = fnEnterprise[1].trim();
        }
      }

      const headers = allRows[headerRowIdx].map((h: any) => String(h || "").trim());
      const dataRows = allRows.slice(headerRowIdx + 1);

      function findHeader(patterns: RegExp[]): number {
        for (const p of patterns) {
          const idx = headers.findIndex((h: string) => p.test(h));
          if (idx >= 0) return idx;
        }
        return -1;
      }

      const typeIdx = findHeader([/^type$/i]);
      const companyIdx = findHeader([/^company$/i, /^company\s*name$/i, /^entity$/i]);
      const buIdx = findHeader([/^business\s*unit$/i, /^bu$/i]);
      const acHeadCodeIdx = findHeader([/^a\/c\s*head\s*code$/i, /^ac\s*head\s*code$/i, /^account\s*head\s*code$/i]);
      const acHeadIdx = findHeader([/^account\s*head$/i, /^account$/i, /^gl\s*account$/i]);
      const subAcCodeIdx = findHeader([/^sub\s*a\/c\s*code$/i, /^sub\s*ac\s*code$/i, /^sub\s*account\s*code$/i]);
      const subAcHeadIdx = findHeader([/^sub\s*account\s*head$/i, /^sub\s*account$/i]);
      const debitIdx = findHeader([/^debit$/i, /^dr$/i, /^debit\s*amount$/i]);
      const creditIdx = findHeader([/^credit$/i, /^cr$/i, /^credit\s*amount$/i]);
      const docNoIdx = findHeader([/^document\s*no$/i, /^doc\s*no$/i, /^voucher\s*no$/i]);
      const docDateIdx = findHeader([/^doc\s*date$/i, /^document\s*date$/i, /^date$/i]);
      const narrationIdx = findHeader([/^narration$/i, /^description$/i, /^remarks$/i, /^particulars$/i]);

      const missingRequired: string[] = [];
      if (companyIdx < 0) missingRequired.push("Company");
      if (debitIdx < 0) missingRequired.push("Debit");
      if (creditIdx < 0) missingRequired.push("Credit");
      if (missingRequired.length > 0) {
        return res.status(400).json({ message: `Missing required columns: ${missingRequired.join(", ")}. Detected headers: ${headers.filter(h => h).join(", ")}` });
      }

      if (typeIdx < 0) {
        return res.status(400).json({ message: "Missing required 'Type' column. The GL dump must have a Type column to filter TRANSACTION rows." });
      }

      const transactionRows = dataRows.filter(r => String(r[typeIdx] || "").trim().toUpperCase() === "TRANSACTION");

      if (transactionRows.length === 0) {
        return res.status(400).json({ message: "No TRANSACTION rows found in the file. Only rows with Type = 'TRANSACTION' are processed." });
      }

      const { db } = await import("../db");
      const glMappings = await db.select().from(icMatrixMappingGl);
      const companyMappings = await db.select().from(icMatrixMappingCompany);

      if (glMappings.length === 0 || companyMappings.length === 0) {
        return res.status(400).json({ message: "Both GL Mapping and Company Code mapping must be uploaded before processing GL dumps." });
      }

      const glMap = new Map<string, typeof glMappings[0]>();
      for (const g of glMappings) {
        glMap.set(normalizeText(g.glName), g);
      }
      const companyMap = new Map<string, string>();
      for (const c of companyMappings) {
        companyMap.set(normalizeText(c.companyNameErp), c.companyCode);
      }

      function parseNum(v: any): number {
        if (v === null || v === undefined || v === "") return 0;
        const n = Number(String(v).replace(/,/g, ""));
        return isNaN(n) ? 0 : n;
      }

      const dateColIndices = new Set<number>();
      const dateColPatterns = [/created\s*on/i, /last\s*modified\s*on/i, /doc\s*date/i, /cheque\s*date/i, /brs\s*date/i];
      for (let ci = 0; ci < headers.length; ci++) {
        for (const p of dateColPatterns) {
          if (p.test(headers[ci])) {
            dateColIndices.add(ci);
            break;
          }
        }
      }

      function excelSerialToDate(serial: number): Date {
        const utcDays = Math.floor(serial) - 25569;
        const utcMs = utcDays * 86400000;
        const fractionalDay = serial - Math.floor(serial);
        const timeMs = Math.round(fractionalDay * 86400000);
        return new Date(utcMs + timeMs);
      }

      function formatCellValue(val: any, colIdx: number): string {
        if (val === null || val === undefined || val === "") return "";
        if (dateColIndices.has(colIdx) && typeof val === "number" && val > 25000 && val < 100000) {
          const dt = excelSerialToDate(val);
          const dd = String(dt.getUTCDate()).padStart(2, "0");
          const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
          const yyyy = dt.getUTCFullYear();
          const hh = dt.getUTCHours();
          const min = dt.getUTCMinutes();
          const ss = dt.getUTCSeconds();
          if (hh > 0 || min > 0 || ss > 0) {
            return `${dd}-${mm}-${yyyy} ${String(hh).padStart(2, "0")}:${String(min).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
          }
          return `${dd}-${mm}-${yyyy}`;
        }
        return String(val);
      }

      function buildRawRow(r: any[]): Record<string, any> {
        const raw: Record<string, any> = {};
        for (let ci = 0; ci < headers.length; ci++) {
          const hdr = headers[ci];
          if (hdr) {
            raw[hdr] = formatCellValue(r[ci], ci);
          }
        }
        return raw;
      }

      const rawRowInserts: { batchId: string; rowData: Record<string, any> }[] = [];
      for (const r of transactionRows) {
        const raw = buildRawRow(r);
        const company = String(r[companyIdx] || "").trim();
        const accountHead = acHeadIdx >= 0 ? String(r[acHeadIdx] || "").trim() : "";
        const subAccountHead = subAcHeadIdx >= 0 ? String(r[subAcHeadIdx] || "").trim() : "";

        let glMatch = subAccountHead ? glMap.get(normalizeText(subAccountHead)) : undefined;
        if (!glMatch) {
          glMatch = accountHead ? glMap.get(normalizeText(accountHead)) : undefined;
        }
        const icRptGlName = glMatch ? glMatch.newCoaGlName : accountHead;
        const icCounterParty = glMatch ? glMatch.icCounterParty : null;
        const icCounterPartyCode = glMatch ? glMatch.icCounterPartyCode : null;
        const companyCode = companyMap.get(normalizeText(company)) || null;

        const icTxnType = glMatch ? glMatch.icTxnType : null;
        raw["Net Amount"] = parseNum(r[debitIdx]) - parseNum(r[creditIdx]);
        raw["Company Code"] = companyCode || "";
        raw["IC-RPT GL Name"] = icRptGlName || "";
        raw["IC Counter Party"] = icCounterParty || "";
        raw["IC Counter Party Code"] = icCounterPartyCode || "";
        raw["IC Txn Type"] = icTxnType || "";

        rawRowInserts.push({ batchId, rowData: raw });
      }

      const BATCH_SIZE = 200;
      for (let i = 0; i < rawRowInserts.length; i += BATCH_SIZE) {
        await db.insert(icReconGlRawRows).values(rawRowInserts.slice(i, i + BATCH_SIZE));
      }

      const txns: InsertTransaction[] = [];

      for (const r of transactionRows) {
        const company = String(r[companyIdx] || "").trim();
        const accountHead = acHeadIdx >= 0 ? String(r[acHeadIdx] || "").trim() : "";
        const subAccountHead = subAcHeadIdx >= 0 ? String(r[subAcHeadIdx] || "").trim() : "";
        const debit = parseNum(r[debitIdx]);
        const credit = parseNum(r[creditIdx]);
        const netAmount = debit - credit;
        const documentNo = docNoIdx >= 0 ? (String(r[docNoIdx] || "").trim() || null) : null;
        const docDate = docDateIdx >= 0 ? (String(r[docDateIdx] || "").trim() || null) : null;
        const narration = narrationIdx >= 0 ? (String(r[narrationIdx] || "").trim() || null) : null;

        let glMatch = subAccountHead ? glMap.get(normalizeText(subAccountHead)) : undefined;
        if (!glMatch) {
          glMatch = accountHead ? glMap.get(normalizeText(accountHead)) : undefined;
        }
        const icRptGlName = glMatch ? glMatch.newCoaGlName : accountHead;
        const icCounterPartyCode = glMatch ? glMatch.icCounterPartyCode : null;
        const companyCode = companyMap.get(normalizeText(company)) || null;

        if (!icRptGlName || !icRptGlName.startsWith("IC_")) continue;
        if (!companyCode || !icCounterPartyCode) continue;

        txns.push({
          uploadBatchId: batchId,
          company: companyCode,
          counterParty: icCounterPartyCode,
          businessUnit: buIdx >= 0 ? (String(r[buIdx] || "").trim() || null) : null,
          accountHead: accountHead || null,
          subAccountHead: subAccountHead || null,
          debit,
          credit,
          netAmount,
          documentNo,
          docDate,
          narration,
          icGl: icRptGlName,
          rawRowData: JSON.stringify(buildRawRow(r)),
          reconStatus: "unmatched",
          reconId: null,
          reconRule: null,
        });
      }

      if (txns.length === 0) {
        return res.status(400).json({ message: "No IC records found after applying mappings. Ensure GL mapping file is uploaded first." });
      }

      const inserted = await storage.insertTransactions(txns);

      await storage.insertUploadBatch({
        batchId,
        fileName: req.file.originalname || "gl_dump.xlsx",
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
        netAmount: number;
        transactionCount: number;
      }>();

      for (const t of inserted) {
        const key = `${(t.company || "").trim().toUpperCase()}||${(t.documentNo || "").trim().toUpperCase()}||${(t.counterParty || "").trim().toUpperCase()}`;
        if (!groupMap.has(key)) {
          groupMap.set(key, {
            company: t.company,
            counterParty: t.counterParty,
            documentNo: t.documentNo,
            docDate: t.docDate,
            narration: t.narration,
            icGl: t.icGl || null,
            chequeNo: extractChequeNo(t),
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
        if (!group.chequeNo) group.chequeNo = extractChequeNo(t);
      }

      const summarizedLineEntries: InsertSummarizedLine[] = Array.from(groupMap.values())
        .filter(g => Math.abs(Math.round(g.netAmount * 100) / 100) >= 0.01)
        .map(g => ({
          uploadBatchId: batchId,
          company: g.company,
          counterParty: g.counterParty,
          documentNo: g.documentNo,
          docDate: g.docDate,
          narration: g.narration,
          icGl: g.icGl,
          chequeNo: g.chequeNo,
          netAmount: Math.round(g.netAmount * 100) / 100,
          transactionCount: g.transactionCount,
          reconStatus: "unmatched",
          reconId: null,
          reconRule: null,
        }));

      const insertedLines = await storage.insertSummarizedLines(summarizedLineEntries);

      const uniqueDocNos = new Set<string>();
      for (const r of transactionRows) {
        const dn = docNoIdx >= 0 ? String(r[docNoIdx] || "").trim() : "";
        if (dn) uniqueDocNos.add(dn);
      }
      const totalUniqueTransactions = uniqueDocNos.size || transactionRows.length;

      await db.insert(icReconGlFiles).values({
        batchId,
        fileName: req.file.originalname || "gl_dump.xlsx",
        label,
        enterpriseName: enterpriseName || null,
        reportPeriod: reportPeriod || null,
        totalRecords: totalUniqueTransactions,
        icRecords: inserted.length,
      });

      res.json({
        batchId,
        fileName: req.file.originalname,
        label,
        enterpriseName: enterpriseName || null,
        reportPeriod: reportPeriod || null,
        totalTransactions: totalUniqueTransactions,
        icRecords: inserted.length,
        summarizedLines: insertedLines.length,
      });
    } catch (error: any) {
      console.error("GL dump upload error:", error);
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/recon/gl-file/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
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
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/download-mapped-data", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

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
        const batch = await db.select({ rowData: icReconGlRawRows.rowData }).from(icReconGlRawRows).limit(batchSize).offset(offset);
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
      const colWidths = headers.map((h: string, i: number) => {
        let max = h.length;
        for (const row of sheetData.slice(1, 101)) {
          const val = String(row[i] || "");
          if (val.length > max) max = val.length;
        }
        return { wch: Math.min(max + 2, 40) };
      });
      ws["!cols"] = colWidths;
      XLSX.utils.book_append_sheet(wb, ws, "Mapped Data");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=IC_Recon_Mapped_Data.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/rpt-data", async (req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
      const search = (req.query.search as string) || "";
      const icTxnTypeFilter = (req.query.icTxnType as string) || "";
      const rptTypeFilter = (req.query.rptType as string) || "";

      const rptBaseWhere = sqlTag`(row_data->>'IC-RPT GL Name' LIKE 'IC_%' OR row_data->>'IC-RPT GL Name' LIKE 'RPT_%')`;

      const conditions = [rptBaseWhere];

      if (search) {
        const s = `%${search.toLowerCase()}%`;
        conditions.push(sqlTag`(
          lower(row_data->>'Document No') LIKE ${s} OR
          lower(row_data->>'IC-RPT GL Name') LIKE ${s} OR
          lower(row_data->>'Company') LIKE ${s} OR
          lower(row_data->>'Account Head') LIKE ${s}
        )`);
      }

      if (icTxnTypeFilter) {
        conditions.push(sqlTag`row_data->>'IC Txn Type' = ${icTxnTypeFilter}`);
      }

      if (rptTypeFilter === "IC") {
        conditions.push(sqlTag`row_data->>'IC-RPT GL Name' LIKE 'IC_%'`);
      } else if (rptTypeFilter === "RPT") {
        conditions.push(sqlTag`row_data->>'IC-RPT GL Name' LIKE 'RPT_%'`);
      }

      const whereClause = conditions.reduce((a, b) => sqlTag`${a} AND ${b}`);

      const [icTxnTypesResult, countResult, pageRows] = await Promise.all([
        db.select({
          txnType: sqlTag<string>`DISTINCT TRIM(row_data->>'IC Txn Type')`,
        }).from(icReconGlRawRows)
          .where(sqlTag`${rptBaseWhere} AND TRIM(COALESCE(row_data->>'IC Txn Type','')) != ''`),

        db.select({
          cnt: sqlTag<number>`count(*)`,
        }).from(icReconGlRawRows)
          .where(whereClause),

        db.select({
          rowData: icReconGlRawRows.rowData,
        }).from(icReconGlRawRows)
          .where(whereClause)
          .limit(limit)
          .offset((page - 1) * limit),
      ]);

      const total = Number(countResult[0]?.cnt ?? 0);
      const icTxnTypes = icTxnTypesResult
        .map(r => (r.txnType || "").trim())
        .filter(Boolean)
        .sort();

      const data = pageRows.map(r => {
        const p = typeof r.rowData === "string" ? JSON.parse(r.rowData) : r.rowData as Record<string, any>;
        const glName = (p["IC-RPT GL Name"] || "") as string;
        return {
          company: p["Company"] || "",
          companyCode: p["Company Code"] || "",
          documentNo: p["Document No"] || "",
          docDate: p["Doc Date"] || "",
          accountHead: p["Account Head"] || "",
          subAccountHead: p["Sub Account Head"] || "",
          icRptGlName: glName,
          icTxnType: p["IC Txn Type"] || "",
          rptType: glName.startsWith("IC_") ? "IC" : glName.startsWith("RPT_") ? "RPT" : "",
          netAmount: p["Net Amount"] ?? 0,
          icCounterParty: p["IC Counter Party"] || "",
          icCounterPartyCode: p["IC Counter Party Code"] || "",
          narration: p["Narration"] || "",
        };
      });

      const totalPages = Math.ceil(total / limit);
      res.json({ data, total, page, limit, totalPages, icTxnTypes });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/rpt-summary", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

      const rptBaseWhere = sqlTag`(row_data->>'IC-RPT GL Name' LIKE 'IC_%' OR row_data->>'IC-RPT GL Name' LIKE 'RPT_%')`;

      const summaryRows = await db.select({
        companyCode: sqlTag<string>`COALESCE(row_data->>'Company Code','')`.as("company_code"),
        companyName: sqlTag<string>`COALESCE(row_data->>'Company','')`.as("company_name"),
        counterPartyCode: sqlTag<string>`COALESCE(row_data->>'IC Counter Party Code','')`.as("counter_party_code"),
        counterPartyName: sqlTag<string>`COALESCE(row_data->>'IC Counter Party','')`.as("counter_party_name"),
        icTxnType: sqlTag<string>`COALESCE(row_data->>'IC Txn Type','')`.as("ic_txn_type"),
        glName: sqlTag<string>`MIN(row_data->>'IC-RPT GL Name')`.as("gl_name"),
        totalNet: sqlTag<number>`SUM(CAST(COALESCE(NULLIF(row_data->>'Net Amount',''),'0') AS NUMERIC))`.as("total_net"),
        rowCount: sqlTag<number>`COUNT(*)`.as("row_count"),
      }).from(icReconGlRawRows)
        .where(rptBaseWhere)
        .groupBy(
          sqlTag`row_data->>'Company Code'`,
          sqlTag`row_data->>'Company'`,
          sqlTag`row_data->>'IC Counter Party Code'`,
          sqlTag`row_data->>'IC Counter Party'`,
          sqlTag`row_data->>'IC Txn Type'`,
        );

      const data = summaryRows
        .map(r => {
          const gl = (r.glName || "") as string;
          return {
            company: r.companyCode || "",
            companyName: r.companyName || "",
            counterParty: r.counterPartyCode || "",
            counterPartyName: r.counterPartyName || "",
            transactionType: r.icTxnType || "",
            rptType: gl.startsWith("IC_") ? "IC" : gl.startsWith("RPT_") ? "RPT" : "",
            amount: Number(r.totalNet) || 0,
            rowCount: Number(r.rowCount) || 0,
          };
        })
        .filter(r => r.amount !== 0);

      res.json({ data, total: data.length });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/download-rpt-summary", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

      const rptBaseWhere = sqlTag`(row_data->>'IC-RPT GL Name' LIKE 'IC_%' OR row_data->>'IC-RPT GL Name' LIKE 'RPT_%')`;

      const summaryRows = await db.select({
        companyCode: sqlTag<string>`COALESCE(row_data->>'Company Code','')`.as("company_code"),
        counterPartyCode: sqlTag<string>`COALESCE(row_data->>'IC Counter Party Code','')`.as("counter_party_code"),
        icTxnType: sqlTag<string>`COALESCE(row_data->>'IC Txn Type','')`.as("ic_txn_type"),
        totalNet: sqlTag<number>`SUM(CAST(COALESCE(NULLIF(row_data->>'Net Amount',''),'0') AS NUMERIC))`.as("total_net"),
        rowCount: sqlTag<number>`COUNT(*)`.as("row_count"),
      }).from(icReconGlRawRows)
        .where(rptBaseWhere)
        .groupBy(
          sqlTag`row_data->>'Company Code'`,
          sqlTag`row_data->>'IC Counter Party Code'`,
          sqlTag`row_data->>'IC Txn Type'`,
        );

      const rows = summaryRows.map(r => ({
        "Company Code": r.companyCode,
        "Counter Party Code": r.counterPartyCode,
        "IC Txn Type": r.icTxnType,
        "Total Net Amount": r.totalNet,
        "Row Count": r.rowCount,
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "RPT Summary");
      ws["!cols"] = [
        { wch: 18 }, { wch: 22 }, { wch: 18 }, { wch: 18 }, { wch: 12 },
      ];
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=IC_Recon_RPT_Summary.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon/download-rpt-data", async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

      const rptBaseWhere = sqlTag`(row_data->>'IC-RPT GL Name' LIKE 'IC_%' OR row_data->>'IC-RPT GL Name' LIKE 'RPT_%')`;

      const allRptRows = await db.select({ rowData: icReconGlRawRows.rowData })
        .from(icReconGlRawRows)
        .where(rptBaseWhere);

      if (allRptRows.length === 0) {
        return res.status(404).json({ message: "No RPT data available." });
      }

      const parsed0 = typeof allRptRows[0].rowData === "string" ? JSON.parse(allRptRows[0].rowData) : allRptRows[0].rowData;
      const headers = Object.keys(parsed0 as Record<string, any>);
      const sheetData: any[][] = [headers];

      for (const row of allRptRows) {
        const parsed = typeof row.rowData === "string" ? JSON.parse(row.rowData) : row.rowData as Record<string, any>;
        sheetData.push(headers.map(h => parsed[h] !== undefined ? parsed[h] : ""));
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetData);
      ws["!cols"] = headers.map(h => ({ wch: Math.min(h.length + 5, 30) }));
      XLSX.utils.book_append_sheet(wb, ws, "RPT Data");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=IC_Recon_RPT_Data.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });
}
