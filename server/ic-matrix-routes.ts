import type { Express } from "express";
import XLSX from "xlsx";
import { db } from "./db";
import { icMatrixTbFiles, icMatrixTbData, icMatrixMappingGl, icMatrixMappingCompany, icEntityList } from "@shared/schema";
import { eq, sql, asc } from "drizzle-orm";
import { parseFileInWorker } from "./file-processor";
import { requireAuth, requireWriteAccess } from "./middleware/auth";
import { upload, cleanupFile, logUpload } from "./utils/upload-config";
import {
  buildIcDataSheet,
  buildIcBalanceMatrixSheet,
  buildIcNetoffMatrixSheets,
  buildIcNetoffDetailsSheet,
} from "@shared/excel-builders";

import { normalizeText } from "./utils/normalize";

const uploadLocks = { mapping: false, reprocess: false };

function parsePeriodFromCell(val: string): { period: string; start: string; end: string } {
  const raw = (val || "").trim();
  const match = raw.match(/From\s+(\S+)\s+To\s+(\S+)/i);
  if (match) {
    return { period: raw, start: match[1], end: match[2] };
  }
  return { period: raw, start: "", end: "" };
}

const tbSourceNameMap: [RegExp, string][] = [
  [/^assetz\s+premium/i, "Premium"],
  [/^kodathi/i, "Lifestyle"],
];

function mapTbSourceName(name: string): string {
  for (const [pattern, replacement] of tbSourceNameMap) {
    if (pattern.test(name)) return replacement;
  }
  return name;
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

export function registerIcMatrixRoutes(app: Express) {
  app.use("/api/ic-matrix", requireAuth);

  async function processIcMatrixTbInBackground(fileId: number, filePath: string, label: string, userPeriodStart: string, userPeriodEnd: string) {
    try {
      await db.update(icMatrixTbFiles).set({ status: "parsing", statusMessage: "Parsing file..." }).where(eq(icMatrixTbFiles.id, fileId));

      const allRows: any[][] = await parseFileInWorker(filePath, "tb.xlsx", undefined, "parseTbSheet");
      cleanupFile(filePath);

      const enterpriseRaw = String(allRows[1]?.[1] || allRows[1]?.[0] || "").trim();
      const enterpriseCleaned = enterpriseRaw.replace(/^(Enterprise|Company)\s*:\s*/i, "").trim();
      const enterprise = mapTbSourceName(enterpriseCleaned);

      let periodInfo = parsePeriodFromCell(String(allRows[4]?.[0] || ""));
      if (userPeriodStart && userPeriodEnd) {
        periodInfo.start = userPeriodStart;
        periodInfo.end = userPeriodEnd;
        periodInfo.period = `From ${userPeriodStart} To ${userPeriodEnd}`;
      }

      const headerRowIdx = 10;
      const headerCells = (allRows[headerRowIdx] || []).map((c: any) => String(c || "").trim().toLowerCase());
      const dataRows = allRows.slice(headerRowIdx + 1);
      const lastRow = dataRows.length > 0 ? dataRows[dataRows.length - 1] : [];
      const isTotal = String(lastRow[0] || "").toLowerCase().startsWith("total");
      const rows = isTotal ? dataRows.slice(0, -1) : dataRows;
      const isHeaderRow = (r: any[]) => {
        const first = String(r[0] || "").trim().toLowerCase();
        return first === "company" || first === "company name" || headerCells.length > 2 && headerCells.slice(0, 3).every((h, i) => h && String(r[i] || "").trim().toLowerCase() === h);
      };
      const validRows = rows.filter(r => r[0] && String(r[0]).trim() !== "" && !isHeaderRow(r));

      await db.update(icMatrixTbFiles).set({
        enterprise, period: periodInfo.period,
        periodStart: periodInfo.start, periodEnd: periodInfo.end,
        totalRecords: validRows.length,
        status: "inserting", statusMessage: `Parsed ${validRows.length} rows. Inserting...`,
      }).where(eq(icMatrixTbFiles.id, fileId));

      const glMappings = await db.select().from(icMatrixMappingGl);
      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const glMap = new Map<string, typeof glMappings[0]>();
      const coaToRptTxnType = new Map<string, string>();
      for (const g of glMappings) {
        glMap.set(normalizeText(g.glName), g);
        if (g.newCoaGlName && g.rptTxnType) coaToRptTxnType.set(g.newCoaGlName, g.rptTxnType);
      }
      const companyMap = new Map<string, string>();
      for (const c of companyMappings) {
        companyMap.set(normalizeText(c.companyNameErp), c.companyCode);
      }

      const batchSize = 500;
      let inserted = 0;
      for (let i = 0; i < validRows.length; i += batchSize) {
        const batch = validRows.slice(i, i + batchSize);
        const values = batch.map(r => {
          const company = String(r[0] || "").trim();
          const accountHead = String(r[9] || "").trim();
          const subAccountHead = String(r[11] || "").trim();
          const closingDebit = parseNum(r[16]);
          const closingCredit = parseNum(r[17]);
          const netBalance = closingDebit - closingCredit;
          const skipGlMatch = /^INTER\s*COMPANY/i.test(accountHead);
          let glMatch = !skipGlMatch && subAccountHead ? glMap.get(normalizeText(subAccountHead)) : undefined;
          if (!glMatch && !skipGlMatch) {
            glMatch = accountHead ? glMap.get(normalizeText(accountHead)) : undefined;
          }
          const newCoaGlName = glMatch ? glMatch.newCoaGlName : accountHead;
          const icCounterParty = glMatch ? glMatch.icCounterParty : null;
          const icCounterPartyCode = glMatch ? glMatch.icCounterPartyCode : null;
          const icTxnType = glMatch ? glMatch.icTxnType : null;
          const rptTxnType = newCoaGlName ? (coaToRptTxnType.get(newCoaGlName) || null) : null;
          const rptGroup = glMatch ? glMatch.rptGroup : null;
          const companyCode = companyMap.get(normalizeText(company)) || null;
          return {
            tbFileId: fileId, company,
            businessUnit: String(r[1] || "").trim() || null,
            group1: String(r[2] || "").trim() || null,
            group2: String(r[3] || "").trim() || null,
            group3: String(r[4] || "").trim() || null,
            group4: String(r[5] || "").trim() || null,
            group5: String(r[6] || "").trim() || null,
            subLedgerType: String(r[7] || "").trim() || null,
            code: String(r[8] || "").trim() || null,
            accountHead,
            subAccountCode: String(r[10] || "").trim() || null,
            subAccountHead,
            openingDebit: parseNum(r[12]), openingCredit: parseNum(r[13]),
            periodDebit: parseNum(r[14]), periodCredit: parseNum(r[15]),
            closingDebit, closingCredit, netBalance,
            newCoaGlName, icCounterParty, icCounterPartyCode, icTxnType, rptTxnType, rptGroup,
            companyCode, tbSource: enterprise,
          };
        });
        await db.insert(icMatrixTbData).values(values);
        inserted += values.length;
        if (inserted % 2000 < batchSize) {
          await db.update(icMatrixTbFiles).set({ statusMessage: `Inserting rows... ${inserted} / ${validRows.length}` }).where(eq(icMatrixTbFiles.id, fileId));
        }
      }

      await db.update(icMatrixTbFiles).set({
        status: "uploaded", statusMessage: `${inserted} rows stored`,
        totalRecords: inserted,
      }).where(eq(icMatrixTbFiles.id, fileId));
      logUpload("IC-MATRIX", "TB-UPLOAD OK", `File ${fileId} — ${inserted} rows stored`);
    } catch (error: any) {
      logUpload("IC-MATRIX", "TB-UPLOAD BG ERROR", `File ${fileId}: ${error.message}`);
      console.error(`[ic-matrix] TB background processing error for file ${fileId}:`, error);
      cleanupFile(filePath);
      await db.update(icMatrixTbFiles).set({
        status: "error", statusMessage: error.message || "Processing failed",
      }).where(eq(icMatrixTbFiles.id, fileId)).catch(() => {});
    }
  }

  app.post("/api/ic-matrix/upload-tb", requireWriteAccess, upload.single("file"), async (req, res) => {
    try {
      if (!req.file) { return res.status(400).json({ message: "No file uploaded" }); }
      logUpload("IC-MATRIX", "TB-UPLOAD START", `File: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)} KB)`);

      const label = (req.body.label || "TB").trim();
      const userPeriodStart = (req.body.periodStart || "").trim();
      const userPeriodEnd = (req.body.periodEnd || "").trim();

      const [tbFile] = await db.insert(icMatrixTbFiles).values({
        fileName: req.file.originalname,
        label,
        status: "parsing",
        statusMessage: "File accepted, parsing...",
      }).returning();

      res.json({ tbFileId: tbFile.id, message: "Upload started, processing in background..." });

      processIcMatrixTbInBackground(tbFile.id, req.file.path, label, userPeriodStart, userPeriodEnd);
    } catch (error: any) {
      logUpload("IC-MATRIX", "TB-UPLOAD ERROR", `${req.file?.originalname}: ${error.message}`);
      if (req.file?.path) cleanupFile(req.file.path);
      console.error("TB upload error:", error);
      res.status(error.status || 500).json({ message: error.message || String(error) });
    }
  });

  app.post("/api/ic-matrix/upload-mapping", requireWriteAccess, upload.single("file"), async (req, res) => {
    req.setTimeout(1200000);
    res.setTimeout(1200000);
    let acquiredMapping = false;
    try {
      if (uploadLocks.mapping) {
        if (req.file?.path) cleanupFile(req.file.path);
        return res.status(409).json({ message: "A mapping upload is already in progress. Please wait." });
      }
      uploadLocks.mapping = true;
      acquiredMapping = true;
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      logUpload("IC-MATRIX", "MAPPING-UPLOAD START", `File: ${req.file.originalname} (${(req.file.size / 1024).toFixed(0)} KB)`);

      const parsed = await parseFileInWorker(req.file.path, "mapping.xlsx", undefined, "parseMultiSheet");
      const sheetData = parsed.sheets as Record<string, any[][]>;

      const findHeaderRow = (rows: any[][]) => {
        for (let ri = 0; ri < Math.min(rows.length, 10); ri++) {
          const nonEmpty = (rows[ri] || []).filter((c: any) => String(c || "").trim() !== "").length;
          if (nonEmpty >= 2) return ri;
        }
        return 0;
      };
      const isBlankRow = (r: any[]) => r.every((c: any) => String(c ?? "").trim() === "");

      const sheetNames = parsed.sheetNames as string[];
      const findSheet = (target: string) => {
        const exact = sheetNames.find(s => s === target);
        if (exact) return exact;
        const norm = (s: string) => s.toLowerCase().replace(/[\s_\-]+/g, "");
        const lower = norm(target);
        return sheetNames.find(s => norm(s) === lower) || null;
      };
      const colIdx = (headers: string[], ...aliases: string[]) => {
        for (const alias of aliases) {
          const norm = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
          const idx = headers.findIndex(h => h === norm || h.includes(norm));
          if (idx >= 0) return idx;
        }
        return -1;
      };

      let glCount = 0;
      let companyCount = 0;

      const glSheetName = findSheet("IC-GL-Mapping") || findSheet("IC_GL_Mapping");
      if (glSheetName && sheetData[glSheetName]) {
        await db.delete(icMatrixMappingGl);
        const glRows: any[][] = sheetData[glSheetName];
        const glHdr = findHeaderRow(glRows);
        const rawHeaders = (glRows[glHdr] || []).map((h: any) => String(h || "").trim());
        const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const iGL = colIdx(headers, "glname", "gl");
        const iNew = colIdx(headers, "newcoaglname", "newcoa");
        const iCP = colIdx(headers, "iccounterparty");
        const iCPC = colIdx(headers, "iccounterpartycode");
        const iTxn = colIdx(headers, "ictxntype", "txntype");
        const iRptTxn = colIdx(headers, "rpttxntype");
        const iRptGroup = colIdx(headers, "rptgroup");
        const iCNC = colIdx(headers, "cnc", "currentnoncurrent");
        const iFSG = colIdx(headers, "fsgroup");
        const iFSH = colIdx(headers, "fsheading");
        console.log(`[IC-GL-Mapping] Sheet: ${glSheetName}, Header row: ${glHdr}, Headers: ${rawHeaders.join(", ")}`);
        console.log(`[IC-GL-Mapping] Column indices: GL=${iGL} New=${iNew} CP=${iCP} CPC=${iCPC} Txn=${iTxn} RptTxn=${iRptTxn} RptGroup=${iRptGroup} CNC=${iCNC} FSG=${iFSG} FSH=${iFSH}`);
        const firstCol = iGL >= 0 ? iGL : 0;
        const glDataRows = glRows.slice(glHdr + 1).filter(r => !isBlankRow(r) && r[firstCol] && String(r[firstCol]).trim() !== "");

        const batchSize = 500;
        for (let i = 0; i < glDataRows.length; i += batchSize) {
          const batch = glDataRows.slice(i, i + batchSize);
          const values = batch.map(r => ({
            glName: String(r[iGL >= 0 ? iGL : 0] || "").trim(),
            newCoaGlName: String(r[iNew >= 0 ? iNew : 1] || "").trim() || null,
            icCounterParty: String(r[iCP >= 0 ? iCP : 2] || "").trim() || null,
            icCounterPartyCode: String(r[iCPC >= 0 ? iCPC : 3] || "").trim() || null,
            icTxnType: String(r[iTxn >= 0 ? iTxn : 4] || "").trim() || null,
            rptTxnType: iRptTxn >= 0 ? (String(r[iRptTxn] || "").trim() || null) : null,
            rptGroup: iRptGroup >= 0 ? (String(r[iRptGroup] || "").trim() || null) : null,
            currentNonCurrent: iCNC >= 0 ? (String(r[iCNC] || "").trim() || null) : null,
            fsGroup: iFSG >= 0 ? (String(r[iFSG] || "").trim() || null) : null,
            fsHeading: iFSH >= 0 ? (String(r[iFSH] || "").trim() || null) : null,
          }));
          await db.insert(icMatrixMappingGl).values(values);
          glCount += values.length;
        }
      }

      const ccSheetName = findSheet("Company_Code") || findSheet("Company Code");
      if (ccSheetName && sheetData[ccSheetName]) {
        await db.delete(icMatrixMappingCompany);
        const ccRows: any[][] = sheetData[ccSheetName];
        const ccHdr = findHeaderRow(ccRows);
        const rawHeaders = (ccRows[ccHdr] || []).map((h: any) => String(h || "").trim());
        const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const iCNE = colIdx(headers, "companynameerp", "companyname", "company");
        const iCC = colIdx(headers, "companycode", "code");
        const iCN = colIdx(headers, "companyname");
        console.log(`[Company_Code] Sheet: ${ccSheetName}, Header row: ${ccHdr}, Headers: ${rawHeaders.join(", ")}`);
        console.log(`[Company_Code] Column indices: CNE=${iCNE} CC=${iCC} CN=${iCN}`);
        const firstCol = iCNE >= 0 ? iCNE : 0;
        const ccDataRows = ccRows.slice(ccHdr + 1).filter(r => !isBlankRow(r) && String(r[firstCol] || "").trim() !== "");

        const batchSize = 500;
        for (let i = 0; i < ccDataRows.length; i += batchSize) {
          const batch = ccDataRows.slice(i, i + batchSize);
          const values = batch.map(r => {
            const companyNameErp = String(r[iCNE >= 0 ? iCNE : 0] || "").trim();
            const companyCode = String(r[iCC >= 0 ? iCC : 1] || "").trim();
            const companyName = iCN >= 0 && iCN !== iCNE ? (String(r[iCN] || "").trim() || null) : null;
            const iGrp = colIdx(headers, "group");
            const group = iGrp >= 0 ? (String(r[iGrp] || "").trim() || null) : null;
            return { companyName, companyNameErp, companyCode, group };
          });
          await db.insert(icMatrixMappingCompany).values(values);
          companyCount += values.length;
        }
      }

      let entityCount = 0;
      const elSheetName = findSheet("Entity_List") || findSheet("Entity List");
      if (elSheetName && sheetData[elSheetName]) {
        await db.delete(icEntityList);
        const elRows: any[][] = sheetData[elSheetName];
        const elHdr = findHeaderRow(elRows);
        const rawHeaders = (elRows[elHdr] || []).map((h: any) => String(h || "").trim());
        const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const iSN = colIdx(headers, "shortname", "short");
        const iCN = colIdx(headers, "companyname");
        const iCNE = colIdx(headers, "companynameerp");
        const iDOI = colIdx(headers, "doiconversion", "doi");
        const iType = colIdx(headers, "type", "entitytype");
        const iProj = colIdx(headers, "project");
        const iStruct = colIdx(headers, "structure");
        const iGrp = colIdx(headers, "group");
        console.log(`[Entity_List] Sheet: ${elSheetName}, Header row: ${elHdr}, Headers: ${rawHeaders.join(", ")}`);
        const firstCol = iSN >= 0 ? iSN : 0;
        const elDataRows = elRows.slice(elHdr + 1).filter(r => !isBlankRow(r) && String(r[firstCol] || "").trim() !== "");

        const batchSize = 500;
        for (let i = 0; i < elDataRows.length; i += batchSize) {
          const batch = elDataRows.slice(i, i + batchSize);
          const values = batch.map(r => ({
            shortName: String(r[iSN >= 0 ? iSN : 0] || "").trim(),
            companyName: iCN >= 0 ? (String(r[iCN] || "").trim() || null) : null,
            companyNameErp: iCNE >= 0 ? (String(r[iCNE] || "").trim() || null) : null,
            doiConversion: iDOI >= 0 ? (String(r[iDOI] || "").trim() || null) : null,
            entityType: iType >= 0 ? (String(r[iType] || "").trim() || null) : null,
            project: iProj >= 0 ? (String(r[iProj] || "").trim() || null) : null,
            structure: iStruct >= 0 ? (String(r[iStruct] || "").trim() || null) : null,
            group: iGrp >= 0 ? (String(r[iGrp] || "").trim() || null) : null,
          }));
          await db.insert(icEntityList).values(values);
          entityCount += values.length;
        }
      }

      cleanupFile(req.file.path);
      logUpload("IC-MATRIX", "MAPPING-UPLOAD OK", `${req.file.originalname} — ${glCount} GL, ${companyCount} company, ${entityCount} entity mappings`);

      let reprocessed = 0;
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(icMatrixTbData);
      const total = Number(totalCount[0]?.count || 0);
      if (total > 0 && glCount > 0) {
        const freshGl = await db.select().from(icMatrixMappingGl);
        const freshCompany = await db.select().from(icMatrixMappingCompany);
        const rpGlMap = new Map<string, typeof freshGl[0]>();
        const rpCoaMap = new Map<string, string>();
        for (const g of freshGl) {
          rpGlMap.set(normalizeText(g.glName), g);
          if (g.newCoaGlName && g.rptTxnType) rpCoaMap.set(g.newCoaGlName, g.rptTxnType);
        }
        const rpCompanyMap = new Map<string, string>();
        for (const c of freshCompany) rpCompanyMap.set(normalizeText(c.companyNameErp), c.companyCode);

        const BATCH = 500;
        for (let offset = 0; offset < total; offset += BATCH) {
          const batch = await db.select({
            id: icMatrixTbData.id,
            company: icMatrixTbData.company,
            accountHead: icMatrixTbData.accountHead,
            subAccountHead: icMatrixTbData.subAccountHead,
          }).from(icMatrixTbData).orderBy(asc(icMatrixTbData.id)).limit(BATCH).offset(offset);
          const ups = batch.map(row => {
            const skipGl = /^INTER\s*COMPANY/i.test(row.accountHead || "");
            let glMatch = !skipGl && row.subAccountHead ? rpGlMap.get(normalizeText(row.subAccountHead)) : undefined;
            if (!glMatch && !skipGl) glMatch = row.accountHead ? rpGlMap.get(normalizeText(row.accountHead || "")) : undefined;
            const resolvedCoa = glMatch ? glMatch.newCoaGlName : row.accountHead;
            return db.update(icMatrixTbData).set({
              newCoaGlName: resolvedCoa,
              icCounterParty: glMatch ? glMatch.icCounterParty : null,
              icCounterPartyCode: glMatch ? glMatch.icCounterPartyCode : null,
              icTxnType: glMatch ? glMatch.icTxnType : null,
              rptTxnType: resolvedCoa ? (rpCoaMap.get(resolvedCoa) || null) : null,
              companyCode: rpCompanyMap.get(normalizeText(row.company || "")) || null,
              currentNonCurrent: glMatch ? glMatch.currentNonCurrent : null,
              fsGroup: glMatch ? glMatch.fsGroup : null,
              fsHeading: glMatch ? glMatch.fsHeading : null,
            }).where(eq(icMatrixTbData.id, row.id));
          });
          await Promise.all(ups);
          reprocessed += batch.length;
        }
        logUpload("IC-MATRIX", "AUTO-REPROCESS OK", `${reprocessed} TB rows re-enriched with new mappings`);
      }

      res.json({
        fileName: req.file.originalname,
        glMappings: glCount,
        companyMappings: companyCount,
        entityMappings: entityCount,
        sheets: parsed.sheetNames,
        reprocessed,
      });
    } catch (error: any) {
      logUpload("IC-MATRIX", "MAPPING-UPLOAD ERROR", `${req.file?.originalname}: ${error.message}`);
      if (req.file?.path) cleanupFile(req.file.path);
      console.error("Mapping upload error:", error);
      res.status(error.status || 500).json({ message: error.message || String(error) });
    } finally {
      if (acquiredMapping) uploadLocks.mapping = false;
    }
  });

  app.post("/api/ic-matrix/reprocess", requireWriteAccess, async (_req, res) => {
    let acquiredReprocess = false;
    try {
      if (uploadLocks.reprocess) {
        return res.status(409).json({ message: "Reprocessing is already in progress. Please wait." });
      }
      uploadLocks.reprocess = true;
      acquiredReprocess = true;
      const glMappings = await db.select().from(icMatrixMappingGl);
      const companyMappings = await db.select().from(icMatrixMappingCompany);

      const glMap = new Map<string, typeof glMappings[0]>();
      const coaToRptTxnType = new Map<string, string>();
      for (const g of glMappings) {
        glMap.set(normalizeText(g.glName), g);
        if (g.newCoaGlName && g.rptTxnType) coaToRptTxnType.set(g.newCoaGlName, g.rptTxnType);
      }

      const companyMap = new Map<string, string>();
      for (const c of companyMappings) {
        companyMap.set(normalizeText(c.companyNameErp), c.companyCode);
      }

      const BATCH = 500;
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(icMatrixTbData);
      const total = Number(totalCount[0]?.count || 0);
      let updated = 0;

      for (let offset = 0; offset < total; offset += BATCH) {
        const batch = await db.select({
          id: icMatrixTbData.id,
          company: icMatrixTbData.company,
          accountHead: icMatrixTbData.accountHead,
          subAccountHead: icMatrixTbData.subAccountHead,
        }).from(icMatrixTbData).orderBy(asc(icMatrixTbData.id)).limit(BATCH).offset(offset);

        const updatePromises = batch.map(row => {
          const skipGlMatch = /^INTER\s*COMPANY/i.test(row.accountHead || "");
          let glMatch = !skipGlMatch && row.subAccountHead ? glMap.get(normalizeText(row.subAccountHead)) : undefined;
          if (!glMatch && !skipGlMatch) {
            glMatch = row.accountHead ? glMap.get(normalizeText(row.accountHead || "")) : undefined;
          }
          const resolvedCoa = glMatch ? glMatch.newCoaGlName : row.accountHead;
          return db.update(icMatrixTbData)
            .set({
              newCoaGlName: resolvedCoa,
              icCounterParty: glMatch ? glMatch.icCounterParty : null,
              icCounterPartyCode: glMatch ? glMatch.icCounterPartyCode : null,
              icTxnType: glMatch ? glMatch.icTxnType : null,
              rptTxnType: resolvedCoa ? (coaToRptTxnType.get(resolvedCoa) || null) : null,
              companyCode: companyMap.get(normalizeText(row.company || "")) || null,
              currentNonCurrent: glMatch ? glMatch.currentNonCurrent : null,
              fsGroup: glMatch ? glMatch.fsGroup : null,
              fsHeading: glMatch ? glMatch.fsHeading : null,
            })
            .where(eq(icMatrixTbData.id, row.id));
        });
        await Promise.all(updatePromises);
        updated += batch.length;
      }

      res.json({ updated });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    } finally {
      if (acquiredReprocess) uploadLocks.reprocess = false;
    }
  });

  app.get("/api/ic-matrix/tb-files", async (_req, res) => {
    try {
      const files = await db.select().from(icMatrixTbFiles);
      res.json(files);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/tb-data", async (req, res) => {
    try {
      const tbFileId = req.query.tbFileId ? Number(req.query.tbFileId) : undefined;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
      const offset = (page - 1) * limit;

      const companyCodes = req.query.companyCodes ? String(req.query.companyCodes).split(",") : [];
      const counterPartyCodes = req.query.counterPartyCodes ? String(req.query.counterPartyCodes).split(",") : [];
      const icTxnTypes = req.query.icTxnTypes ? String(req.query.icTxnTypes).split(",") : [];

      const conditions = [sql`${icMatrixTbData.newCoaGlName} LIKE 'IC\_%' ESCAPE '\\'`];
      if (tbFileId) conditions.push(sql`${icMatrixTbData.tbFileId} = ${tbFileId}`);
      if (companyCodes.length > 0) {
        const placeholders = companyCodes.map(c => sql`${c}`);
        conditions.push(sql`${icMatrixTbData.companyCode} IN (${sql.join(placeholders, sql`, `)})`);
      }
      if (counterPartyCodes.length > 0) {
        const placeholders = counterPartyCodes.map(c => sql`${c}`);
        conditions.push(sql`${icMatrixTbData.icCounterPartyCode} IN (${sql.join(placeholders, sql`, `)})`);
      }
      if (icTxnTypes.length > 0) {
        const placeholders = icTxnTypes.map(c => sql`${c}`);
        conditions.push(sql`${icMatrixTbData.icTxnType} IN (${sql.join(placeholders, sql`, `)})`);
      }

      const baseCondition = sql.join(conditions, sql` AND `);

      let query = db.select().from(icMatrixTbData).where(baseCondition);
      let countQuery = db.select({ count: sql<number>`count(*)` }).from(icMatrixTbData).where(baseCondition);

      const [countResult] = await countQuery;
      const data = await (query as any).limit(limit).offset(offset);

      res.json({
        data,
        total: countResult.count,
        page,
        limit,
        totalPages: Math.ceil(countResult.count / limit),
      });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/download-ic-data", async (req, res) => {
    try {
      const tbFileId = req.query.tbFileId ? Number(req.query.tbFileId) : undefined;
      const conditions = [sql`${icMatrixTbData.newCoaGlName} LIKE 'IC\\_%' ESCAPE '\\'`];
      if (tbFileId) conditions.push(sql`${icMatrixTbData.tbFileId} = ${tbFileId}`);
      const baseCondition = sql.join(conditions, sql` AND `);
      const data = await db.select().from(icMatrixTbData).where(baseCondition);

      const wb = XLSX.utils.book_new();
      const built = buildIcDataSheet(data);
      XLSX.utils.book_append_sheet(wb, built.ws, built.name);
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toTimeString().slice(0, 5).replace(":", "");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Data_${dateStr}_${timeStr}.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/mapping-summary", async (_req, res) => {
    try {
      const [glCount] = await db.select({ count: sql<number>`count(*)` }).from(icMatrixMappingGl);
      const [companyCount] = await db.select({ count: sql<number>`count(*)` }).from(icMatrixMappingCompany);
      res.json({
        glMappings: glCount.count,
        companyMappings: companyCount.count,
      });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/summary", async (_req, res) => {
    try {
      const files = await db.select().from(icMatrixTbFiles);
      const [dataCount] = await db.select({ count: sql<number>`count(*)` }).from(icMatrixTbData);
      const [glCount] = await db.select({ count: sql<number>`count(*)` }).from(icMatrixMappingGl);
      const [companyCount] = await db.select({ count: sql<number>`count(*)` }).from(icMatrixMappingCompany);

      let period = "";
      let periodStart = "";
      let periodEnd = "";
      if (files.length > 0) {
        period = files[0].period || "";
        periodStart = files[0].periodStart || "";
        periodEnd = files[0].periodEnd || "";
      }

      res.json({
        tbFiles: files.length,
        totalRecords: dataCount.count,
        glMappings: glCount.count,
        companyMappings: companyCount.count,
        period,
        periodStart,
        periodEnd,
        files: files.map(f => ({ id: f.id, label: f.label, fileName: f.fileName, enterprise: f.enterprise, records: f.totalRecords, period: f.period })),
      });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/download", async (_req, res) => {
    try {
      const allData = await db.select().from(icMatrixTbData);
      const files = await db.select().from(icMatrixTbFiles);

      if (allData.length === 0) {
        return res.status(400).json({ message: "No data to download" });
      }

      const headers = [
        "Company", "Company Code", "Business Unit", "Group 1", "Group 2", "Group 3", "Group 4", "Group 5",
        "SubLedger Type", "Code", "Account Head", "Sub Account Code", "Sub Account Head",
        "Opening Debit", "Opening Credit", "Period Debit", "Period Credit",
        "Closing Debit", "Closing Credit", "Net Balance",
        "New COA GL Name", "IC Counter Party", "IC Counter Party Code", "IC Txn Type",
        "RPT Txn Type", "TB Source"
      ];

      const fileMap = new Map<number, string>();
      for (const f of files) fileMap.set(f.id, f.enterprise || f.label);

      const rows = allData.map(r => [
        r.company, r.companyCode || "", r.businessUnit || "",
        r.group1 || "", r.group2 || "", r.group3 || "", r.group4 || "", r.group5 || "",
        r.subLedgerType || "", r.code || "", r.accountHead || "",
        r.subAccountCode || "", r.subAccountHead || "",
        r.openingDebit, r.openingCredit, r.periodDebit, r.periodCredit,
        r.closingDebit, r.closingCredit, r.netBalance,
        r.newCoaGlName || "", r.icCounterParty || "", r.icCounterPartyCode || "", r.icTxnType || "",
        r.rptTxnType || "", r.tbSource || fileMap.get(r.tbFileId) || "",
      ]);

      const wb = XLSX.utils.book_new();
      const wsData = [headers, ...rows];
      const ws = XLSX.utils.aoa_to_sheet(wsData);

      const colWidths = headers.map((h, i) => {
        let max = h.length;
        for (const row of rows.slice(0, 100)) {
          const val = String(row[i] || "");
          if (val.length > max) max = val.length;
        }
        return { wch: Math.min(max + 2, 40) };
      });
      ws["!cols"] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, "Compiled TB");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const ctbDateStr = new Date().toISOString().slice(0, 10);
      const ctbTimeStr = new Date().toTimeString().slice(0, 5).replace(":", "");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Matrix_Compiled_TB_${ctbDateStr}_${ctbTimeStr}.xlsx"`);
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/download-balance-matrix", async (req, res) => {
    try {
      const filterTxnTypes = req.query.txnTypes ? String(req.query.txnTypes).split(",").filter(Boolean) : [];
      const filterCompanies = req.query.companies ? String(req.query.companies).split(",").filter(Boolean) : [];
      const filterCounterParties = req.query.counterParties ? String(req.query.counterParties).split(",").filter(Boolean) : [];
      const allData = await db.select().from(icMatrixTbData);
      let icData = allData.filter(r => r.newCoaGlName && r.newCoaGlName.startsWith("IC_"));

      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const codeToName: Record<string, string> = {};
      for (const m of companyMappings) {
        if (m.companyCode && m.companyName) codeToName[m.companyCode] = m.companyName;
      }
      for (const row of allData) {
        if (row.companyCode && row.company && !codeToName[row.companyCode]) codeToName[row.companyCode] = row.company;
      }
      for (const row of icData) {
        if (row.icCounterPartyCode && row.icCounterParty && !codeToName[row.icCounterPartyCode]) codeToName[row.icCounterPartyCode] = row.icCounterParty;
      }

      if (filterTxnTypes.length > 0) {
        icData = icData.filter(r => r.icTxnType && filterTxnTypes.includes(r.icTxnType));
      }

      const companyCodesSet = new Set<string>();
      const counterPartyCodesSet = new Set<string>();
      const balanceMap = new Map<string, number>();
      for (const row of icData) {
        const cc = row.companyCode || "";
        const cpCode = row.icCounterPartyCode || "";
        if (!cc || !cpCode) continue;
        companyCodesSet.add(cc);
        counterPartyCodesSet.add(cpCode);
        const key = `${cc}|${cpCode}`;
        balanceMap.set(key, (balanceMap.get(key) || 0) + (row.netBalance || 0));
      }

      let companyCodes = Array.from(companyCodesSet).sort();
      let counterPartyCodes = Array.from(counterPartyCodesSet).sort();
      if (filterCompanies.length > 0) companyCodes = companyCodes.filter(c => filterCompanies.includes(c));
      if (filterCounterParties.length > 0) counterPartyCodes = counterPartyCodes.filter(c => filterCounterParties.includes(c));

      const built = buildIcBalanceMatrixSheet(companyCodes, counterPartyCodes, codeToName, balanceMap);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, built.ws, built.name);
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const bmDateStr = new Date().toISOString().slice(0, 10);
      const bmTimeStr = new Date().toTimeString().slice(0, 5).replace(":", "");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Balance_Matrix_${bmDateStr}_${bmTimeStr}.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/download-netoff-matrix", async (req, res) => {
    try {
      const filterTxnTypes = req.query.txnTypes ? String(req.query.txnTypes).split(",").filter(Boolean) : [];
      const filterCompanies = req.query.companies ? String(req.query.companies).split(",").filter(Boolean) : [];
      const filterCounterParties = req.query.counterParties ? String(req.query.counterParties).split(",").filter(Boolean) : [];
      const allData = await db.select().from(icMatrixTbData);
      let icData = allData.filter(r => r.newCoaGlName && r.newCoaGlName.startsWith("IC_"));

      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const codeToName: Record<string, string> = {};
      for (const m of companyMappings) {
        if (m.companyCode && m.companyName) codeToName[m.companyCode] = m.companyName;
      }
      for (const row of allData) {
        if (row.companyCode && row.company && !codeToName[row.companyCode]) codeToName[row.companyCode] = row.company;
      }
      for (const row of icData) {
        if (row.icCounterPartyCode && row.icCounterParty && !codeToName[row.icCounterPartyCode]) codeToName[row.icCounterPartyCode] = row.icCounterParty;
      }

      if (filterTxnTypes.length > 0) {
        icData = icData.filter(r => r.icTxnType && filterTxnTypes.includes(r.icTxnType));
      }

      const companyCodesSet = new Set<string>();
      const counterPartyCodesSet = new Set<string>();
      const balanceMap = new Map<string, number>();
      for (const row of icData) {
        const cc = row.companyCode || "";
        const cpCode = row.icCounterPartyCode || "";
        if (!cc || !cpCode) continue;
        companyCodesSet.add(cc);
        counterPartyCodesSet.add(cpCode);
        const key = `${cc}|${cpCode}`;
        balanceMap.set(key, (balanceMap.get(key) || 0) + (row.netBalance || 0));
      }

      let companyCodes = Array.from(companyCodesSet).sort();
      let counterPartyCodes = Array.from(counterPartyCodesSet).sort();
      if (filterCompanies.length > 0) companyCodes = companyCodes.filter(c => filterCompanies.includes(c));
      if (filterCounterParties.length > 0) counterPartyCodes = counterPartyCodes.filter(c => filterCounterParties.includes(c));

      const built = buildIcNetoffMatrixSheets(companyCodes, counterPartyCodes, codeToName, balanceMap);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, built.matrix.ws, built.matrix.name);
      XLSX.utils.book_append_sheet(wb, built.summary.ws, built.summary.name);

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const noDateStr = new Date().toISOString().slice(0, 10);
      const noTimeStr = new Date().toTimeString().slice(0, 5).replace(":", "");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Netoff_Matrix_${noDateStr}_${noTimeStr}.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/download-netoff-details", async (req, res) => {
    try {
      const filterTxnTypes = req.query.txnTypes ? String(req.query.txnTypes).split(",").filter(Boolean) : [];
      const filterCompanies = req.query.companies ? String(req.query.companies).split(",").filter(Boolean) : [];
      const filterCounterParties = req.query.counterParties ? String(req.query.counterParties).split(",").filter(Boolean) : [];
      const allData = await db.select().from(icMatrixTbData);
      let icData = allData.filter(r => r.newCoaGlName && r.newCoaGlName.startsWith("IC_"));

      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const codeToName: Record<string, string> = {};
      for (const m of companyMappings) {
        if (m.companyCode && m.companyName) codeToName[m.companyCode] = m.companyName;
      }
      for (const row of allData) {
        if (row.companyCode && row.company && !codeToName[row.companyCode]) codeToName[row.companyCode] = row.company;
      }
      for (const row of icData) {
        if (row.icCounterPartyCode && row.icCounterParty && !codeToName[row.icCounterPartyCode]) codeToName[row.icCounterPartyCode] = row.icCounterParty;
      }

      if (filterTxnTypes.length > 0) {
        icData = icData.filter(r => r.icTxnType && filterTxnTypes.includes(r.icTxnType));
      }

      const companyCodesSet = new Set<string>();
      const counterPartyCodesSet = new Set<string>();
      const balanceMap = new Map<string, number>();
      for (const row of icData) {
        const cc = row.companyCode || "";
        const cpCode = row.icCounterPartyCode || "";
        if (!cc || !cpCode) continue;
        companyCodesSet.add(cc);
        counterPartyCodesSet.add(cpCode);
        const key = `${cc}|${cpCode}`;
        balanceMap.set(key, (balanceMap.get(key) || 0) + (row.netBalance || 0));
      }

      let companyCodes = Array.from(companyCodesSet).sort();
      let counterPartyCodes = Array.from(counterPartyCodesSet).sort();
      if (filterCompanies.length > 0) companyCodes = companyCodes.filter(c => filterCompanies.includes(c));
      if (filterCounterParties.length > 0) counterPartyCodes = counterPartyCodes.filter(c => filterCounterParties.includes(c));

      const built = buildIcNetoffDetailsSheet(companyCodes, counterPartyCodes, codeToName, balanceMap);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, built.ws, built.name);

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      const ndDateStr = new Date().toISOString().slice(0, 10);
      const ndTimeStr = new Date().toTimeString().slice(0, 5).replace(":", "");
      res.setHeader("Content-Disposition", `attachment; filename="IC_Netoff_Details_${ndDateStr}_${ndTimeStr}.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/ic-matrix/tb-file/:id", requireWriteAccess, async (req, res) => {
    try {
      const id = parseInt(String(req.params.id));
      await db.delete(icMatrixTbData).where(eq(icMatrixTbData.tbFileId, id));
      await db.delete(icMatrixTbFiles).where(eq(icMatrixTbFiles.id, id));
      res.json({ deleted: true });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/dashboard", async (req, res) => {
    try {
      const allData = await db.select().from(icMatrixTbData);
      const files = await db.select().from(icMatrixTbFiles);

      const filterTxnTypes = req.query.icTxnTypes ? String(req.query.icTxnTypes).split(",") : [];

      let icData = allData.filter(r => r.newCoaGlName && r.newCoaGlName.startsWith("IC_"));

      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const codeToName: Record<string, string> = {};
      for (const m of companyMappings) {
        if (m.companyCode && m.companyName) {
          codeToName[m.companyCode] = m.companyName;
        }
      }
      for (const row of allData) {
        if (row.companyCode && row.company && !codeToName[row.companyCode]) {
          codeToName[row.companyCode] = row.company;
        }
      }
      for (const row of icData) {
        if (row.icCounterPartyCode && row.icCounterParty && !codeToName[row.icCounterPartyCode]) {
          codeToName[row.icCounterPartyCode] = row.icCounterParty;
        }
      }

      const icTxnTypesSet = new Set<string>();
      for (const row of icData) {
        if (row.icTxnType) icTxnTypesSet.add(row.icTxnType);
      }

      if (filterTxnTypes.length > 0) {
        icData = icData.filter(r => r.icTxnType && filterTxnTypes.includes(r.icTxnType));
      }

      const companyCodesSet = new Set<string>();
      const counterPartyCodesSet = new Set<string>();
      const balanceMap = new Map<string, number>();

      for (const row of icData) {
        const cc = row.companyCode || "";
        const cpCode = row.icCounterPartyCode || "";
        if (!cc || !cpCode) continue;

        companyCodesSet.add(cc);
        counterPartyCodesSet.add(cpCode);

        const key = `${cc}|${cpCode}`;
        balanceMap.set(key, (balanceMap.get(key) || 0) + (row.netBalance || 0));
      }

      const companyCodes = Array.from(companyCodesSet).sort();
      const counterPartyCodes = Array.from(counterPartyCodesSet).sort();
      const icTxnTypes = Array.from(icTxnTypesSet).sort();

      const matrix: { companyCode: string; balances: Record<string, number>; total: number }[] = [];
      for (const cc of companyCodes) {
        const balances: Record<string, number> = {};
        let total = 0;
        for (const cp of counterPartyCodes) {
          const val = balanceMap.get(`${cc}|${cp}`) || 0;
          balances[cp] = val;
          total += val;
        }
        matrix.push({ companyCode: cc, balances, total });
      }

      const columnTotals: Record<string, number> = {};
      for (const cp of counterPartyCodes) {
        let colTotal = 0;
        for (const cc of companyCodes) {
          colTotal += balanceMap.get(`${cc}|${cp}`) || 0;
        }
        columnTotals[cp] = colTotal;
      }

      const netOffRows: {
        companyCode: string;
        counterPartyCode: string;
        companyBalance: number;
        counterPartyBalance: number;
        difference: number;
      }[] = [];

      const processedPairs = new Set<string>();
      for (const cc of companyCodes) {
        for (const cp of counterPartyCodes) {
          if (cc === cp) continue;
          const pairKey = [cc, cp].sort().join("|");
          if (processedPairs.has(pairKey)) continue;
          processedPairs.add(pairKey);

          const ccToCp = balanceMap.get(`${cc}|${cp}`) || 0;
          const cpToCc = balanceMap.get(`${cp}|${cc}`) || 0;

          const diff = ccToCp + cpToCc;
          if (Math.abs(diff) > 0.01) {
            netOffRows.push({
              companyCode: cc,
              counterPartyCode: cp,
              companyBalance: ccToCp,
              counterPartyBalance: cpToCc,
              difference: diff,
            });
          }
        }
      }

      netOffRows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

      const netOffBalanceMap = new Map<string, number>();
      const netOffProcessed = new Set<string>();
      const allCodesUnion = new Set([...companyCodes, ...counterPartyCodes]);
      for (const a of allCodesUnion) {
        for (const b of allCodesUnion) {
          if (a === b) continue;
          const pairKey = [a, b].sort().join("|");
          if (netOffProcessed.has(pairKey)) continue;
          netOffProcessed.add(pairKey);

          const aToB = balanceMap.get(`${a}|${b}`) || 0;
          const bToA = balanceMap.get(`${b}|${a}`) || 0;
          const net = aToB + bToA;

          if (net >= 0) {
            netOffBalanceMap.set(`${a}|${b}`, net);
            netOffBalanceMap.set(`${b}|${a}`, 0);
          } else {
            netOffBalanceMap.set(`${a}|${b}`, 0);
            netOffBalanceMap.set(`${b}|${a}`, net);
          }
        }
      }

      const netOffMatrix: { companyCode: string; balances: Record<string, number>; total: number }[] = [];
      for (const cc of companyCodes) {
        const balances: Record<string, number> = {};
        let total = 0;
        for (const cp of counterPartyCodes) {
          const val = netOffBalanceMap.get(`${cc}|${cp}`) || 0;
          balances[cp] = val;
          total += val;
        }
        netOffMatrix.push({ companyCode: cc, balances, total });
      }

      const netOffColumnTotals: Record<string, number> = {};
      for (const cp of counterPartyCodes) {
        let colTotal = 0;
        for (const cc of companyCodes) {
          colTotal += netOffBalanceMap.get(`${cc}|${cp}`) || 0;
        }
        netOffColumnTotals[cp] = colTotal;
      }

      let period = "";
      let periodStart = "";
      let periodEnd = "";
      if (files.length > 0) {
        period = files[0].period || "";
        periodStart = files[0].periodStart || "";
        periodEnd = files[0].periodEnd || "";
      }

      res.json({
        period,
        periodStart,
        periodEnd,
        totalIcRecords: icData.length,
        totalRecords: allData.length,
        companyCodes,
        counterPartyCodes,
        icTxnTypes,
        codeToName,
        matrix,
        columnTotals,
        netOffMatrix,
        netOffColumnTotals,
        netOffSummary: netOffRows,
        netOffCount: netOffRows.length,
        totalDifference: netOffRows.reduce((s, r) => s + Math.abs(r.difference), 0),
      });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/rpt-data", async (req, res) => {
    try {
      const allData = await db.select().from(icMatrixTbData);
      const files = await db.select().from(icMatrixTbFiles);

      let rptData = allData.filter(r => r.newCoaGlName && r.newCoaGlName.startsWith("RPT_"));

      const companyMappings = await db.select().from(icMatrixMappingCompany);
      const codeToName: Record<string, string> = {};
      for (const m of companyMappings) {
        if (m.companyCode && m.companyName) codeToName[m.companyCode] = m.companyName;
      }
      for (const row of allData) {
        if (row.companyCode && row.company && !codeToName[row.companyCode]) codeToName[row.companyCode] = row.company;
      }

      const filterRptTxnTypes = req.query.rptTxnTypes ? String(req.query.rptTxnTypes).split(",") : [];

      const rptTxnTypesSet = new Set<string>();
      for (const row of rptData) {
        if (row.rptTxnType) rptTxnTypesSet.add(row.rptTxnType);
      }

      if (filterRptTxnTypes.length > 0) {
        rptData = rptData.filter(r => r.rptTxnType && filterRptTxnTypes.includes(r.rptTxnType));
      }

      const summary: Record<string, { debit: number; credit: number; net: number; count: number }> = {};
      for (const row of rptData) {
        const txnType = row.rptTxnType || "Unmapped";
        if (!summary[txnType]) summary[txnType] = { debit: 0, credit: 0, net: 0, count: 0 };
        summary[txnType].debit += row.closingDebit || 0;
        summary[txnType].credit += row.closingCredit || 0;
        summary[txnType].net += row.netBalance || 0;
        summary[txnType].count += 1;
      }

      const summaryRows = Object.entries(summary)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([txnType, vals]) => ({ rptTxnType: txnType, ...vals }));

      const periodStart = files.length > 0 ? files[0].periodStart : null;
      const periodEnd = files.length > 0 ? files[0].periodEnd : null;

      const detailRows = rptData.map(r => ({
        company: r.company,
        companyCode: r.companyCode || "",
        accountHead: r.accountHead || "",
        subAccountHead: r.subAccountHead || "",
        closingDebit: r.closingDebit || 0,
        closingCredit: r.closingCredit || 0,
        netBalance: r.netBalance || 0,
        newCoaGlName: r.newCoaGlName || "",
        icCounterParty: r.icCounterParty || "",
        icCounterPartyCode: r.icCounterPartyCode || "",
        rptTxnType: r.rptTxnType || "",
        tbSource: r.tbSource || "",
      }));

      res.json({
        periodStart,
        periodEnd,
        totalRptRecords: rptData.length,
        rptTxnTypes: Array.from(rptTxnTypesSet).sort(),
        summary: summaryRows,
        details: detailRows,
        codeToName,
      });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ic-matrix/rpt-data/download", async (req, res) => {
    try {
      const allData = await db.select().from(icMatrixTbData);
      let rptData = allData.filter(r => r.newCoaGlName && r.newCoaGlName.startsWith("RPT_"));

      const filterRptTxnTypes = req.query.rptTxnTypes ? String(req.query.rptTxnTypes).split(",") : [];
      if (filterRptTxnTypes.length > 0) {
        rptData = rptData.filter(r => r.rptTxnType && filterRptTxnTypes.includes(r.rptTxnType));
      }

      const rows = rptData.map(r => ({
        "Company": r.company || "",
        "Company Code": r.companyCode || "",
        "Account Head": r.accountHead || "",
        "Sub Account Head": r.subAccountHead || "",
        "Closing Debit": r.closingDebit || 0,
        "Closing Credit": r.closingCredit || 0,
        "Net Balance": r.netBalance || 0,
        "New COA GL Name": r.newCoaGlName || "",
        "IC Counter Party": r.icCounterParty || "",
        "IC CP Code": r.icCounterPartyCode || "",
        "RPT Txn Type": r.rptTxnType || "",
        "TB Source": r.tbSource || "",
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(rows);
      XLSX.utils.book_append_sheet(wb, ws, "RPT Data");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="RPT_Data.xlsx"`);
      res.send(buf);
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/ic-matrix/clear", requireWriteAccess, async (_req, res) => {
    try {
      await db.delete(icMatrixTbData);
      await db.delete(icMatrixTbFiles);
      await db.delete(icMatrixMappingGl);
      await db.delete(icMatrixMappingCompany);
      res.json({ cleared: true });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/ic-matrix/clear-tb", requireWriteAccess, async (_req, res) => {
    try {
      await db.delete(icMatrixTbData);
      await db.delete(icMatrixTbFiles);
      res.json({ cleared: true });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/ic-matrix/clear-mapping", requireWriteAccess, async (_req, res) => {
    try {
      await db.delete(icMatrixMappingGl);
      await db.delete(icMatrixMappingCompany);
      res.json({ cleared: true });
    } catch (error: any) {
      const message = error.message || String(error);
      res.status(error.status || 500).json({ message });
    }
  });
}
