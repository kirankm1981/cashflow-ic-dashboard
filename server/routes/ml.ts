import type { Express } from "express";
import { storage } from "../storage";
import { runMlAnalysis, learnFromManualMatch } from "../ml-engine";

export function registerMlRoutes(app: Express) {
  app.post("/api/ml/analyze", async (_req, res) => {
    try {
      const result = await runMlAnalysis();
      res.json(result);
    } catch (error: any) {
      console.error("ML analysis error:", error);
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/ml/suggestions/:id/reject", async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      await storage.updateMlSuggestionStatus(id, "rejected");
      res.json({ success: true });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.post("/api/ml/anomalies/:id/resolve", async (req, res) => {
    try {
      await storage.resolveAnomalyFlag(parseInt(req.params.id));
      res.json({ success: true });
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ml/confidence", async (req, res) => {
    try {
      const reconId = req.query.reconId as string | undefined;
      const scores = await storage.getMatchConfidenceScores(reconId);
      res.json(scores);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/ml/patterns", async (_req, res) => {
    try {
      const patterns = await storage.getMlMatchPatterns();
      res.json(patterns);
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? error.message : "Internal server error";
      res.status(error.status || 500).json({ message });
    }
  });
}
