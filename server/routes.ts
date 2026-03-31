import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { runReconciliation } from "./reconciliation-engine";
import { runMlAnalysis, learnFromManualMatch, learnFromUnmatch, enhancedNarrationSimilarity } from "./ml-engine";
import { registerIcMatrixRoutes } from "./ic-matrix-routes";
import { registerCashflowRoutes } from "./cashflow-routes";
import multer from "multer";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { eq } from "drizzle-orm";
import type { InsertTransaction, InsertSummarizedLine } from "@shared/schema";
import { icReconGlFiles, icReconGlRawRows, icMatrixMappingGl, icMatrixMappingCompany, loginSchema } from "@shared/schema";
import { randomUUID } from "crypto";
import path from "path";

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
import { existsSync } from "fs";
import bcrypt from "bcryptjs";

async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const user = await storage.getUserById(req.session.userId);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Not authenticated" });
  }
  req.session.role = user.role;
  next();
}

async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  const user = await storage.getUserById(req.session.userId);
  if (!user || !user.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (user.role !== "platform_admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  req.session.role = user.role;
  next();
}

function parseFileToRecords(buffer: Buffer, filename: string, selectedSheet?: string): Record<string, string>[] {
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    return jsonRows.map(row => {
      const stringRow: Record<string, string> = {};
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val != null ? String(val) : "";
      }
      return stringRow;
    });
  }
  const content = buffer.toString("utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });
}

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.post("/api/auth/login", async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const { username, password } = parsed.data;
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      if (!user.active) {
        return res.status(403).json({ message: "Account is disabled. Contact your administrator." });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      const userData = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
      };
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ message: "Session error" });
        }
        req.session.userId = user.id;
        req.session.role = user.role;
        res.json(userData);
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUserById(req.session.userId);
    if (!user || !user.active) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
    });
  });

  app.get("/api/users", requireAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json(allUsers.map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        active: u.active,
        createdAt: u.createdAt,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, displayName, role } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (role && !["platform_admin", "recon_user"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 10);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: role || "recon_user",
      });
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates: any = {};
      if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
      if (req.body.role !== undefined) {
        if (!["platform_admin", "recon_user"].includes(req.body.role)) {
          return res.status(400).json({ message: "Invalid role" });
        }
        updates.role = req.body.role;
      }
      if (req.body.active !== undefined) updates.active = req.body.active;
      if (req.body.password) {
        updates.password = await bcrypt.hash(req.body.password, 10);
      }
      const user = await storage.updateUser(id, updates);
      if (!user) return res.status(404).json({ message: "User not found" });
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (id === req.session?.userId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      await storage.deleteUser(id);
      res.json({ message: "User deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password required" });
      }
      const user = await storage.getUserById(req.session!.userId!);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
      const hashed = await bcrypt.hash(newPassword, 10);
      await storage.updateUser(user.id, { password: hashed });
      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.use("/api", (req, res, next) => {
    if (req.path.startsWith("/auth/")) return next();
    requireAuth(req, res, next);
  });

  app.get("/api/download-package", (_req, res) => {
    const filePath = path.resolve("ic-recon-full.tar.gz");
    if (existsSync(filePath)) {
      res.download(filePath, "ic-recon-full.tar.gz");
    } else {
      res.status(404).json({ message: "Package not found. Generate it first." });
    }
  });

  app.get("/api/transactions", async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.company) filters.company = req.query.company as string;
      if (req.query.counterParty) filters.counterParty = req.query.counterParty as string;
      if (req.query.reconStatus) filters.reconStatus = req.query.reconStatus as string;
      if (req.query.uploadBatchId) filters.uploadBatchId = req.query.uploadBatchId as string;
      const txns = await storage.getTransactions(filters);
      res.json(txns);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/transactions/:id", async (req, res) => {
    try {
      const txn = await storage.getTransactionById(parseInt(req.params.id));
      if (!txn) return res.status(404).json({ message: "Transaction not found" });
      res.json(txn);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/upload/sheet-names", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const ext = (req.file.originalname || "").toLowerCase().split(".").pop();
      if (ext !== "xlsx" && ext !== "xls") {
        return res.json({ sheetNames: [] });
      }
      const workbook = XLSX.read(req.file.buffer, { type: "buffer", bookSheets: true });
      res.json({ sheetNames: workbook.SheetNames || [] });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/upload/preview-headers", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const ext = (req.file.originalname || "").toLowerCase().split(".").pop();
      const selectedSheet = req.body?.sheetName || null;
      let records: Record<string, string>[];
      if (ext === "xlsx" || ext === "xls") {
        const workbook = XLSX.read(req.file.buffer, { type: "buffer", sheetRows: 5 });
        const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
          ? selectedSheet
          : workbook.SheetNames[0];
        if (!sheetName) throw new Error("Excel file has no sheets");
        const sheet = workbook.Sheets[sheetName];
        const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
        records = jsonRows.map(row => {
          const stringRow: Record<string, string> = {};
          for (const [key, val] of Object.entries(row)) {
            stringRow[key] = val != null ? String(val) : "";
          }
          return stringRow;
        });
      } else {
        const content = req.file.buffer.toString("utf-8");
        records = parse(content, {
          columns: true, skip_empty_lines: true, trim: true,
          relax_column_count: true, relax_quotes: true, to: 5,
        });
      }
      const headers = records.length > 0 ? Object.keys(records[0]) : [];
      res.json({ headers, sampleRows: records.slice(0, 3) });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const batchId = randomUUID();

      const columnMapping = req.body.columnMapping ? JSON.parse(req.body.columnMapping) : null;
      const selectedSheet = req.body.sheetName || undefined;

      const records = parseFileToRecords(req.file.buffer, req.file.originalname, selectedSheet);

      if (records.length === 0) {
        return res.status(400).json({ message: "File contains no data rows" });
      }

      const headers = Object.keys(records[0]);
      console.log("CSV headers detected:", headers);

      function findCol(row: any, mapping: any, field: string, ...candidates: string[]): string {
        if (mapping && mapping[field]) {
          return row[mapping[field]] ?? "";
        }
        for (const c of candidates) {
          if (row[c] !== undefined && row[c] !== null) return row[c];
        }
        const lowerCandidates = candidates.map(c => c.toLowerCase());
        for (const key of Object.keys(row)) {
          const lk = key.toLowerCase().trim();
          if (lowerCandidates.includes(lk)) return row[key];
        }
        for (const key of Object.keys(row)) {
          const lk = key.toLowerCase().trim().replace(/[^a-z0-9]/g, "");
          for (const c of candidates) {
            const lc = c.toLowerCase().replace(/[^a-z0-9]/g, "");
            if (lk === lc || lk.includes(lc) || lc.includes(lk)) return row[key];
          }
        }
        return "";
      }

      function findNumCol(row: any, mapping: any, field: string, ...candidates: string[]): number {
        const val = findCol(row, mapping, field, ...candidates);
        let cleaned = String(val).replace(/,/g, "").trim();
        const isNegative = cleaned.startsWith("(") && cleaned.endsWith(")");
        if (isNegative) {
          cleaned = cleaned.slice(1, -1);
        }
        const num = parseFloat(cleaned) || 0;
        return isNegative ? -num : num;
      }

      const txns: InsertTransaction[] = records.map((r: any) => {
        const debit = findNumCol(r, columnMapping, "debit", "Debit", "debit", "Dr", "Dr Amount", "Debit Amount");
        const credit = findNumCol(r, columnMapping, "credit", "Credit", "credit", "Cr", "Cr Amount", "Credit Amount");
        const netAmount = findNumCol(r, columnMapping, "netAmount", "Net Amount", "net_amount", "Net", "Amount", "Balance");

        return {
          uploadBatchId: batchId,
          company: findCol(r, columnMapping, "company", "Company", "company", "Company Name", "Entity", "Entity Name", "From Company", "From Entity", "Comp Name", "IC Company").trim(),
          counterParty: findCol(r, columnMapping, "counterParty", "Counter Party", "counter_party", "Counterparty", "Counter Party Name", "To Company", "To Entity", "IC Partner", "Partner Company", "Other Entity").trim(),
          businessUnit: findCol(r, columnMapping, "businessUnit", "Business Unit", "business_unit", "BU") || null,
          accountHead: findCol(r, columnMapping, "accountHead", "Account Head", "account_head", "Account", "GL Account", "GL Head") || null,
          subAccountHead: findCol(r, columnMapping, "subAccountHead", "Sub Account Head", "sub_account_head", "Sub Account") || null,
          debit,
          credit,
          netAmount: netAmount || (debit - credit),
          documentNo: findCol(r, columnMapping, "documentNo", "Document No", "document_no", "Doc No", "Document Number", "Invoice No", "Invoice Number", "Voucher No", "Reference No", "Ref No", "GL Doc No").trim() || null,
          docDate: findCol(r, columnMapping, "docDate", "Doc Date", "doc_date", "Document Date", "Date", "Transaction Date", "Txn Date", "Posting Date", "Invoice Date", "Voucher Date").trim() || null,
          narration: findCol(r, columnMapping, "narration", "Narration", "narration", "Description", "Remarks", "Particulars", "Details", "Memo", "Notes").trim() || null,
          icGl: findCol(r, columnMapping, "icGl", "IC GL", "ic_gl", "IC Account", "IC Ledger", "Intercompany GL").trim() || null,
          reconStatus: "unmatched",
          reconId: null,
          reconRule: null,
        };
      });

      const emptyCompanyCount = txns.filter(t => !t.company).length;
      const emptyCounterPartyCount = txns.filter(t => !t.counterParty).length;

      if (emptyCompanyCount === txns.length) {
        console.warn("WARNING: All rows have empty Company. CSV headers:", headers);
        return res.status(400).json({
          message: "Could not detect the Company column in your CSV file.",
          detectedHeaders: headers,
          suggestion: "Please re-upload with column mapping. Expected a column like 'Company', 'Entity', or 'Company Name'.",
        });
      }

      const inserted = await storage.insertTransactions(txns);

      await storage.insertUploadBatch({
        batchId,
        fileName: req.file.originalname || "upload.csv",
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

      const warnings: string[] = [];
      if (emptyCompanyCount > 0) warnings.push(`${emptyCompanyCount} rows had empty Company`);
      if (emptyCounterPartyCount > 0) warnings.push(`${emptyCounterPartyCount} rows had empty Counter Party`);

      res.json({
        batchId,
        totalRecords: inserted.length,
        summarizedLines: insertedLines.length,
        fileName: req.file.originalname,
        detectedHeaders: headers,
        warnings,
      });
    } catch (error: any) {
      console.error("Upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/transactions/clear", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { transactions, summarizedLines, uploadBatches, reconciliationGroups } = await import("@shared/schema");
      await db.delete(transactions);
      await db.delete(summarizedLines);
      await db.delete(reconciliationGroups);
      await db.delete(uploadBatches);
      await db.delete(icReconGlRawRows);
      await db.delete(icReconGlFiles);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/rules/reset", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { reconciliationRules } = await import("@shared/schema");
      await db.delete(reconciliationRules);
      const { seedDefaultRules } = await import("./seed");
      await seedDefaultRules();
      const rules = await storage.getActiveRules();
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/summarized-lines", async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.companies) {
        const compList = (req.query.companies as string).split(",").map((s: string) => s.trim()).filter(Boolean);
        if (compList.length > 0) filters.companies = compList;
      } else if (req.query.company) {
        filters.company = req.query.company as string;
      }
      if (req.query.counterParty) {
        const cp = req.query.counterParty as string;
        if (cp.includes(",")) {
          filters.counterParties = cp.split(",").map((s: string) => s.trim()).filter(Boolean);
        } else {
          filters.counterParty = cp;
        }
      }
      if (req.query.reconStatus) filters.reconStatus = req.query.reconStatus as string;
      if (req.query.reconId) filters.reconId = req.query.reconId as string;
      const lines = await storage.getSummarizedLines(filters);
      res.json(lines);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/reconcile", async (_req, res) => {
    try {
      const result = await runReconciliation();
      res.json(result);
    } catch (error: any) {
      console.error("Reconciliation error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/manual-reconcile", async (req, res) => {
    try {
      const { transactionIds } = req.body;
      if (!transactionIds || !Array.isArray(transactionIds) || transactionIds.length < 2) {
        return res.status(400).json({ message: "At least 2 line IDs required" });
      }
      const lines = await storage.getSummarizedLinesByIds(transactionIds);
      const alreadyMatched = lines.filter(t => t.reconStatus === "matched");
      if (alreadyMatched.length > 0) {
        return res.status(400).json({ message: `${alreadyMatched.length} line(s) are already matched` });
      }
      const totalPos = lines.reduce((s, t) => s + Math.max(t.netAmount || 0, 0), 0);
      const totalNeg = Math.abs(lines.reduce((s, t) => s + Math.min(t.netAmount || 0, 0), 0));
      if (totalPos <= 0 || totalNeg <= 0 || Math.abs(totalPos - totalNeg) >= 0.01) {
        return res.status(400).json({ message: `Amounts do not balance: debits (${totalPos.toFixed(2)}) must equal credits (${totalNeg.toFixed(2)})` });
      }
      const groups = await storage.getReconGroups();
      let maxNum = 0;
      for (const g of groups) {
        const m = g.reconId.match(/^REC-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }
      const reconId = `REC-${String(maxNum + 1).padStart(4, "0")}`;
      let totalDebit = 0;
      let totalCredit = 0;
      for (const t of lines) {
        const amt = t.netAmount || 0;
        if (amt > 0) totalDebit += amt;
        else totalCredit += Math.abs(amt);
      }
      await storage.updateSummarizedLineRecon(transactionIds, reconId, "Manual Match", "matched");
      await storage.insertReconGroup({
        reconId,
        ruleName: "Manual Match",
        totalDebit,
        totalCredit,
        transactionCount: transactionIds.length,
        status: "matched",
      });
      learnFromManualMatch(transactionIds).catch(err => console.error("[ML] Learn error:", err));
      res.json({ reconId, matched: transactionIds.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/unmatch", async (req, res) => {
    try {
      const { reconId } = req.body;
      if (!reconId) {
        return res.status(400).json({ message: "reconId is required" });
      }
      const lines = await storage.getSummarizedLines({ reconId });
      const lineIds = lines.map(l => l.id);
      const count = await storage.unmatchReconGroup(reconId);
      if (count === 0) {
        return res.status(404).json({ message: `No transactions found for ${reconId}` });
      }
      learnFromUnmatch(reconId, lineIds).catch(err => console.error("[ML] Unlearn error:", err));
      res.json({ reconId, unmatched: count });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/rules", requireAdmin, async (_req, res) => {
    try {
      const rules = await storage.getRules();
      res.json(rules);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/rules", requireAdmin, async (req, res) => {
    try {
      const { name, ruleType, priority, active, description, ruleId, matchType, dateTolerance, amountTolerance, amountTolerancePct, confidence, classification, params } = req.body;
      if (!name || !ruleType || priority === undefined) {
        return res.status(400).json({ message: "name, ruleType, and priority are required" });
      }
      const rule = await storage.insertRule({
        ruleId: ruleId || `IC-R${priority}`,
        name,
        ruleType,
        matchType: matchType || "1:1",
        priority: parseInt(priority),
        dateTolerance: dateTolerance !== null && dateTolerance !== undefined ? parseFloat(dateTolerance) : null,
        amountTolerance: amountTolerance !== null && amountTolerance !== undefined ? parseFloat(amountTolerance) : 5,
        amountTolerancePct: amountTolerancePct !== null && amountTolerancePct !== undefined ? parseFloat(amountTolerancePct) : 0,
        confidence: confidence || "real_match",
        classification: classification || "AUTO_MATCH",
        active: active ?? true,
        description: description || null,
        params: params || null,
      });
      res.json(rule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/rules/:id", requireAdmin, async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) return res.status(400).json({ message: "Invalid rule ID" });
      const updates: any = {};
      if (req.body.name !== undefined) updates.name = req.body.name;
      if (req.body.ruleType !== undefined) updates.ruleType = req.body.ruleType;
      if (req.body.priority !== undefined) updates.priority = parseInt(req.body.priority);
      if (req.body.active !== undefined) updates.active = req.body.active;
      if (req.body.description !== undefined) updates.description = req.body.description;
      if (req.body.ruleId !== undefined) updates.ruleId = req.body.ruleId;
      if (req.body.matchType !== undefined) updates.matchType = req.body.matchType;
      if (req.body.dateTolerance !== undefined) updates.dateTolerance = req.body.dateTolerance !== null ? parseFloat(req.body.dateTolerance) : null;
      if (req.body.amountTolerance !== undefined) updates.amountTolerance = req.body.amountTolerance !== null ? parseFloat(req.body.amountTolerance) : 0;
      if (req.body.amountTolerancePct !== undefined) updates.amountTolerancePct = req.body.amountTolerancePct !== null ? parseFloat(req.body.amountTolerancePct) : 0;
      if (req.body.confidence !== undefined) updates.confidence = req.body.confidence;
      if (req.body.classification !== undefined) updates.classification = req.body.classification;
      if (req.body.params !== undefined) updates.params = req.body.params;
      const rule = await storage.updateRule(id, updates);
      if (!rule) return res.status(404).json({ message: "Rule not found" });
      res.json(rule);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/rules/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteRule(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/dashboard", async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/company-name-map", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const mappings = await db.select().from(icMatrixMappingCompany);
      const map: Record<string, string> = {};
      for (const m of mappings) {
        map[m.companyCode] = m.companyName || m.companyNameErp;
      }
      res.json(map);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/companies", async (_req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/counterparties", async (_req, res) => {
    try {
      const counterParties = await storage.getCounterParties();
      res.json(counterParties);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/upload-batches", async (_req, res) => {
    try {
      const batches = await storage.getUploadBatches();
      res.json(batches);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/company-pairs", async (_req, res) => {
    try {
      const pairs = await storage.getCompanyPairs();
      res.json(pairs);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/recon-groups", async (_req, res) => {
    try {
      const groups = await storage.getReconGroups();
      res.json(groups);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/export/excel", async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.companies) {
        const compList = (req.query.companies as string).split(",").map((s: string) => s.trim()).filter(Boolean);
        if (compList.length > 0) filters.companies = compList;
      } else if (req.query.company) {
        filters.company = req.query.company as string;
      }
      if (req.query.counterParty) {
        const cp = req.query.counterParty as string;
        if (cp.includes(",")) {
          filters.counterParties = cp.split(",").map((s: string) => s.trim()).filter(Boolean);
        } else {
          filters.counterParty = cp;
        }
      }
      if (req.query.reconStatus) filters.reconStatus = req.query.reconStatus as string;

      const lines = await storage.getSummarizedLines(filters);

      const rows = lines.map(l => ({
        "Company": l.company,
        "Counter Party": l.counterParty,
        "Document No": l.documentNo || "",
        "Doc Date": l.docDate || "",
        "Net Amount": l.netAmount || 0,
        "Txn Count": l.transactionCount || 1,
        "IC GL": l.icGl || "",
        "Narration": l.narration || "",
        "Status": l.reconStatus,
        "Recon ID": l.reconId || "",
        "Rule": l.reconRule || "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reconciliation");

      const colWidths = [
        { wch: 25 }, { wch: 25 }, { wch: 18 }, { wch: 12 },
        { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 40 },
        { wch: 12 }, { wch: 12 }, { wch: 20 },
      ];
      ws["!cols"] = colWidths;

      const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const company = (req.query.company as string) || "all";
      const counterParty = (req.query.counterParty as string) || "all";
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `recon_${company}_${counterParty}_${dateStr}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(xlsxBuffer));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/export/reconciliation-template", async (req, res) => {
    try {
      const filters: any = {};
      if (req.query.companies) {
        const compList = (req.query.companies as string).split(",").map((s: string) => s.trim()).filter(Boolean);
        if (compList.length > 0) filters.companies = compList;
      } else if (req.query.company) {
        filters.company = req.query.company as string;
      }
      if (req.query.counterParty) {
        const cp = req.query.counterParty as string;
        if (cp.includes(",")) {
          filters.counterParties = cp.split(",").map((s: string) => s.trim()).filter(Boolean);
        } else {
          filters.counterParty = cp;
        }
      }
      if (req.query.reconStatus) filters.reconStatus = req.query.reconStatus as string;

      const lines = await storage.getSummarizedLines(filters);

      const rows = lines.map(l => ({
        "Line ID": l.id,
        "Company": l.company,
        "Counter Party": l.counterParty,
        "Document No": l.documentNo || "",
        "Doc Date": l.docDate || "",
        "Net Amount": l.netAmount || 0,
        "Narration": l.narration || "",
        "Status": l.reconStatus,
        "Current Rec ID": l.reconId || "",
        "User Rec ID": "",
      }));

      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Reconciliation Template");

      ws["!cols"] = [
        { wch: 8 }, { wch: 25 }, { wch: 25 }, { wch: 18 }, { wch: 12 },
        { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
      ];

      const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `recon_template_${dateStr}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(xlsxBuffer));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/upload/reconciliation", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows: any[] = XLSX.utils.sheet_to_json(ws);

      const groupedByRecId = new Map<string, number[]>();
      for (const row of rows) {
        const userRecId = (row["User Rec ID"] || "").toString().trim();
        const lineId = parseInt(row["Line ID"]);
        if (!userRecId || isNaN(lineId)) continue;
        if (!groupedByRecId.has(userRecId)) groupedByRecId.set(userRecId, []);
        groupedByRecId.get(userRecId)!.push(lineId);
      }

      if (groupedByRecId.size === 0) {
        return res.status(400).json({ message: "No valid User Rec ID entries found in the uploaded file. Please fill in the 'User Rec ID' column." });
      }

      const allLineIds = new Set<number>();
      const duplicateLineIds: number[] = [];
      for (const [, ids] of groupedByRecId) {
        for (const id of ids) {
          if (allLineIds.has(id)) duplicateLineIds.push(id);
          allLineIds.add(id);
        }
      }
      if (duplicateLineIds.length > 0) {
        return res.status(400).json({ message: `Line IDs appear in multiple groups: ${duplicateLineIds.join(", ")}. Each line can only belong to one User Rec ID.` });
      }

      const allLines = await storage.getSummarizedLines({});
      const lineMap = new Map(allLines.map(l => [l.id, l]));

      let totalMatched = 0;
      let groupsCreated = 0;
      const errors: string[] = [];

      const existingGroups = await storage.getReconGroups();
      let maxNum = 0;
      for (const g of existingGroups) {
        const m = g.reconId.match(/^REC-(\d+)$/);
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > maxNum) maxNum = n;
        }
      }

      for (const [userRecId, lineIds] of groupedByRecId) {
        if (lineIds.length < 2) {
          errors.push(`${userRecId}: needs at least 2 transactions`);
          continue;
        }

        const lines = lineIds.map(id => lineMap.get(id)).filter(Boolean) as any[];
        if (lines.length !== lineIds.length) {
          errors.push(`${userRecId}: some Line IDs not found`);
          continue;
        }

        let totalDebit = 0;
        let totalCredit = 0;
        for (const t of lines) {
          const amt = t.netAmount || 0;
          if (amt > 0) totalDebit += amt;
          else totalCredit += Math.abs(amt);
        }

        maxNum++;
        const reconId = `REC-${String(maxNum).padStart(4, "0")}`;

        await storage.updateSummarizedLineRecon(lineIds, reconId, `Manual Upload (${userRecId})`, "matched");
        await storage.insertReconGroup({
          reconId,
          ruleName: `Manual Upload (${userRecId})`,
          totalDebit,
          totalCredit,
          transactionCount: lineIds.length,
          status: "matched",
        });

        totalMatched += lineIds.length;
        groupsCreated++;
      }

      res.json({
        message: `Uploaded successfully: ${groupsCreated} groups created, ${totalMatched} transactions matched`,
        groupsCreated,
        totalMatched,
        errors: errors.length > 0 ? errors : undefined,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ml/analyze", async (_req, res) => {
    try {
      const result = await runMlAnalysis();
      res.json(result);
    } catch (error: any) {
      console.error("ML analysis error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/suggestions", async (req, res) => {
    try {
      const status = req.query.status as string | undefined;
      const suggestions = await storage.getMlSuggestions(status || "pending");
      const lineIds = new Set<number>();
      for (const s of suggestions) {
        lineIds.add(s.lineIdA);
        lineIds.add(s.lineIdB);
      }
      const lines = await storage.getSummarizedLinesByIds(Array.from(lineIds));
      const lineMap = new Map(lines.map(l => [l.id, l]));
      const enriched = suggestions.map(s => ({
        ...s,
        lineA: lineMap.get(s.lineIdA) || null,
        lineB: lineMap.get(s.lineIdB) || null,
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ml/suggestions/:id/accept", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const suggestions = await storage.getMlSuggestions("pending");
      const suggestion = suggestions.find(s => s.id === id);
      if (!suggestion) return res.status(404).json({ message: "Suggestion not found" });

      const lines = await storage.getSummarizedLinesByIds([suggestion.lineIdA, suggestion.lineIdB]);
      if (lines.length !== 2) return res.status(400).json({ message: "Lines not found" });

      const nonUnmatched = lines.filter(l => l.reconStatus !== "unmatched");
      if (nonUnmatched.length > 0) {
        await storage.updateMlSuggestionStatus(id, "rejected");
        return res.status(400).json({ message: "One or both lines are no longer unmatched. Suggestion auto-rejected." });
      }

      const groups = await storage.getReconGroups();
      let maxNum = 0;
      for (const g of groups) {
        const m = g.reconId.match(/^REC-(\d+)$/);
        if (m) { const n = parseInt(m[1], 10); if (n > maxNum) maxNum = n; }
      }
      const reconId = `REC-${String(maxNum + 1).padStart(4, "0")}`;

      let totalDebit = 0, totalCredit = 0;
      for (const t of lines) {
        const amt = t.netAmount || 0;
        if (amt > 0) totalDebit += amt;
        else totalCredit += Math.abs(amt);
      }

      await storage.updateSummarizedLineRecon([suggestion.lineIdA, suggestion.lineIdB], reconId, "ML Suggestion", "matched");
      await storage.insertReconGroup({
        reconId,
        ruleName: "ML Suggestion",
        totalDebit,
        totalCredit,
        transactionCount: 2,
        status: "matched",
      });
      await storage.updateMlSuggestionStatus(id, "accepted");
      learnFromManualMatch([suggestion.lineIdA, suggestion.lineIdB]).catch(() => {});

      res.json({ reconId, matched: 2 });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ml/suggestions/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.updateMlSuggestionStatus(id, "rejected");
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/anomalies", async (req, res) => {
    try {
      const resolved = req.query.resolved === "true" ? true : req.query.resolved === "false" ? false : undefined;
      const anomalies = await storage.getAnomalyFlags(resolved);
      const lineIds = [...new Set(anomalies.map(a => a.summarizedLineId))];
      const lines = await storage.getSummarizedLinesByIds(lineIds);
      const lineMap = new Map(lines.map(l => [l.id, l]));
      const enriched = anomalies.map(a => ({
        ...a,
        line: lineMap.get(a.summarizedLineId) || null,
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/ml/anomalies/:id/resolve", async (req, res) => {
    try {
      await storage.resolveAnomalyFlag(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/classifications", async (_req, res) => {
    try {
      const classifications = await storage.getUnmatchedClassifications();
      const lineIds = [...new Set(classifications.map(c => c.summarizedLineId))];
      const lines = await storage.getSummarizedLinesByIds(lineIds);
      const lineMap = new Map(lines.map(l => [l.id, l]));
      const enriched = classifications.map(c => ({
        ...c,
        line: lineMap.get(c.summarizedLineId) || null,
      }));
      res.json(enriched);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/confidence", async (req, res) => {
    try {
      const reconId = req.query.reconId as string | undefined;
      const scores = await storage.getMatchConfidenceScores(reconId);
      res.json(scores);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/confidence/distribution", async (_req, res) => {
    try {
      const scores = await storage.getMatchConfidenceScores();
      const buckets = [
        { range: "90-100%", min: 90, max: 100, count: 0 },
        { range: "75-89%", min: 75, max: 89, count: 0 },
        { range: "50-74%", min: 50, max: 74, count: 0 },
        { range: "25-49%", min: 25, max: 49, count: 0 },
        { range: "0-24%", min: 0, max: 24, count: 0 },
      ];
      for (const s of scores) {
        const score = Math.min(s.overallScore || 0, 100);
        for (const b of buckets) {
          if (score >= b.min && score <= b.max) { b.count++; break; }
        }
      }
      const avgScore = scores.length > 0
        ? Math.round(scores.reduce((sum, s) => sum + Math.min(s.overallScore || 0, 100), 0) / scores.length)
        : 0;
      res.json({ buckets, avgScore: Math.min(avgScore, 100), total: scores.length });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/patterns", async (_req, res) => {
    try {
      const patterns = await storage.getMlMatchPatterns();
      res.json(patterns);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/ml/summary", async (_req, res) => {
    try {
      const [suggestions, anomalies, classifications, scores, patterns] = await Promise.all([
        storage.getMlSuggestions("pending"),
        storage.getAnomalyFlags(false),
        storage.getUnmatchedClassifications(),
        storage.getMatchConfidenceScores(),
        storage.getMlMatchPatterns(),
      ]);

      const classBreakdown = new Map<string, number>();
      for (const c of classifications) {
        classBreakdown.set(c.classification, (classBreakdown.get(c.classification) || 0) + 1);
      }

      const anomalyBreakdown = new Map<string, number>();
      for (const a of anomalies) {
        anomalyBreakdown.set(a.anomalyType, (anomalyBreakdown.get(a.anomalyType) || 0) + 1);
      }

      const avgConfidence = scores.length > 0
        ? Math.round(scores.reduce((s, c) => s + Math.min(c.overallScore || 0, 100), 0) / scores.length)
        : 0;

      res.json({
        pendingSuggestions: suggestions.length,
        unresolvedAnomalies: anomalies.length,
        classifiedUnmatched: classifications.length,
        scoredMatches: scores.length,
        learnedPatterns: patterns.length,
        avgConfidence: Math.min(avgConfidence, 100),
        classificationBreakdown: Object.fromEntries(classBreakdown),
        anomalyBreakdown: Object.fromEntries(anomalyBreakdown),
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/reports/entity-counterparty", async (_req, res) => {
    try {
      const lines = await storage.getSummarizedLines({});
      const pairMap = new Map<string, {
        entity: string; counterParty: string; total: number;
        matched: number; reversal: number; review: number; suggested: number; unmatched: number;
      }>();

      for (const line of lines) {
        const key = `${line.company}||${line.counterParty}`;
        if (!pairMap.has(key)) {
          pairMap.set(key, {
            entity: line.company,
            counterParty: line.counterParty,
            total: 0, matched: 0, reversal: 0, review: 0, suggested: 0, unmatched: 0,
          });
        }
        const entry = pairMap.get(key)!;
        entry.total++;
        const s = line.reconStatus || "unmatched";
        if (s === "matched" || s === "manual") entry.matched++;
        else if (s === "reversal") entry.reversal++;
        else if (s === "review_match") entry.review++;
        else if (s === "suggested_match") entry.suggested++;
        else entry.unmatched++;
      }

      const result = Array.from(pairMap.values())
        .map(p => ({
          ...p,
          rate: p.total > 0 ? Math.round(((p.matched + p.reversal + p.review + p.suggested) / p.total) * 10000) / 100 : 0,
        }))
        .sort((a, b) => a.entity.localeCompare(b.entity) || a.counterParty.localeCompare(b.counterParty));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  // ── IC Recon GL Dump Upload Routes ──

  app.get("/api/recon/gl-files", async (_req, res) => {
    try {
      const { db } = await import("./db");
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
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/recon/mapping-status", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const glMappings = await db.select().from(icMatrixMappingGl);
      const companyMappings = await db.select().from(icMatrixMappingCompany);
      res.json({
        hasMapping: glMappings.length > 0 && companyMappings.length > 0,
        glMappings: glMappings.length,
        companyMappings: companyMappings.length,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/recon/upload-gl", upload.single("file"), async (req, res) => {
    req.setTimeout(600000);
    res.setTimeout(600000);
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const label = (req.body.label || "GL Dump").trim();
      const batchId = randomUUID();

      const wb = XLSX.read(req.file.buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const allRows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });

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

      const { db } = await import("./db");
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

      const rawRowInserts: { batchId: string; rowData: string }[] = [];
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

        rawRowInserts.push({ batchId, rowData: JSON.stringify(raw) });
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

      let reconResult = null;
      try {
        reconResult = await runReconciliation();
        console.log(`[Auto-Recon] After GL upload: ${reconResult.totalMatched} matched`);
      } catch (reconErr: any) {
        console.error(`[Auto-Recon] Error: ${reconErr.message}`);
      }

      res.json({
        batchId,
        fileName: req.file.originalname,
        label,
        enterpriseName: enterpriseName || null,
        reportPeriod: reportPeriod || null,
        totalTransactions: totalUniqueTransactions,
        icRecords: inserted.length,
        summarizedLines: insertedLines.length,
        reconciliation: reconResult,
      });
    } catch (error: any) {
      console.error("GL dump upload error:", error);
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/recon/gl-file/:id", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      const { db } = await import("./db");
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
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/recon/download-mapped-data", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { icReconGlRawRows } = await import("@shared/schema");
      const { sql: sqlTag } = await import("drizzle-orm");

      const [countResult] = await db.select({ cnt: sqlTag<number>`count(*)` }).from(icReconGlRawRows);
      if (!countResult || countResult.cnt === 0) {
        return res.status(404).json({ message: "No mapped data available for download." });
      }

      const [firstRow] = await db.select({ rowData: icReconGlRawRows.rowData }).from(icReconGlRawRows).limit(1);
      const headers = Object.keys(JSON.parse(firstRow.rowData));

      const lines: string[] = [];
      lines.push(headers.map(h => `"${h.replace(/"/g, '""')}"`).join(","));

      const batchSize = 5000;
      let offset = 0;
      while (true) {
        const batch = await db.select({ rowData: icReconGlRawRows.rowData }).from(icReconGlRawRows).limit(batchSize).offset(offset);
        if (batch.length === 0) break;
        for (const row of batch) {
          const parsed = JSON.parse(row.rowData);
          lines.push(headers.map(h => {
            const v = parsed[h] !== undefined ? String(parsed[h]) : "";
            return `"${v.replace(/"/g, '""')}"`;
          }).join(","));
        }
        offset += batchSize;
        if (batch.length < batchSize) break;
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=IC_Recon_Mapped_Data.csv");
      res.send(lines.join("\n"));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  function isRptGlName(glName: string): boolean {
    if (!glName) return false;
    return glName.startsWith("IC") || glName.startsWith("RPT_");
  }

  app.get("/api/recon/rpt-data", async (req, res) => {
    try {
      const { db } = await import("./db");
      const { icReconGlRawRows } = await import("@shared/schema");

      const page = Math.max(1, parseInt(req.query.page as string) || 1);
      const limit = Math.min(500, Math.max(1, parseInt(req.query.limit as string) || 100));
      const search = (req.query.search as string) || "";
      const icTxnTypeFilter = (req.query.icTxnType as string) || "";
      const rptTypeFilter = (req.query.rptType as string) || "";

      const allRows = await db.select({ rowData: icReconGlRawRows.rowData }).from(icReconGlRawRows);

      const icTxnTypesSet = new Set<string>();
      let filteredRows: { rowData: string; parsed: any }[] = [];

      for (const row of allRows) {
        const parsed = JSON.parse(row.rowData);
        const glName = parsed["IC-RPT GL Name"] || "";
        if (!isRptGlName(glName)) continue;

        const icTxnType = parsed["IC Txn Type"] || "";
        if (icTxnType && icTxnType.trim()) icTxnTypesSet.add(icTxnType.trim());

        if (search) {
          const s = search.toLowerCase();
          const docNo = (parsed["Document No"] || "").toLowerCase();
          const glN = (parsed["IC-RPT GL Name"] || "").toLowerCase();
          const company = (parsed["Company"] || "").toLowerCase();
          const accHead = (parsed["Account Head"] || "").toLowerCase();
          if (!docNo.includes(s) && !glN.includes(s) && !company.includes(s) && !accHead.includes(s)) continue;
        }

        if (icTxnTypeFilter && icTxnType !== icTxnTypeFilter) continue;

        if (rptTypeFilter === "IC" && !glName.startsWith("IC")) continue;
        if (rptTypeFilter === "RPT" && !glName.startsWith("RPT_")) continue;

        filteredRows.push({ rowData: row.rowData, parsed });
      }

      const total = filteredRows.length;
      const offset = (page - 1) * limit;
      const pageRows = filteredRows.slice(offset, offset + limit);

      const data = pageRows.map(({ parsed }) => {
        const glName = parsed["IC-RPT GL Name"] || "";
        const rptType = glName.startsWith("IC") ? "IC" : glName.startsWith("RPT_") ? "RPT" : "";
        return {
          documentNo: parsed["Document No"] || "",
          docDate: parsed["Doc Date"] || "",
          company: parsed["Company"] || "",
          businessUnit: parsed["Business Unit"] || "",
          accountHead: parsed["Account Head"] || "",
          subAccountHead: parsed["Sub Account Head"] || "",
          debit: parsed["Debit"] || "0",
          credit: parsed["Credit"] || "0",
          netAmount: parsed["Net Amount"] || 0,
          icRptGlName: glName,
          companyCode: parsed["Company Code"] || "",
          icCounterParty: parsed["IC Counter Party"] || "",
          icCounterPartyCode: parsed["IC Counter Party Code"] || "",
          icTxnType: parsed["IC Txn Type"] || "",
          rptType,
          narration: parsed["Narration"] || "",
        };
      });

      const icTxnTypes = Array.from(icTxnTypesSet);
      res.json({ data, total, page, limit, totalPages: Math.ceil(total / limit), icTxnTypes });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/recon/download-rpt-data", async (_req, res) => {
    try {
      const { db } = await import("./db");
      const { icReconGlRawRows } = await import("@shared/schema");

      const allRows = await db.select({ rowData: icReconGlRawRows.rowData }).from(icReconGlRawRows);

      const rptRows: any[] = [];
      for (const row of allRows) {
        const parsed = JSON.parse(row.rowData);
        const glName = parsed["IC-RPT GL Name"] || "";
        if (!isRptGlName(glName)) continue;
        parsed["RPT Type"] = glName.startsWith("IC") ? "IC" : glName.startsWith("RPT_") ? "RPT" : "";
        rptRows.push(parsed);
      }

      if (rptRows.length === 0) {
        return res.status(404).json({ message: "No RPT data available for download." });
      }

      const rptHeaders = ["Company", "Company Code", "Document No", "Doc Date", "Account Head", "Sub Account Head", "Net Amount", "IC-RPT GL Name", "IC Txn Type", "RPT Type"];
      const lines: string[] = [];
      lines.push(rptHeaders.map(h => `"${h}"`).join(","));

      for (const parsed of rptRows) {
        lines.push(rptHeaders.map(h => {
          const v = parsed[h] !== undefined ? String(parsed[h]) : "";
          return `"${v.replace(/"/g, '""')}"`;
        }).join(","));
      }

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", "attachment; filename=IC_Recon_RPT_Data.csv");
      res.send(lines.join("\n"));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.get("/api/dashboard-settings", requireAuth, async (req: Request, res: Response) => {
    try {
      const settings = await storage.getDashboardSettings(req.session.userId!);
      res.json(settings);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.put("/api/dashboard-settings/:chartId", requireAuth, async (req: Request, res: Response) => {
    try {
      const { chartId } = req.params;
      const { numberScale, decimalPlaces } = req.body;
      if (!["absolute", "thousands", "lakhs", "crores"].includes(numberScale)) {
        return res.status(400).json({ message: "Invalid numberScale" });
      }
      if (![0, 1, 2].includes(decimalPlaces)) {
        return res.status(400).json({ message: "Invalid decimalPlaces" });
      }
      await storage.upsertDashboardSetting(req.session.userId!, chartId, numberScale, decimalPlaces);
      res.json({ success: true });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  registerIcMatrixRoutes(app);
  registerCashflowRoutes(app);

  return httpServer;
}
