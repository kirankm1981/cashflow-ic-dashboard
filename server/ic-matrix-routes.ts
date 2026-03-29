import type { Express } from "express";
import multer from "multer";
import XLSX from "xlsx";
import { db } from "./db";
import { icMatrixTbFiles, icMatrixTbData, icMatrixMappingGl, icMatrixMappingCompany } from "@shared/schema";
import { eq, sql } from "drizzle-orm";

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
  app.post("/api/ic-matrix/upload-tb", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const label = (req.body.label || "TB").trim();
      const userPeriodStart = (req.body.periodStart || "").trim();
      const userPeriodEnd = (req.body.periodEnd || "").trim();

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });

      const enterpriseRaw = String(allRows[1]?.[1] || allRows[1]?.[0] || "").trim();
      const enterpriseCleaned = enterpriseRaw.replace(/^(Enterprise|Company)\s*:\s*/i, "").trim();
      const enterprise = mapTbSourceName(enterpriseCleaned);

      let periodInfo = parsePeriodFromCell(String(allRows[4]?.[0] || ""));
      if (userPeriodStart && userPeriodEnd) {
        periodInfo.start = userPeriodStart;
        periodInfo.end = userPeriodEnd;
        periodInfo.period = `From ${userPeriodStart} To ${userPeriodEnd}`;
      }

      const dataRows = allRows.slice(11);

      const lastRow = dataRows.length > 0 ? dataRows[dataRows.length - 1] : [];
      const isTotal = String(lastRow[0] || "").toLowerCase().startsWith("total");
      const rows = isTotal ? dataRows.slice(0, -1) : dataRows;

      const validRows = rows.filter(r => r[0] && String(r[0]).trim() !== "");

      const [tbFile] = await db.insert(icMatrixTbFiles).values({
        fileName: req.file.originalname,
        label,
        enterprise,
        period: periodInfo.period,
        periodStart: periodInfo.start,
        periodEnd: periodInfo.end,
        totalRecords: validRows.length,
      }).returning();

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

          let glMatch = subAccountHead ? glMap.get(normalizeText(subAccountHead)) : undefined;
          if (!glMatch) {
            glMatch = accountHead ? glMap.get(normalizeText(accountHead)) : undefined;
          }
          const newCoaGlName = glMatch ? glMatch.newCoaGlName : accountHead;
          const icCounterParty = glMatch ? glMatch.icCounterParty : null;
          const icCounterPartyCode = glMatch ? glMatch.icCounterPartyCode : null;
          const icTxnType = glMatch ? glMatch.icTxnType : null;

          const companyCode = companyMap.get(normalizeText(company)) || null;

          return {
            tbFileId: tbFile.id,
            company,
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
            openingDebit: parseNum(r[12]),
            openingCredit: parseNum(r[13]),
            periodDebit: parseNum(r[14]),
            periodCredit: parseNum(r[15]),
            closingDebit,
            closingCredit,
            netBalance,
            newCoaGlName,
            icCounterParty,
            icCounterPartyCode,
            icTxnType,
            companyCode,
            tbSource: enterprise,
          };
        });

        await db.insert(icMatrixTbData).values(values);
        inserted += values.length;
      }

      res.json({
        tbFileId: tbFile.id,
        fileName: req.file.originalname,
        label,
        enterprise,
        period: periodInfo.period,
        periodStart: periodInfo.start,
        periodEnd: periodInfo.end,
        recordsInserted: inserted,
      });
    } catch (error: any) {
      console.error("TB upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ic-matrix/upload-mapping", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });

      let glCount = 0;
      let companyCount = 0;

      const glSheet = wb.Sheets["IC-GL-Mapping"];
      if (glSheet) {
        await db.delete(icMatrixMappingGl);
        const glRows: any[][] = XLSX.utils.sheet_to_json(glSheet, { header: 1, range: 0, defval: "" });
        const glDataRows = glRows.slice(1).filter(r => r[0] && String(r[0]).trim() !== "");

        const batchSize = 500;
        for (let i = 0; i < glDataRows.length; i += batchSize) {
          const batch = glDataRows.slice(i, i + batchSize);
          const values = batch.map(r => ({
            glName: String(r[0] || "").trim(),
            newCoaGlName: String(r[1] || "").trim() || null,
            icCounterParty: String(r[2] || "").trim() || null,
            icCounterPartyCode: String(r[3] || "").trim() || null,
            icTxnType: String(r[4] || "").trim() || null,
          }));
          await db.insert(icMatrixMappingGl).values(values);
          glCount += values.length;
        }
      }

      const ccSheet = wb.Sheets["Company_Code"];
      if (ccSheet) {
        await db.delete(icMatrixMappingCompany);
        const ccRows: any[][] = XLSX.utils.sheet_to_json(ccSheet, { header: 1, range: 0, defval: "" });
        const ccDataRows = ccRows.slice(1).filter(r => r[1] && String(r[1]).trim() !== "");

        const batchSize = 500;
        for (let i = 0; i < ccDataRows.length; i += batchSize) {
          const batch = ccDataRows.slice(i, i + batchSize);
          const values = batch.map(r => ({
            companyName: String(r[0] || "").trim() || null,
            companyNameErp: String(r[1] || "").trim(),
            companyCode: String(r[2] || "").trim(),
          }));
          await db.insert(icMatrixMappingCompany).values(values);
          companyCount += values.length;
        }
      }

      res.json({
        fileName: req.file.originalname,
        glMappings: glCount,
        companyMappings: companyCount,
        sheets: wb.SheetNames,
      });
    } catch (error: any) {
      console.error("Mapping upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ic-matrix/reprocess", async (_req, res) => {
    try {
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

      const allData = await db.select().from(icMatrixTbData);
      let updated = 0;

      for (const row of allData) {
        let glMatch = row.subAccountHead ? glMap.get(normalizeText(row.subAccountHead)) : undefined;
        if (!glMatch) {
          glMatch = row.accountHead ? glMap.get(normalizeText(row.accountHead)) : undefined;
        }
        const newCoaGlName = glMatch ? glMatch.newCoaGlName : row.accountHead;
        const icCounterParty = glMatch ? glMatch.icCounterParty : null;
        const icCounterPartyCode = glMatch ? glMatch.icCounterPartyCode : null;
        const icTxnType = glMatch ? glMatch.icTxnType : null;
        const companyCode = companyMap.get(normalizeText(row.company || "")) || null;

        await db.update(icMatrixTbData)
          .set({ newCoaGlName, icCounterParty, icCounterPartyCode, icTxnType, companyCode })
          .where(eq(icMatrixTbData.id, row.id));
        updated++;
      }

      res.json({ updated });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ic-matrix/tb-files", async (_req, res) => {
    try {
      const files = await db.select().from(icMatrixTbFiles);
      res.json(files);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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

      const conditions = [sql`${icMatrixTbData.newCoaGlName} LIKE 'IC_%'`];
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
      res.status(500).json({ message: error.message });
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
      res.status(500).json({ message: error.message });
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
      res.status(500).json({ message: error.message });
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
        "TB Source"
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
        r.tbSource || fileMap.get(r.tbFileId) || "",
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

      res.setHeader("Content-Disposition", "attachment; filename=IC_Matrix_Compiled_TB.xlsx");
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.send(buf);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/ic-matrix/tb-file/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await db.delete(icMatrixTbData).where(eq(icMatrixTbData.tbFileId, id));
      await db.delete(icMatrixTbFiles).where(eq(icMatrixTbFiles.id, id));
      res.json({ deleted: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
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
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ic-matrix/clear", async (_req, res) => {
    try {
      await db.delete(icMatrixTbData);
      await db.delete(icMatrixTbFiles);
      await db.delete(icMatrixMappingGl);
      await db.delete(icMatrixMappingCompany);
      res.json({ cleared: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ic-matrix/clear-tb", async (_req, res) => {
    try {
      await db.delete(icMatrixTbData);
      await db.delete(icMatrixTbFiles);
      res.json({ cleared: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ic-matrix/clear-mapping", async (_req, res) => {
    try {
      await db.delete(icMatrixMappingGl);
      await db.delete(icMatrixMappingCompany);
      res.json({ cleared: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
