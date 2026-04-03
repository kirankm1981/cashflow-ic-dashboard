import type { Express } from "express";
import XLSX from "xlsx";
import { db } from "./db";
import {
  cashflowTbFiles,
  cashflowTbData,
  cashflowMappingGroupings,
  cashflowMappingEntities,
  cashflowPastLosses,
} from "@shared/schema";
import { eq, sql, asc, inArray, and } from "drizzle-orm";
import { parseFileInWorker } from "./file-processor";
import { requireAuth } from "./middleware/auth";
import { upload, cleanupFile } from "./utils/upload-config";

import { normalizeText } from "./utils/normalize";

type GroupingInfo = {
  cashflow: string | null; cfHead: string | null;
  activityType: string | null; cfStatementLine: string | null;
  plCategory: string | null; plSign: number;
  wipComponent: string | null; wcBucket: string | null; wcSign: number;
  debtBucket: string | null; kpiTag: string | null;
};

let mappingCache: {
  groupings: { map: Map<string, GroupingInfo>; raw: any[] } | null;
  entities: { mappings: any[]; companyKeys: Set<string> } | null;
  lastLoaded: number;
} = { groupings: null, entities: null, lastLoaded: 0 };

const MAPPING_CACHE_TTL = 10 * 60 * 1000;

function invalidateMappingCache() {
  mappingCache.groupings = null;
  mappingCache.entities = null;
  mappingCache.lastLoaded = 0;
}

async function getGroupingCache() {
  if (mappingCache.groupings && (Date.now() - mappingCache.lastLoaded) < MAPPING_CACHE_TTL) {
    return mappingCache.groupings;
  }
  const groupingMappings = await db.select().from(cashflowMappingGroupings);
  const map = new Map<string, GroupingInfo>();
  for (const g of groupingMappings) {
    map.set(normalizeText(g.accountHead || ""), {
      cashflow: g.cashflow, cfHead: g.cfHead,
      activityType: g.activityType || null, cfStatementLine: g.cfStatementLine || null,
      plCategory: g.plCategory || null, plSign: g.plSign || 0,
      wipComponent: g.wipComponent || null, wcBucket: g.wcBucket || null, wcSign: g.wcSign || 0,
      debtBucket: g.debtBucket || null, kpiTag: g.kpiTag || null,
    });
  }
  mappingCache.groupings = { map, raw: groupingMappings };
  mappingCache.lastLoaded = Date.now();
  return mappingCache.groupings;
}

async function getEntityCache() {
  if (mappingCache.entities && (Date.now() - mappingCache.lastLoaded) < MAPPING_CACHE_TTL) {
    return mappingCache.entities;
  }
  const entityMappings = await db.select().from(cashflowMappingEntities);
  const companyKeys = new Set(entityMappings.map(e => normalizeText(e.companyNameErp || e.companyName || "")).filter(Boolean));
  mappingCache.entities = { mappings: entityMappings, companyKeys };
  return mappingCache.entities;
}

function parseNum(v: any): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  return isNaN(n) ? 0 : n;
}

function excelDateToString(val: any): string {
  if (val === null || val === undefined || val === "") return "";
  if (typeof val === "number") {
    const epoch = new Date((val - 25569) * 86400 * 1000);
    return epoch.toISOString().split("T")[0];
  }
  return String(val);
}

export function registerCashflowRoutes(app: Express) {
  app.use("/api/cashflow", requireAuth);

  app.post("/api/cashflow/upload-tb", upload.single("file"), async (req, res) => {
    req.setTimeout(1200000);
    res.setTimeout(1200000);
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const label = (req.body.label || "TB").trim();

      const allRows: any[][] = await parseFileInWorker(req.file.path, "tb.xlsx", undefined, "parseTbSheet");

      const enterpriseRaw = String(allRows[1]?.[0] || "").trim();
      const enterprise = enterpriseRaw.replace(/^Enterprise\s*:\s*/i, "").trim();

      const periodRaw = String(allRows[4]?.[0] || "").trim();

      const headerRowIdx = 10;
      const dataRows = allRows.slice(headerRowIdx + 1);

      const lastRow = dataRows.length > 0 ? dataRows[dataRows.length - 1] : [];
      const isTotal = String(lastRow[0] || "").toLowerCase().startsWith("total");
      const rows = isTotal ? dataRows.slice(0, -1) : dataRows;
      const validRows = rows.filter(r => r[0] && String(r[0]).trim() !== "");

      const groupingCached = await getGroupingCache();
      const groupingMap = groupingCached.map;
      const entityCached = await getEntityCache();

      const companyStructureMap = new Map<string, string | null>();
      const buMap = new Map<string, { projectName: string | null; entityStatus: string | null }>();
      for (const e of entityCached.mappings) {
        const compKey = normalizeText(e.companyNameErp || e.companyName || "");
        if (compKey && e.structure && !companyStructureMap.has(compKey)) {
          companyStructureMap.set(compKey, e.structure);
        }
        const buKey = normalizeText(e.businessUnit || "");
        if (buKey) {
          buMap.set(buKey, {
            projectName: e.projectName,
            entityStatus: e.entityStatus,
          });
        }
      }

      const [tbFile] = await db.insert(cashflowTbFiles).values({
        fileName: req.file.originalname || "tb.xlsx",
        label,
        enterprise,
        period: periodRaw,
        totalRecords: validRows.length,
      }).returning();

      const BATCH_SIZE = 500;
      let inserted = 0;
      for (let i = 0; i < validRows.length; i += BATCH_SIZE) {
        const batch = validRows.slice(i, i + BATCH_SIZE);
        const values = batch.map(r => {
          const company = String(r[0] || "").trim();
          const accountHead = String(r[9] || "").trim();
          const openingDebit = parseNum(r[12]);
          const openingCredit = parseNum(r[13]);
          const periodDebit = parseNum(r[14]);
          const periodCredit = parseNum(r[15]);
          const closingDebit = parseNum(r[16]);
          const closingCredit = parseNum(r[17]);

          const grouping = groupingMap.get(normalizeText(accountHead));
          const businessUnit = String(r[1] || "").trim();
          const structure = companyStructureMap.get(normalizeText(company)) || null;
          const buMapping = buMap.get(normalizeText(businessUnit));

          return {
            tbFileId: tbFile.id,
            company,
            businessUnit,
            group1: String(r[2] || "").trim(),
            group2: String(r[3] || "").trim(),
            group3: String(r[4] || "").trim(),
            group4: String(r[5] || "").trim(),
            group5: String(r[6] || "").trim(),
            subLedgerType: String(r[7] || "").trim(),
            code: String(r[8] || "").trim(),
            accountHead,
            subAccountCode: String(r[10] || "").trim(),
            subAccountHead: String(r[11] || "").trim(),
            openingDebit,
            openingCredit,
            periodDebit,
            periodCredit,
            closingDebit,
            closingCredit,
            netOpeningBalance: openingDebit - openingCredit,
            netClosingBalance: closingDebit - closingCredit,
            cashflow: grouping?.cashflow || null,
            cfHead: grouping?.cfHead || null,
            activityType: grouping?.activityType || null,
            cfStatementLine: grouping?.cfStatementLine || null,
            plCategory: grouping?.plCategory || null,
            plSign: grouping?.plSign || 0,
            wipComponent: grouping?.wipComponent || null,
            wcBucket: grouping?.wcBucket || null,
            wcSign: grouping?.wcSign || 0,
            debtBucket: grouping?.debtBucket || null,
            kpiTag: grouping?.kpiTag || null,
            structure,
            projectName: buMapping?.projectName || null,
            entityStatus: buMapping?.entityStatus || null,
            tbSource: enterprise || label,
          };
        });
        await db.insert(cashflowTbData).values(values);
        inserted += values.length;
      }

      res.json({
        message: `Uploaded ${inserted} records from ${enterprise || label}`,
        tbFileId: tbFile.id,
        enterprise,
        period: periodRaw,
        totalRecords: inserted,
      });
    } catch (error: any) {
      console.error("Cashflow TB upload error:", error);
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/cashflow/upload-mapping", upload.single("file"), async (req, res) => {
    req.setTimeout(1200000);
    res.setTimeout(1200000);
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const parsed = await parseFileInWorker(req.file.path, "mapping.xlsx", undefined, "parseMultiSheet");
      const sheetData = parsed.sheets as Record<string, any[][]>;
      const sheetNames = parsed.sheetNames as string[];

      const findSheet = (target: string) => {
        const exact = sheetNames.find(s => s === target);
        if (exact) return exact;
        const lower = target.toLowerCase().replace(/\s+/g, "");
        return sheetNames.find(s => s.toLowerCase().replace(/\s+/g, "") === lower) || null;
      };

      let groupingsInserted = 0;
      let entitiesInserted = 0;
      let pastLossesInserted = 0;

      const groupingsSheet = findSheet("Groupings List");
      if (groupingsSheet) {
        await db.delete(cashflowMappingGroupings);
        const rows: any[][] = sheetData[groupingsSheet];
        const rawHeaders = (rows[0] || []).map((h: any) => String(h || "").trim());
        const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const colIdx = (...aliases: string[]) => {
          for (const alias of aliases) {
            const norm = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
            const idx = headers.findIndex(h => h === norm || h.includes(norm));
            if (idx >= 0) return idx;
          }
          return -1;
        };
        const iG1 = colIdx("group1");
        const iG2 = colIdx("group2");
        const iG3 = colIdx("group3");
        const iG4 = colIdx("group4");
        const iG5 = colIdx("group5");
        const iAH = colIdx("accounthead");
        const iCF = colIdx("cashflow");
        const iCFH = colIdx("cfhead");
        const iAT = colIdx("activitytype");
        const iCSL = colIdx("cfstatementline");
        const iPLC = colIdx("plcategory", "plcat");
        const iPLS = colIdx("plsign");
        const iWC = colIdx("wipcomponent", "wipcomp");
        const iWCB = colIdx("wcbucket");
        const iWCS = colIdx("wcsign");
        const iDB = colIdx("debtbucket");
        const iKPI = colIdx("kpitag");
        console.log(`[Groupings] Headers detected: ${rawHeaders.join(", ")}`);
        console.log(`[Groupings] Column indices: G1=${iG1} G2=${iG2} G3=${iG3} G4=${iG4} G5=${iG5} AH=${iAH} CF=${iCF} CFH=${iCFH} AT=${iAT} CSL=${iCSL} PLC=${iPLC} PLS=${iPLS} WC=${iWC} WCB=${iWCB} WCS=${iWCS} DB=${iDB} KPI=${iKPI}`);
        const str = (r: any[], i: number) => i >= 0 ? (String(r[i] || "").trim() || null) : null;
        const num = (r: any[], i: number) => i >= 0 ? (parseFloat(r[i]) || 0) : 0;
        const ahCol = iAH >= 0 ? iAH : (iG5 >= 0 ? iG5 + 1 : 5);
        const dataRows = rows.slice(1).filter(r => String(r[ahCol] || "").trim() !== "");
        const BATCH = 500;
        for (let i = 0; i < dataRows.length; i += BATCH) {
          const batch = dataRows.slice(i, i + BATCH);
          const values = batch.map(r => ({
            accountHead: String(r[ahCol] || "").trim(),
            cashflow: str(r, iCF >= 0 ? iCF : ahCol + 1),
            cfHead: str(r, iCFH >= 0 ? iCFH : ahCol + 2),
            activityType: str(r, iAT),
            cfStatementLine: str(r, iCSL),
            plCategory: str(r, iPLC),
            plSign: num(r, iPLS),
            wipComponent: str(r, iWC),
            wcBucket: str(r, iWCB),
            wcSign: num(r, iWCS),
            debtBucket: str(r, iDB),
            kpiTag: str(r, iKPI),
          }));
          await db.insert(cashflowMappingGroupings).values(values);
          groupingsInserted += values.length;
        }
      }

      const entitySheet = findSheet("Entity List");
      if (entitySheet) {
        await db.delete(cashflowMappingEntities);
        const rows: any[][] = sheetData[entitySheet];
        const rawHeaders = (rows[0] || []).map((h: any) => String(h || "").trim());
        const headers = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const colIdx = (...aliases: string[]) => {
          for (const alias of aliases) {
            const norm = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
            const idx = headers.findIndex(h => h === norm || h.includes(norm));
            if (idx >= 0) return idx;
          }
          return -1;
        };
        const iCN = colIdx("companyname", "company");
        const iCNE = colIdx("companynameerp", "erpname", "companyerp");
        const iST = colIdx("structure");
        const iBU = colIdx("businessunit", "bu");
        const iPN = colIdx("projectname", "project");
        const iES = colIdx("entitystatus", "status");
        const iRM = colIdx("remarks", "remark");
        console.log(`[Entity] Headers detected: ${rawHeaders.join(", ")}`);
        console.log(`[Entity] Column indices: CN=${iCN} CNE=${iCNE} ST=${iST} BU=${iBU} PN=${iPN} ES=${iES} RM=${iRM}`);
        const firstCol = iCN >= 0 ? iCN : (iCNE >= 0 ? iCNE : 0);
        const dataRows = rows.slice(1).filter(r => String(r[firstCol] || "").trim() !== "");
        const BATCH = 500;
        for (let i = 0; i < dataRows.length; i += BATCH) {
          const batch = dataRows.slice(i, i + BATCH);
          const values = batch.map(r => {
            const companyName = iCN >= 0 ? (String(r[iCN] || "").trim() || null) : (String(r[firstCol] || "").trim() || null);
            const companyNameErp = iCNE >= 0 ? String(r[iCNE] || "").trim() : (companyName || "");
            return {
              companyName,
              companyNameErp: companyNameErp || String(r[firstCol] || "").trim(),
              structure: iST >= 0 ? (String(r[iST] || "").trim() || null) : null,
              businessUnit: iBU >= 0 ? (String(r[iBU] || "").trim() || null) : null,
              projectName: iPN >= 0 ? (String(r[iPN] || "").trim() || null) : null,
              entityStatus: iES >= 0 ? (String(r[iES] || "").trim() || null) : null,
              remarks: iRM >= 0 ? (String(r[iRM] || "").trim() || null) : null,
            };
          });
          await db.insert(cashflowMappingEntities).values(values);
          entitiesInserted += values.length;
        }
      }

      const pastLossesSheet = findSheet("Past Losses");
      if (pastLossesSheet) {
        await db.delete(cashflowPastLosses);
        const rows: any[][] = sheetData[pastLossesSheet];
        const rawHeaders = (rows[0] || []).map((h: any) => String(h || "").trim());
        const hdrs = rawHeaders.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, ""));
        const colIdx = (...aliases: string[]) => {
          for (const alias of aliases) {
            const norm = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
            const idx = hdrs.findIndex(h => h === norm || h.includes(norm));
            if (idx >= 0) return idx;
          }
          return -1;
        };
        let headerIdx = 0;
        const iCo = colIdx("company", "entity");
        if (iCo < 0) {
          headerIdx = rows.findIndex(r => {
            const colA = String(r[0] || "").trim().toLowerCase().replace(/\s+/g, "");
            return colA.includes("company") || colA.includes("entity");
          });
          if (headerIdx < 0) headerIdx = 0;
        }
        const plHeaders = (rows[headerIdx] || []).map((h: any) => String(h || "").trim().toLowerCase().replace(/[^a-z0-9]/g, ""));
        const plCol = (...aliases: string[]) => {
          for (const alias of aliases) {
            const norm = alias.toLowerCase().replace(/[^a-z0-9]/g, "");
            const idx = plHeaders.findIndex(h => h === norm || h.includes(norm));
            if (idx >= 0) return idx;
          }
          return -1;
        };
        const iPLCo = plCol("company", "entity");
        const iPLPr = plCol("project");
        const iPLCf = plCol("cashflow");
        const iPLCH = plCol("cfhead");
        const iPLAm = plCol("amount");
        const iPLFs = plCol("asperfs", "perfs", "fs");
        const iPLLu = plCol("lossesupto", "upto", "losses");
        console.log(`[PastLosses] Header row ${headerIdx}: ${rawHeaders.join(", ")}`);
        console.log(`[PastLosses] Column indices: Co=${iPLCo} Pr=${iPLPr} Cf=${iPLCf} CH=${iPLCH} Am=${iPLAm} Fs=${iPLFs} Lu=${iPLLu}`);
        const coCol = iPLCo >= 0 ? iPLCo : 0;
        const dataRows = rows.slice(headerIdx + 1).filter(r => String(r[coCol] || "").trim() !== "");
        const BATCH = 200;
        for (let i = 0; i < dataRows.length; i += BATCH) {
          const batch = dataRows.slice(i, i + BATCH);
          const values = batch.map(r => ({
            company: String(r[iPLCo >= 0 ? iPLCo : 0] || "").trim() || null,
            project: String(r[iPLPr >= 0 ? iPLPr : 1] || "").trim() || null,
            cashflow: String(r[iPLCf >= 0 ? iPLCf : 2] || "").trim() || null,
            cfHead: String(r[iPLCH >= 0 ? iPLCH : 3] || "").trim() || null,
            amount: parseNum(r[iPLAm >= 0 ? iPLAm : 4]),
            asPerFs: String(r[iPLFs >= 0 ? iPLFs : 5] || "").trim() || null,
            lossesUpto: excelDateToString(r[iPLLu >= 0 ? iPLLu : 6]),
          }));
          await db.insert(cashflowPastLosses).values(values);
          pastLossesInserted += values.length;
        }
      }

      invalidateMappingCache();

      console.log(`Mapping upload: sheets found = [${sheetNames.join(", ")}]`);
      console.log(`Matched: groupings=${groupingsSheet || "NOT FOUND"}, entity=${entitySheet || "NOT FOUND"}, pastLosses=${pastLossesSheet || "NOT FOUND"}`);
      console.log(`Inserted: ${groupingsInserted} groupings, ${entitiesInserted} entities, ${pastLossesInserted} past losses`);

      res.json({
        message: `Mapping uploaded: ${groupingsInserted} groupings, ${entitiesInserted} entities, ${pastLossesInserted} past losses`,
        groupingsInserted,
        entitiesInserted,
        pastLossesInserted,
        sheetsFound: sheetNames,
      });
    } catch (error: any) {
      console.error("Cashflow mapping upload error:", error);
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/tb-files", async (_req, res) => {
    try {
      const files = await db.select().from(cashflowTbFiles);
      res.json(files);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/cashflow/tb-file/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(cashflowTbData).where(eq(cashflowTbData.tbFileId, id));
      await db.delete(cashflowTbFiles).where(eq(cashflowTbFiles.id, id));
      res.json({ message: "Deleted" });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/cashflow/clear-tb", async (_req, res) => {
    try {
      await db.delete(cashflowTbData);
      await db.delete(cashflowTbFiles);
      res.json({ message: "All TB data cleared" });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/cashflow/clear-mapping", async (_req, res) => {
    try {
      await db.delete(cashflowMappingGroupings);
      await db.delete(cashflowMappingEntities);
      await db.delete(cashflowPastLosses);
      invalidateMappingCache();
      res.json({ message: "Mapping data cleared" });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/mapping-summary", async (_req, res) => {
    try {
      const groupingCached = await getGroupingCache();
      const entityCached = await getEntityCache();
      const pastLosses = await db.select().from(cashflowPastLosses);
      res.json({
        hasMapping: groupingCached.raw.length > 0 || entityCached.mappings.length > 0,
        groupings: groupingCached.raw.length,
        entities: entityCached.mappings.length,
        pastLosses: pastLosses.length,
      });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/summary", async (_req, res) => {
    try {
      const files = await db.select().from(cashflowTbFiles);
      const totalRecords = files.reduce((sum, f) => sum + (f.totalRecords || 0), 0);
      const dataCount = await db.select({ count: sql<number>`count(*)` }).from(cashflowTbData);
      res.json({
        tbFiles: files.length,
        totalRecords,
        compiledRecords: dataCount[0]?.count || 0,
        enterprises: [...new Set(files.map(f => f.enterprise).filter(Boolean))],
        periods: [...new Set(files.map(f => f.period).filter(Boolean))],
      });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/cashflow/reprocess", async (_req, res) => {
    try {
      const groupingCached = await getGroupingCache();
      const groupingMap = groupingCached.map;
      const entityCached = await getEntityCache();

      const companyStructureMap = new Map<string, string | null>();
      const buMap = new Map<string, { projectName: string | null; entityStatus: string | null }>();
      for (const e of entityCached.mappings) {
        const compKey = normalizeText(e.companyNameErp || e.companyName || "");
        if (compKey && e.structure && !companyStructureMap.has(compKey)) {
          companyStructureMap.set(compKey, e.structure);
        }
        const buKey = normalizeText(e.businessUnit || "");
        if (buKey) {
          buMap.set(buKey, {
            projectName: e.projectName,
            entityStatus: e.entityStatus,
          });
        }
      }

      const BATCH = 500;
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(cashflowTbData);
      const total = Number(totalCount[0]?.count || 0);
      let updated = 0;

      for (let offset = 0; offset < total; offset += BATCH) {
        const batch = await db.select().from(cashflowTbData).orderBy(asc(cashflowTbData.id)).limit(BATCH).offset(offset);

        for (const row of batch) {
          const grouping = groupingMap.get(normalizeText(row.accountHead || ""));
          const buMapping = buMap.get(normalizeText(row.businessUnit || ""));

          const newFields = {
            cashflow: grouping?.cashflow || null,
            cfHead: grouping?.cfHead || null,
            activityType: grouping?.activityType || null,
            cfStatementLine: grouping?.cfStatementLine || null,
            plCategory: grouping?.plCategory || null,
            plSign: grouping?.plSign || 0,
            wipComponent: grouping?.wipComponent || null,
            wcBucket: grouping?.wcBucket || null,
            wcSign: grouping?.wcSign || 0,
            debtBucket: grouping?.debtBucket || null,
            kpiTag: grouping?.kpiTag || null,
            structure: companyStructureMap.get(normalizeText(row.company || "")) || null,
            projectName: buMapping?.projectName || null,
            entityStatus: buMapping?.entityStatus || null,
          };

          const changed = newFields.cashflow !== row.cashflow || newFields.cfHead !== row.cfHead ||
            newFields.activityType !== row.activityType || newFields.plCategory !== row.plCategory ||
            newFields.wcBucket !== row.wcBucket || newFields.debtBucket !== row.debtBucket ||
            newFields.kpiTag !== row.kpiTag || newFields.structure !== row.structure ||
            newFields.projectName !== row.projectName || newFields.entityStatus !== row.entityStatus;

          if (changed) {
            await db.update(cashflowTbData).set(newFields).where(eq(cashflowTbData.id, row.id));
            updated++;
          }
        }
      }

      res.json({ message: `Reprocessed ${updated} records`, updated });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/compiled-data", async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 500;
      const offset = parseInt(req.query.offset as string) || 0;

      const data = await db.select().from(cashflowTbData).limit(limit).offset(offset);
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(cashflowTbData);

      res.json({
        data,
        total: totalCount[0]?.count || 0,
        limit,
        offset,
      });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/past-losses", async (_req, res) => {
    try {
      const data = await db.select().from(cashflowPastLosses);
      res.json(data);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/download-mapped-tb", async (_req, res) => {
    try {
      const entityCached = await getEntityCache();
      const entityKeys = entityCached.companyKeys;

      const allRows = await db.select().from(cashflowTbData).orderBy(asc(cashflowTbData.id));
      const mappedRows = allRows.filter(r => entityKeys.has(normalizeText(r.company || "")));

      const sheetData = mappedRows.map(r => ({
        "Company": r.company,
        "Business Unit": r.businessUnit,
        "Group 1": r.group1,
        "Group 2": r.group2,
        "Group 3": r.group3,
        "Group 4": r.group4,
        "Group 5": r.group5,
        "Sub Ledger Type": r.subLedgerType,
        "Code": r.code,
        "Account Head": r.accountHead,
        "Sub Account Code": r.subAccountCode,
        "Sub Account Head": r.subAccountHead,
        "Opening Debit": r.openingDebit,
        "Opening Credit": r.openingCredit,
        "Period Debit": r.periodDebit,
        "Period Credit": r.periodCredit,
        "Closing Debit": r.closingDebit,
        "Closing Credit": r.closingCredit,
        "Net Opening Balance": r.netOpeningBalance,
        "Net Closing Balance": r.netClosingBalance,
        "Cashflow": r.cashflow,
        "CF Head": r.cfHead,
        "Structure": r.structure,
        "Project Name": r.projectName,
        "Entity Status": r.entityStatus,
        "TB Source": r.tbSource,
      }));

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetData);

      const colWidths = Object.keys(sheetData[0] || {}).map(key => ({
        wch: Math.max(key.length, 15),
      }));
      ws["!cols"] = colWidths;

      XLSX.utils.book_append_sheet(wb, ws, "Mapped TB Data");

      const buffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Cashflow_Mapped_TB.xlsx");
      res.send(buffer);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/unified-data", async (_req, res) => {
    try {
      const entityCached = await getEntityCache();
      const entityCompanyKeys = entityCached.companyKeys;
      const buEntityMap = new Map<string, { projectName: string | null; entityStatus: string | null }>();
      for (const e of entityCached.mappings) {
        const buKey = normalizeText(e.businessUnit || "");
        if (buKey) {
          buEntityMap.set(buKey, {
            projectName: e.projectName,
            entityStatus: e.entityStatus,
          });
        }
      }

      const tbAgg = await db.select({
        company: cashflowTbData.company,
        projectName: cashflowTbData.projectName,
        entityStatus: cashflowTbData.entityStatus,
        cashflow: cashflowTbData.cashflow,
        cfHead: cashflowTbData.cfHead,
        amount: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
        rowCount: sql<number>`count(*)`,
      }).from(cashflowTbData)
        .groupBy(
          cashflowTbData.company,
          cashflowTbData.projectName,
          cashflowTbData.entityStatus,
          cashflowTbData.cashflow,
          cashflowTbData.cfHead,
        );

      const tbRows = tbAgg
        .filter(r => entityCompanyKeys.has(normalizeText(r.company || "")))
        .map(r => ({
          company: r.company,
          projectName: r.projectName,
          entityStatus: r.entityStatus,
          cashflow: r.cashflow,
          cfHead: r.cfHead,
          amount: Number(r.amount) || 0,
        }));
      const totalTbRaw = tbAgg.reduce((s, r) => s + Number(r.rowCount || 0), 0);
      const tbMappedEntityRows = tbAgg.filter(r => entityCompanyKeys.has(normalizeText(r.company || ""))).reduce((s, r) => s + Number(r.rowCount || 0), 0);
      const excludedTbCount = totalTbRaw - tbMappedEntityRows;

      const plRows = await db.select().from(cashflowPastLosses);
      const pastLossRows = plRows
        .filter(pl => entityCompanyKeys.has(normalizeText(pl.company || "")))
        .map(pl => {
          const companyBUs = entityCached.mappings.filter(e => normalizeText(e.companyNameErp || e.companyName || "") === normalizeText(pl.company || ""));
          const matchedBU = companyBUs.find(e => normalizeText(e.projectName || "") === normalizeText(pl.project || ""));
          return {
            company: pl.company || "",
            projectName: pl.project || null,
            entityStatus: matchedBU?.entityStatus || companyBUs[0]?.entityStatus || null,
            cashflow: pl.cashflow || null,
            cfHead: pl.cfHead || null,
            amount: pl.amount || 0,
          };
        });

      const unified = [...tbRows, ...pastLossRows];
      res.json({
        data: unified,
        tbCount: tbMappedEntityRows,
        pastLossesCount: pastLossRows.length,
        totalCount: unified.length,
        excludedCount: excludedTbCount,
      });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/dashboard-data", async (_req, res) => {
    try {
      const [entityCached, files] = await Promise.all([
        getEntityCache(),
        db.select().from(cashflowTbFiles),
      ]);

      const validCompanies = entityCached.mappings
        .map(e => (e.companyNameErp || e.companyName || "").trim())
        .filter(Boolean);

      if (validCompanies.length === 0) {
        return res.json({ rows: [], companies: [], projects: [], periods: [] });
      }

      const fileMap = new Map(files.map(f => [f.id, f]));

      const aggRows = await db.select({
        tbFileId: cashflowTbData.tbFileId,
        company: cashflowTbData.company,
        projectName: cashflowTbData.projectName,
        entityStatus: cashflowTbData.entityStatus,
        accountHead: cashflowTbData.accountHead,
        cashflow: cashflowTbData.cashflow,
        cfHead: cashflowTbData.cfHead,
        activityType: cashflowTbData.activityType,
        cfStatementLine: cashflowTbData.cfStatementLine,
        plCategory: cashflowTbData.plCategory,
        plSign: sql<number>`max(pl_sign)`,
        wipComponent: cashflowTbData.wipComponent,
        wcBucket: cashflowTbData.wcBucket,
        wcSign: sql<number>`max(wc_sign)`,
        debtBucket: cashflowTbData.debtBucket,
        kpiTag: cashflowTbData.kpiTag,
        openingDebit: sql<number>`coalesce(sum(opening_debit), 0)`,
        openingCredit: sql<number>`coalesce(sum(opening_credit), 0)`,
        periodDebit: sql<number>`coalesce(sum(period_debit), 0)`,
        periodCredit: sql<number>`coalesce(sum(period_credit), 0)`,
        closingDebit: sql<number>`coalesce(sum(closing_debit), 0)`,
        closingCredit: sql<number>`coalesce(sum(closing_credit), 0)`,
        netOpeningBalance: sql<number>`coalesce(sum(net_opening_balance), 0)`,
        netClosingBalance: sql<number>`coalesce(sum(net_closing_balance), 0)`,
      }).from(cashflowTbData)
        .where(inArray(cashflowTbData.company, validCompanies))
        .groupBy(
          cashflowTbData.tbFileId,
          cashflowTbData.company,
          cashflowTbData.projectName,
          cashflowTbData.entityStatus,
          cashflowTbData.accountHead,
          cashflowTbData.cashflow,
          cashflowTbData.cfHead,
          cashflowTbData.activityType,
          cashflowTbData.cfStatementLine,
          cashflowTbData.plCategory,
          cashflowTbData.wipComponent,
          cashflowTbData.wcBucket,
          cashflowTbData.debtBucket,
          cashflowTbData.kpiTag,
        );

      const rows = aggRows.map(r => {
        const f = fileMap.get(r.tbFileId);
        const od = Number(r.openingDebit) || 0;
        const oc = Number(r.openingCredit) || 0;
        const pd = Number(r.periodDebit) || 0;
        const pc = Number(r.periodCredit) || 0;
        const cd = Number(r.closingDebit) || 0;
        const cc = Number(r.closingCredit) || 0;
        return {
          tbFileId: r.tbFileId,
          company: r.company,
          projectName: r.projectName,
          entityStatus: r.entityStatus,
          accountHead: r.accountHead,
          cashflow: r.cashflow,
          cfHead: r.cfHead,
          activityType: r.activityType,
          cfStatementLine: r.cfStatementLine,
          plCategory: r.plCategory,
          plSign: Number(r.plSign) || 0,
          wipComponent: r.wipComponent,
          wcBucket: r.wcBucket,
          wcSign: Number(r.wcSign) || 0,
          debtBucket: r.debtBucket,
          kpiTag: r.kpiTag,
          openingDebit: od,
          openingCredit: oc,
          periodDebit: pd,
          periodCredit: pc,
          closingDebit: cd,
          closingCredit: cc,
          netOpeningBalance: Number(r.netOpeningBalance) || 0,
          netClosingBalance: Number(r.netClosingBalance) || 0,
          periodTag: f?.period || null,
          enterprise: f?.enterprise || null,
          openingNet: od - oc,
          periodNet: pd - pc,
          closingNet: cd - cc,
        };
      });

      const companies = [...new Set(rows.map(r => r.company).filter(Boolean))].sort();
      const projects = [...new Set(rows.map(r => r.projectName).filter(Boolean))].sort();
      const periods = [...new Set(rows.map(r => r.periodTag).filter(Boolean))].sort();

      res.json({ rows, companies, projects, periods });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/download-detailed", async (_req, res) => {
    try {
      const entityCached = await getEntityCache();
      const entityCompanyKeys = entityCached.companyKeys;

      const tbAgg = await db.select({
        company: cashflowTbData.company,
        projectName: cashflowTbData.projectName,
        entityStatus: cashflowTbData.entityStatus,
        cashflow: cashflowTbData.cashflow,
        cfHead: cashflowTbData.cfHead,
        amount: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
      }).from(cashflowTbData)
        .groupBy(cashflowTbData.company, cashflowTbData.projectName, cashflowTbData.entityStatus, cashflowTbData.cashflow, cashflowTbData.cfHead);

      const tbRows = tbAgg.filter(r => entityCompanyKeys.has(normalizeText(r.company || ""))).map(r => ({
        company: r.company, projectName: r.projectName, entityStatus: r.entityStatus,
        cashflow: r.cashflow, cfHead: r.cfHead, amount: Number(r.amount) || 0,
      }));

      const plRows = await db.select().from(cashflowPastLosses);
      const pastLossRows = plRows.filter(pl => entityCompanyKeys.has(normalizeText(pl.company || ""))).map(pl => {
        const companyBUs = entityMappings.filter(e => normalizeText(e.companyNameErp || e.companyName || "") === normalizeText(pl.company || ""));
        const matchedBU = companyBUs.find(e => normalizeText(e.projectName || "") === normalizeText(pl.project || ""));
        return {
          company: pl.company || "", projectName: pl.project || null,
          entityStatus: matchedBU?.entityStatus || companyBUs[0]?.entityStatus || null,
          cashflow: pl.cashflow || null, cfHead: pl.cfHead || null, amount: pl.amount || 0,
        };
      });

      const unified = [...tbRows, ...pastLossRows];

      const projects = new Set<string>();
      const structure = new Map<string, Map<string, Map<string, number>>>();
      for (const r of unified) {
        const cfType = r.cashflow || "Unclassified";
        const head = r.cfHead || "Unmapped";
        const project = r.projectName || "Unassigned";
        projects.add(project);
        if (!structure.has(cfType)) structure.set(cfType, new Map());
        const heads = structure.get(cfType)!;
        if (!heads.has(head)) heads.set(head, new Map());
        const projectMap = heads.get(head)!;
        projectMap.set(project, (projectMap.get(project) || 0) + (r.amount || 0));
      }
      const projectList = Array.from(projects).sort();

      const sheetRows: any[][] = [];
      sheetRows.push(["Cashflow Type", "CF Head", ...projectList, "Total"]);

      const cfTypes = Array.from(structure.keys()).sort();
      for (const cfType of cfTypes) {
        const heads = structure.get(cfType)!;
        const parentTotals: Record<string, number> = {};
        let parentGrandTotal = 0;
        const childRows: any[][] = [];

        const sortedHeads = Array.from(heads.keys()).sort();
        for (const head of sortedHeads) {
          const projectMap = heads.get(head)!;
          let rowTotal = 0;
          const vals = projectList.map(p => {
            const v = projectMap.get(p) || 0;
            parentTotals[p] = (parentTotals[p] || 0) + v;
            rowTotal += v;
            return v || "";
          });
          parentGrandTotal += rowTotal;
          childRows.push(["", head, ...vals, rowTotal]);
        }

        sheetRows.push([cfType, "", ...projectList.map(p => parentTotals[p] || ""), parentGrandTotal]);
        sheetRows.push(...childRows);
      }

      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.aoa_to_sheet(sheetRows);
      ws["!cols"] = [{ wch: 20 }, { wch: 30 }, ...projectList.map(() => ({ wch: 18 })), { wch: 18 }];
      XLSX.utils.book_append_sheet(wb, ws, "Detailed Cashflow");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Cashflow_Detailed.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/download-unmapped", async (_req, res) => {
    try {
      const unmappedCfAgg = await db.select({
        company: cashflowTbData.company,
        accountHead: cashflowTbData.accountHead,
        netClosingBalance: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
        count: sql<number>`count(*)`,
      }).from(cashflowTbData)
        .where(sql`(${cashflowTbData.cashflow} IS NULL OR ${cashflowTbData.cashflow} = '' OR ${cashflowTbData.cfHead} IS NULL OR ${cashflowTbData.cfHead} = '')`)
        .groupBy(cashflowTbData.company, cashflowTbData.accountHead);

      const unmappedEntityAgg = await db.select({
        company: cashflowTbData.company,
        businessUnit: cashflowTbData.businessUnit,
        accountHead: cashflowTbData.accountHead,
        netClosingBalance: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
        count: sql<number>`count(*)`,
      }).from(cashflowTbData)
        .where(sql`(${cashflowTbData.projectName} IS NULL OR ${cashflowTbData.projectName} = '' OR ${cashflowTbData.entityStatus} IS NULL OR ${cashflowTbData.entityStatus} = '')`)
        .groupBy(cashflowTbData.company, cashflowTbData.businessUnit, cashflowTbData.accountHead);

      const wb = XLSX.utils.book_new();

      const cfSheet = XLSX.utils.json_to_sheet(unmappedCfAgg.map(r => ({
        "Company": r.company,
        "Account Head": r.accountHead,
        "Net Closing Balance": Number(r.netClosingBalance) || 0,
        "Row Count": Number(r.count) || 0,
      })));
      cfSheet["!cols"] = [{ wch: 40 }, { wch: 40 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, cfSheet, "Unmapped Cashflow");

      const entitySheet = XLSX.utils.json_to_sheet(unmappedEntityAgg.map(r => ({
        "Company": r.company,
        "Business Unit": r.businessUnit,
        "Account Head": r.accountHead,
        "Net Closing Balance": Number(r.netClosingBalance) || 0,
        "Row Count": Number(r.count) || 0,
      })));
      entitySheet["!cols"] = [{ wch: 40 }, { wch: 30 }, { wch: 40 }, { wch: 20 }, { wch: 12 }];
      XLSX.utils.book_append_sheet(wb, entitySheet, "Unmapped Entity");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Cashflow_Unmapped_Items.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/download-past-losses", async (_req, res) => {
    try {
      const data = await db.select().from(cashflowPastLosses);
      if (data.length === 0) {
        return res.status(404).json({ message: "No past losses data available." });
      }
      const sheetData = data.map(r => ({
        "Company": r.company || "",
        "Project": r.project || "",
        "Cashflow": r.cashflow || "",
        "CF Head": r.cfHead || "",
        "Amount": r.amount || 0,
        "As Per FS": r.asPerFs || "",
        "Losses Upto": r.lossesUpto || "",
      }));
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(sheetData);
      ws["!cols"] = [{ wch: 40 }, { wch: 30 }, { wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 15 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, ws, "Past Losses");
      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=Cashflow_Past_Losses.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/unmapped-items", async (_req, res) => {
    try {
      const unmappedGLs = await db.select({
        accountHead: cashflowTbData.accountHead,
        group1: sql<string>`MAX(${cashflowTbData.group1})`,
        group2: sql<string>`MAX(${cashflowTbData.group2})`,
        group3: sql<string>`MAX(${cashflowTbData.group3})`,
        group4: sql<string>`MAX(${cashflowTbData.group4})`,
        group5: sql<string>`MAX(${cashflowTbData.group5})`,
        netClosingBalance: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
        count: sql<number>`count(*)`,
      }).from(cashflowTbData)
        .where(sql`(${cashflowTbData.cashflow} IS NULL OR ${cashflowTbData.cashflow} = '' OR ${cashflowTbData.cfHead} IS NULL OR ${cashflowTbData.cfHead} = '')`)
        .groupBy(cashflowTbData.accountHead);

      const unmappedEntities = await db.select({
        company: cashflowTbData.company,
        businessUnit: cashflowTbData.businessUnit,
        netClosingBalance: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
        count: sql<number>`count(*)`,
      }).from(cashflowTbData)
        .where(sql`(${cashflowTbData.projectName} IS NULL OR ${cashflowTbData.projectName} = '' OR ${cashflowTbData.entityStatus} IS NULL OR ${cashflowTbData.entityStatus} = '')`)
        .groupBy(cashflowTbData.company, cashflowTbData.businessUnit);

      const groupingCached = await getGroupingCache();
      const groupingsMap = new Map(groupingCached.raw.map(g => [g.accountHead, g]));

      const entityCached = await getEntityCache();
      const entityMap = new Map<string, typeof entityCached.mappings[0]>();
      for (const e of entityCached.mappings) {
        const key = (e.companyNameErp || e.companyName || "").toLowerCase().trim();
        if (key) entityMap.set(key, e);
      }

      const cfTotalCount = unmappedGLs.reduce((s, r) => s + Number(r.count || 0), 0);
      const entityTotalCount = unmappedEntities.reduce((s, r) => s + Number(r.count || 0), 0);

      res.json({
        unmappedGLs: {
          count: cfTotalCount,
          items: unmappedGLs.map((r, i) => {
            const existing = groupingsMap.get(r.accountHead || "");
            return {
              id: i + 1,
              accountHead: r.accountHead,
              group1: r.group1 || "",
              group2: r.group2 || "",
              group3: r.group3 || "",
              group4: r.group4 || "",
              group5: r.group5 || "",
              cashflow: existing?.cashflow || "",
              cfHead: existing?.cfHead || "",
              activityType: existing?.activityType || "",
              cfStatementLine: existing?.cfStatementLine || "",
              plCategory: existing?.plCategory || "",
              plSign: existing?.plSign ?? 0,
              wipComponent: existing?.wipComponent || "",
              wcBucket: existing?.wcBucket || "",
              wcSign: existing?.wcSign ?? 0,
              debtBucket: existing?.debtBucket || "",
              kpiTag: existing?.kpiTag || "",
              netClosingBalance: Number(r.netClosingBalance) || 0,
              rowCount: Number(r.count) || 0,
            };
          }),
        },
        unmappedEntities: {
          count: entityTotalCount,
          items: unmappedEntities.map((r, i) => {
            const key = (r.company || "").toLowerCase().trim();
            const existing = entityMap.get(key);
            return {
              id: i + 1,
              company: r.company,
              businessUnit: r.businessUnit || "",
              structure: existing?.structure || "",
              projectName: existing?.projectName || "",
              entityStatus: existing?.entityStatus || "",
              remarks: existing?.remarks || "",
              netClosingBalance: Number(r.netClosingBalance) || 0,
              rowCount: Number(r.count) || 0,
            };
          }),
        },
      });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/cashflow/update-gl-mapping", async (req, res) => {
    try {
      const updates: Array<{
        accountHead: string;
        cashflow?: string;
        cfHead?: string;
        activityType?: string;
        cfStatementLine?: string;
        plCategory?: string;
        plSign?: number;
        wipComponent?: string;
        wcBucket?: string;
        wcSign?: number;
        debtBucket?: string;
        kpiTag?: string;
      }> = req.body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: "No updates provided" });
      }
      let updated = 0;
      let inserted = 0;
      for (const u of updates) {
        if (!u.accountHead) continue;
        const existing = await db.select().from(cashflowMappingGroupings)
          .where(eq(cashflowMappingGroupings.accountHead, u.accountHead))
          .limit(1);
        if (existing.length > 0) {
          await db.update(cashflowMappingGroupings)
            .set({
              cashflow: u.cashflow || null,
              cfHead: u.cfHead || null,
              activityType: u.activityType || null,
              cfStatementLine: u.cfStatementLine || null,
              plCategory: u.plCategory || null,
              plSign: u.plSign ?? 0,
              wipComponent: u.wipComponent || null,
              wcBucket: u.wcBucket || null,
              wcSign: u.wcSign ?? 0,
              debtBucket: u.debtBucket || null,
              kpiTag: u.kpiTag || null,
            })
            .where(eq(cashflowMappingGroupings.accountHead, u.accountHead));
          updated++;
        } else {
          await db.insert(cashflowMappingGroupings).values({
            accountHead: u.accountHead,
            cashflow: u.cashflow || null,
            cfHead: u.cfHead || null,
            activityType: u.activityType || null,
            cfStatementLine: u.cfStatementLine || null,
            plCategory: u.plCategory || null,
            plSign: u.plSign ?? 0,
            wipComponent: u.wipComponent || null,
            wcBucket: u.wcBucket || null,
            wcSign: u.wcSign ?? 0,
            debtBucket: u.debtBucket || null,
            kpiTag: u.kpiTag || null,
          });
          inserted++;
        }
      }
      invalidateMappingCache();
      res.json({ message: `GL mapping updated: ${updated} updated, ${inserted} inserted`, updated, inserted });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/cashflow/update-entity-mapping", async (req, res) => {
    try {
      const updates: Array<{
        company: string;
        businessUnit?: string;
        structure?: string;
        projectName?: string;
        entityStatus?: string;
        remarks?: string;
      }> = req.body.updates;
      if (!Array.isArray(updates) || updates.length === 0) {
        return res.status(400).json({ message: "No updates provided" });
      }
      let updated = 0;
      let inserted = 0;
      for (const u of updates) {
        if (!u.company) continue;
        const existing = await db.select().from(cashflowMappingEntities)
          .where(eq(cashflowMappingEntities.companyNameErp, u.company))
          .limit(1);
        if (existing.length > 0) {
          await db.update(cashflowMappingEntities)
            .set({
              structure: u.structure || null,
              projectName: u.projectName || null,
              entityStatus: u.entityStatus || null,
              remarks: u.remarks || null,
            })
            .where(eq(cashflowMappingEntities.companyNameErp, u.company));
          updated++;
        } else {
          await db.insert(cashflowMappingEntities).values({
            companyName: u.company,
            companyNameErp: u.company,
            structure: u.structure || null,
            businessUnit: u.businessUnit || null,
            projectName: u.projectName || null,
            entityStatus: u.entityStatus || null,
            remarks: u.remarks || null,
          });
          inserted++;
        }
      }
      invalidateMappingCache();
      res.json({ message: `Entity mapping updated: ${updated} updated, ${inserted} inserted`, updated, inserted });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/cashflow/download-mapping", async (_req, res) => {
    try {
      const groupings = await db.select().from(cashflowMappingGroupings).orderBy(asc(cashflowMappingGroupings.accountHead));
      const entities = await db.select().from(cashflowMappingEntities).orderBy(asc(cashflowMappingEntities.companyNameErp));
      const pastLosses = await db.select().from(cashflowPastLosses);

      const wb = XLSX.utils.book_new();

      const gSheet = XLSX.utils.json_to_sheet(groupings.map(g => ({
        "Account Head": g.accountHead || "",
        "Cashflow": g.cashflow || "",
        "CF Head": g.cfHead || "",
        "Activity Type": g.activityType || "",
        "CF Statement Line": g.cfStatementLine || "",
        "P&L Category": g.plCategory || "",
        "P&L Sign": g.plSign ?? 0,
        "WIP Component": g.wipComponent || "",
        "WC Bucket": g.wcBucket || "",
        "WC Sign": g.wcSign ?? 0,
        "Debt Bucket": g.debtBucket || "",
        "KPI Tag": g.kpiTag || "",
      })));
      gSheet["!cols"] = [
        { wch: 40 }, { wch: 20 }, { wch: 30 }, { wch: 20 }, { wch: 25 },
        { wch: 20 }, { wch: 10 }, { wch: 20 }, { wch: 20 }, { wch: 10 },
        { wch: 20 }, { wch: 20 },
      ];
      XLSX.utils.book_append_sheet(wb, gSheet, "Groupings List");

      const eSheet = XLSX.utils.json_to_sheet(entities.map(e => ({
        "Company Name": e.companyName || "",
        "Company Name (ERP)": e.companyNameErp || "",
        "Structure": e.structure || "",
        "Business Unit": e.businessUnit || "",
        "Project Name": e.projectName || "",
        "Entity Status": e.entityStatus || "",
        "Remarks": e.remarks || "",
      })));
      eSheet["!cols"] = [{ wch: 40 }, { wch: 40 }, { wch: 20 }, { wch: 25 }, { wch: 30 }, { wch: 15 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, eSheet, "Entity List");

      const plSheet = XLSX.utils.json_to_sheet(pastLosses.map(r => ({
        "Company": r.company || "",
        "Project": r.project || "",
        "Cashflow": r.cashflow || "",
        "CF Head": r.cfHead || "",
        "Amount": r.amount || 0,
        "As Per FS": r.asPerFs || "",
        "Losses Upto": r.lossesUpto || "",
      })));
      plSheet["!cols"] = [{ wch: 40 }, { wch: 30 }, { wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 15 }, { wch: 15 }];
      XLSX.utils.book_append_sheet(wb, plSheet, "Past Losses");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", "attachment; filename=MIS_Mapping_File.xlsx");
      res.send(buf);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });
}
