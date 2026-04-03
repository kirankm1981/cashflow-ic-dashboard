import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth } from "../middleware/auth";
import { parseFileInWorker, getSheetNamesInWorker, previewHeadersInWorker } from "../file-processor";
import { icReconGlFiles, icReconGlRawRows } from "@shared/schema";
import type { InsertTransaction, InsertSummarizedLine } from "@shared/schema";
import { randomUUID } from "crypto";
import path from "path";
import os from "os";
import fs from "fs";
import multer from "multer";
import * as XLSX from "xlsx";
import { existsSync } from "fs";

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

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), "ic-uploads");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname)}`);
  },
});

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const ALLOWED_MIMETYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
]);

export const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      return cb(new Error(`File type not allowed. Only xlsx, xls, csv permitted. Got: ${ext}`));
    }
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error(`MIME type not permitted: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

export function cleanupFile(filePath: string) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}

export function registerUploadRoutes(app: Express) {
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
        cleanupFile(req.file.path);
        return res.json({ sheetNames: [] });
      }
      const sheetNames = await getSheetNamesInWorker(req.file.path);
      res.json({ sheetNames });
    } catch (error: any) {
      if (req.file?.path) cleanupFile(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/upload/preview-headers", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });
      const selectedSheet = req.body?.sheetName || null;
      const result = await previewHeadersInWorker(req.file.path, req.file.originalname, selectedSheet);
      res.json(result);
    } catch (error: any) {
      if (req.file?.path) cleanupFile(req.file.path);
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/upload", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) return res.status(400).json({ message: "No file uploaded" });

      const batchId = randomUUID();

      const columnMapping = req.body.columnMapping ? JSON.parse(req.body.columnMapping) : null;
      const selectedSheet = req.body.sheetName || undefined;

      const records = await parseFileInWorker(req.file.path, req.file.originalname, selectedSheet);

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
      const { db } = await import("../db");
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

  app.post("/api/upload/reconciliation", upload.single("file"), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ message: "No file uploaded" });
      }

      const rows = await parseFileInWorker(req.file.path, req.file.originalname);

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
}
