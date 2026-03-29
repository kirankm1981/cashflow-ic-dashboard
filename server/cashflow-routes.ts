import type { Express } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { db } from "./db";
import {
  cashflowTbFiles,
  cashflowTbData,
  cashflowMappingGroupings,
  cashflowMappingEntities,
  cashflowPastLosses,
} from "@shared/schema";
import { eq, sql, asc } from "drizzle-orm";

const upload = multer({ storage: multer.memoryStorage() });

function normalizeText(val: string): string {
  let s = (val || "").trim();
  s = s.replace(/&amp;/gi, "&")
       .replace(/&lt;/gi, "<")
       .replace(/&gt;/gi, ">")
       .replace(/&quot;/gi, '"')
       .replace(/&#39;/gi, "'")
       .replace(/&apos;/gi, "'")
       .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code)))
       .replace(/&#x([0-9a-f]+);/gi, (_m, code) => String.fromCharCode(parseInt(code, 16)));
  s = s.replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ");
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
       .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
       .replace(/[\u2013\u2014]/g, "-");
  s = s.replace(/\s+/g, " ").trim();
  return s.toUpperCase();
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
  app.post("/api/cashflow/upload-tb", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const label = (req.body.label || "TB").trim();

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });

      const enterpriseRaw = String(allRows[1]?.[0] || "").trim();
      const enterprise = enterpriseRaw.replace(/^Enterprise\s*:\s*/i, "").trim();

      const periodRaw = String(allRows[4]?.[0] || "").trim();

      const headerRowIdx = 10;
      const dataRows = allRows.slice(headerRowIdx + 1);

      const lastRow = dataRows.length > 0 ? dataRows[dataRows.length - 1] : [];
      const isTotal = String(lastRow[0] || "").toLowerCase().startsWith("total");
      const rows = isTotal ? dataRows.slice(0, -1) : dataRows;
      const validRows = rows.filter(r => r[0] && String(r[0]).trim() !== "");

      const groupingMappings = await db.select().from(cashflowMappingGroupings);
      const entityMappings = await db.select().from(cashflowMappingEntities);

      const groupingMap = new Map<string, { cashflow: string | null; cfHead: string | null }>();
      for (const g of groupingMappings) {
        groupingMap.set(normalizeText(g.accountHead || ""), {
          cashflow: g.cashflow,
          cfHead: g.cfHead,
        });
      }

      const entityMap = new Map<string, { structure: string | null; projectName: string | null; entityStatus: string | null }>();
      for (const e of entityMappings) {
        entityMap.set(normalizeText(e.companyNameErp || ""), {
          structure: e.structure,
          projectName: e.projectName,
          entityStatus: e.entityStatus,
        });
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
          const entity = entityMap.get(normalizeText(company));

          return {
            tbFileId: tbFile.id,
            company,
            businessUnit: String(r[1] || "").trim(),
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
            structure: entity?.structure || null,
            projectName: entity?.projectName || null,
            entityStatus: entity?.entityStatus || null,
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
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/cashflow/upload-mapping", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });

      const findSheet = (target: string) => {
        const exact = wb.SheetNames.find(s => s === target);
        if (exact) return exact;
        const lower = target.toLowerCase().replace(/\s+/g, "");
        return wb.SheetNames.find(s => s.toLowerCase().replace(/\s+/g, "") === lower) || null;
      };

      let groupingsInserted = 0;
      let entitiesInserted = 0;
      let pastLossesInserted = 0;

      const groupingsSheet = findSheet("Groupings List");
      if (groupingsSheet) {
        await db.delete(cashflowMappingGroupings);
        const ws = wb.Sheets[groupingsSheet];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const dataRows = rows.slice(1).filter(r => String(r[0] || "").trim() !== "");
        const BATCH = 500;
        for (let i = 0; i < dataRows.length; i += BATCH) {
          const batch = dataRows.slice(i, i + BATCH);
          const values = batch.map(r => ({
            accountHead: String(r[0] || "").trim(),
            cashflow: String(r[1] || "").trim() || null,
            cfHead: String(r[2] || "").trim() || null,
          }));
          await db.insert(cashflowMappingGroupings).values(values);
          groupingsInserted += values.length;
        }
      }

      const entitySheet = findSheet("Entity List");
      if (entitySheet) {
        await db.delete(cashflowMappingEntities);
        const ws = wb.Sheets[entitySheet];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        const dataRows = rows.slice(1).filter(r => String(r[1] || "").trim() !== "");
        const BATCH = 500;
        for (let i = 0; i < dataRows.length; i += BATCH) {
          const batch = dataRows.slice(i, i + BATCH);
          const values = batch.map(r => ({
            companyName: String(r[0] || "").trim() || null,
            companyNameErp: String(r[1] || "").trim(),
            structure: String(r[2] || "").trim() || null,
            projectName: String(r[3] || "").trim() || null,
            entityStatus: String(r[4] || "").trim() || null,
            remarks: String(r[5] || "").trim() || null,
          }));
          await db.insert(cashflowMappingEntities).values(values);
          entitiesInserted += values.length;
        }
      }

      const pastLossesSheet = findSheet("Past Losses");
      if (pastLossesSheet) {
        await db.delete(cashflowPastLosses);
        const ws = wb.Sheets[pastLossesSheet];
        const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        console.log(`Past Losses sheet: ${rows.length} total rows`);
        console.log(`Past Losses first 5 rows:`, JSON.stringify(rows.slice(0, 5).map(r => [String(r[0]||""), String(r[1]||""), String(r[2]||""), String(r[3]||""), String(r[4]||"")])));
        const headerIdx = rows.findIndex(r => {
          const colA = String(r[0] || "").trim().toLowerCase().replace(/\s+/g, "");
          const colB = String(r[1] || "").trim().toLowerCase().replace(/\s+/g, "");
          return (colA.includes("company") || colA.includes("entity")) && (colB.includes("project") || colB.includes("name"));
        });
        console.log(`Past Losses header row index: ${headerIdx}`);
        if (headerIdx >= 0) {
          console.log(`Past Losses header row: ${JSON.stringify(rows[headerIdx])}`);
          const dataRows = rows.slice(headerIdx + 1).filter(r => String(r[0] || "").trim() !== "");
          console.log(`Past Losses data rows found: ${dataRows.length}`);
          const BATCH = 200;
          for (let i = 0; i < dataRows.length; i += BATCH) {
            const batch = dataRows.slice(i, i + BATCH);
            const values = batch.map(r => ({
              company: String(r[0] || "").trim() || null,
              project: String(r[1] || "").trim() || null,
              cashflow: String(r[2] || "").trim() || null,
              cfHead: String(r[3] || "").trim() || null,
              amount: parseNum(r[4]),
              asPerFs: String(r[5] || "").trim() || null,
              lossesUpto: excelDateToString(r[6]),
            }));
            await db.insert(cashflowPastLosses).values(values);
            pastLossesInserted += values.length;
          }
        }
      }

      console.log(`Mapping upload: sheets found = [${wb.SheetNames.join(", ")}]`);
      console.log(`Matched: groupings=${groupingsSheet || "NOT FOUND"}, entity=${entitySheet || "NOT FOUND"}, pastLosses=${pastLossesSheet || "NOT FOUND"}`);
      console.log(`Inserted: ${groupingsInserted} groupings, ${entitiesInserted} entities, ${pastLossesInserted} past losses`);

      res.json({
        message: `Mapping uploaded: ${groupingsInserted} groupings, ${entitiesInserted} entities, ${pastLossesInserted} past losses`,
        groupingsInserted,
        entitiesInserted,
        pastLossesInserted,
        sheetsFound: wb.SheetNames,
      });
    } catch (error: any) {
      console.error("Cashflow mapping upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/cashflow/tb-files", async (_req, res) => {
    try {
      const files = await db.select().from(cashflowTbFiles);
      res.json(files);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/cashflow/tb-file/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(cashflowTbData).where(eq(cashflowTbData.tbFileId, id));
      await db.delete(cashflowTbFiles).where(eq(cashflowTbFiles.id, id));
      res.json({ message: "Deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/cashflow/clear-tb", async (_req, res) => {
    try {
      await db.delete(cashflowTbData);
      await db.delete(cashflowTbFiles);
      res.json({ message: "All TB data cleared" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/cashflow/clear-mapping", async (_req, res) => {
    try {
      await db.delete(cashflowMappingGroupings);
      await db.delete(cashflowMappingEntities);
      await db.delete(cashflowPastLosses);
      res.json({ message: "Mapping data cleared" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/cashflow/mapping-summary", async (_req, res) => {
    try {
      const groupings = await db.select().from(cashflowMappingGroupings);
      const entities = await db.select().from(cashflowMappingEntities);
      const pastLosses = await db.select().from(cashflowPastLosses);
      res.json({
        hasMapping: groupings.length > 0 || entities.length > 0,
        groupings: groupings.length,
        entities: entities.length,
        pastLosses: pastLosses.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/cashflow/reprocess", async (_req, res) => {
    try {
      const groupingMappings = await db.select().from(cashflowMappingGroupings);
      const entityMappings = await db.select().from(cashflowMappingEntities);

      const groupingMap = new Map<string, { cashflow: string | null; cfHead: string | null }>();
      for (const g of groupingMappings) {
        groupingMap.set(normalizeText(g.accountHead || ""), {
          cashflow: g.cashflow,
          cfHead: g.cfHead,
        });
      }

      const entityMap = new Map<string, { structure: string | null; projectName: string | null; entityStatus: string | null }>();
      for (const e of entityMappings) {
        entityMap.set(normalizeText(e.companyNameErp || ""), {
          structure: e.structure,
          projectName: e.projectName,
          entityStatus: e.entityStatus,
        });
      }

      const BATCH = 500;
      const totalCount = await db.select({ count: sql<number>`count(*)` }).from(cashflowTbData);
      const total = Number(totalCount[0]?.count || 0);
      let updated = 0;

      for (let offset = 0; offset < total; offset += BATCH) {
        const batch = await db.select({
          id: cashflowTbData.id,
          company: cashflowTbData.company,
          accountHead: cashflowTbData.accountHead,
          cashflow: cashflowTbData.cashflow,
          cfHead: cashflowTbData.cfHead,
          structure: cashflowTbData.structure,
          projectName: cashflowTbData.projectName,
          entityStatus: cashflowTbData.entityStatus,
        }).from(cashflowTbData).orderBy(asc(cashflowTbData.id)).limit(BATCH).offset(offset);

        const updates: { id: number; cashflow: string | null; cfHead: string | null; structure: string | null; projectName: string | null; entityStatus: string | null }[] = [];

        for (const row of batch) {
          const grouping = groupingMap.get(normalizeText(row.accountHead || ""));
          const entity = entityMap.get(normalizeText(row.company || ""));

          const newCashflow = grouping?.cashflow || null;
          const newCfHead = grouping?.cfHead || null;
          const newStructure = entity?.structure || null;
          const newProjectName = entity?.projectName || null;
          const newEntityStatus = entity?.entityStatus || null;

          if (
            newCashflow !== row.cashflow ||
            newCfHead !== row.cfHead ||
            newStructure !== row.structure ||
            newProjectName !== row.projectName ||
            newEntityStatus !== row.entityStatus
          ) {
            updates.push({ id: row.id, cashflow: newCashflow, cfHead: newCfHead, structure: newStructure, projectName: newProjectName, entityStatus: newEntityStatus });
          }
        }

        for (const u of updates) {
          await db.update(cashflowTbData)
            .set({ cashflow: u.cashflow, cfHead: u.cfHead, structure: u.structure, projectName: u.projectName, entityStatus: u.entityStatus })
            .where(eq(cashflowTbData.id, u.id));
          updated++;
        }
      }

      res.json({ message: `Reprocessed ${updated} records`, updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/cashflow/past-losses", async (_req, res) => {
    try {
      const data = await db.select().from(cashflowPastLosses);
      res.json(data);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/cashflow/unified-data", async (_req, res) => {
    try {
      const entityMappings = await db.select().from(cashflowMappingEntities);
      const entityMap = new Map<string, { projectName: string | null; entityStatus: string | null }>();
      for (const e of entityMappings) {
        entityMap.set(normalizeText(e.companyNameErp || ""), {
          projectName: e.projectName,
          entityStatus: e.entityStatus,
        });
      }

      const entityKeys = new Set(entityMappings.map(e => normalizeText(e.companyNameErp || "")));

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
        .map(r => ({
          company: r.company,
          projectName: r.projectName,
          entityStatus: r.entityStatus,
          cashflow: r.cashflow,
          cfHead: r.cfHead,
          amount: Number(r.amount) || 0,
        }));
      const totalTbRaw = tbAgg.reduce((s, r) => s + Number(r.rowCount || 0), 0);
      const tbMappedEntityRows = tbAgg.filter(r => entityKeys.has(normalizeText(r.company || ""))).reduce((s, r) => s + Number(r.rowCount || 0), 0);
      const excludedTbCount = totalTbRaw - tbMappedEntityRows;

      const plRows = await db.select().from(cashflowPastLosses);
      const pastLossRows = plRows
        .filter(pl => entityKeys.has(normalizeText(pl.company || "")))
        .map(pl => {
          const entity = entityMap.get(normalizeText(pl.company || ""));
          return {
            company: pl.company || "",
            projectName: entity?.projectName || pl.project || null,
            entityStatus: entity?.entityStatus || null,
            cashflow: pl.cashflow || null,
            cfHead: pl.cfHead || null,
            amount: pl.amount || 0,
          };
        });

      const unified = [...tbRows, ...pastLossRows];
      res.json({
        data: unified,
        tbCount: totalTbRaw,
        pastLossesCount: pastLossRows.length,
        totalCount: unified.length,
        excludedCount: excludedTbCount,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/cashflow/unmapped-items", async (_req, res) => {
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
        accountHead: cashflowTbData.accountHead,
        netClosingBalance: sql<number>`sum(${cashflowTbData.netClosingBalance})`,
        count: sql<number>`count(*)`,
      }).from(cashflowTbData)
        .where(sql`(${cashflowTbData.projectName} IS NULL OR ${cashflowTbData.projectName} = '' OR ${cashflowTbData.entityStatus} IS NULL OR ${cashflowTbData.entityStatus} = '')`)
        .groupBy(cashflowTbData.company, cashflowTbData.accountHead);

      const unmappedAccountHeads = [...new Set(unmappedCfAgg.map(r => r.accountHead).filter(Boolean))];
      const unmappedCompanies = [...new Set(unmappedEntityAgg.map(r => r.company).filter(Boolean))];

      const cfTotalCount = unmappedCfAgg.reduce((s, r) => s + Number(r.count || 0), 0);
      const entityTotalCount = unmappedEntityAgg.reduce((s, r) => s + Number(r.count || 0), 0);

      let idCounter = 0;
      res.json({
        unmappedCashflow: {
          count: cfTotalCount,
          items: unmappedCfAgg.slice(0, 500).map((r) => ({
            id: ++idCounter,
            company: r.company,
            accountHead: r.accountHead,
            cashflow: null,
            cfHead: null,
            projectName: null,
            entityStatus: null,
            netClosingBalance: Number(r.netClosingBalance) || 0,
          })),
          uniqueAccountHeads: unmappedAccountHeads,
        },
        unmappedEntity: {
          count: entityTotalCount,
          items: unmappedEntityAgg.slice(0, 500).map((r) => ({
            id: ++idCounter,
            company: r.company,
            accountHead: r.accountHead,
            cashflow: null,
            cfHead: null,
            projectName: null,
            entityStatus: null,
            netClosingBalance: Number(r.netClosingBalance) || 0,
          })),
          uniqueCompanies: unmappedCompanies,
        },
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
