import type { Express } from "express";
import { storage } from "../storage";
import { requireAuth, requireAdmin } from "../middleware/auth";
import { runReconciliation } from "../reconciliation-engine";
import { learnFromManualMatch, learnFromUnmatch } from "../ml-engine";

export function registerReconciliationRoutes(app: Express) {
  app.get("/api/summarized-lines", requireAuth, async (req, res) => {
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/reconcile", requireAdmin, async (_req, res) => {
    try {
      const result = await runReconciliation();
      res.json(result);
    } catch (error: any) {
      console.error("Reconciliation error:", error);
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/manual-reconcile", requireAuth, async (req, res) => {
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
      const { groups } = await storage.getReconGroups(10000, 0);
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/unmatch", requireAuth, async (req, res) => {
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/rules/reset", requireAdmin, async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { reconciliationRules } = await import("@shared/schema");
      await db.delete(reconciliationRules);
      const { seedDefaultRules } = await import("../seed");
      await seedDefaultRules();
      const rules = await storage.getActiveRules();
      res.json(rules);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/rules", requireAdmin, async (_req, res) => {
    try {
      const rules = await storage.getRules();
      res.json(rules);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.delete("/api/rules/:id", requireAdmin, async (req, res) => {
    try {
      await storage.deleteRule(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/dashboard", requireAuth, async (_req, res) => {
    try {
      const stats = await storage.getDashboardStats();
      res.json(stats);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/company-name-map", requireAuth, async (_req, res) => {
    try {
      const { db } = await import("../db");
      const { icMatrixMappingCompany } = await import("@shared/schema");
      const mappings = await db.select().from(icMatrixMappingCompany);
      const map: Record<string, string> = {};
      for (const m of mappings) {
        map[m.companyCode] = m.companyName || m.companyNameErp;
      }
      res.json(map);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/companies", requireAuth, async (_req, res) => {
    try {
      const companies = await storage.getCompanies();
      res.json(companies);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/counterparties", requireAuth, async (_req, res) => {
    try {
      const counterParties = await storage.getCounterParties();
      res.json(counterParties);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/upload-batches", requireAuth, async (_req, res) => {
    try {
      const batches = await storage.getUploadBatches();
      res.json(batches);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/company-pairs", requireAuth, async (_req, res) => {
    try {
      const pairs = await storage.getCompanyPairs();
      res.json(pairs);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/recon-groups", requireAuth, async (req, res) => {
    try {
      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 200);
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const offset = (page - 1) * limit;
      const { groups, total } = await storage.getReconGroups(limit, offset);
      res.json({ groups, total, page, limit, totalPages: Math.ceil(total / limit) });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/dashboard-settings", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const settings = await storage.getDashboardSettings(userId);
      res.json(settings);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.put("/api/dashboard-settings/:chartId", requireAuth, async (req, res) => {
    try {
      const userId = req.session.userId;
      if (!userId) return res.status(401).json({ message: "Not authenticated" });
      const { chartId } = req.params;
      const { numberScale, decimalPlaces } = req.body;
      if (!["absolute", "thousands", "lakhs", "crores"].includes(numberScale)) {
        return res.status(400).json({ message: "Invalid numberScale" });
      }
      if (![0, 1, 2].includes(decimalPlaces)) {
        return res.status(400).json({ message: "Invalid decimalPlaces" });
      }
      await storage.upsertDashboardSetting(userId, chartId, numberScale, decimalPlaces);
      res.json({ success: true });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });
}
