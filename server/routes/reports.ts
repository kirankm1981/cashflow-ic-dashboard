import type { Express } from "express";
import { storage } from "../storage";
import * as XLSX from "xlsx";
import { buildIcReconExportSheet, buildIcReconTemplateSheet } from "@shared/excel-builders";

export function registerReportRoutes(app: Express) {
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

      const built = buildIcReconExportSheet(lines);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, built.ws, built.name);

      const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

      const companyPart = req.query.companies
        ? (req.query.companies as string).split(",").slice(0, 3).join("_")
        : (req.query.company as string) || "all";
      const counterPartyPart = req.query.counterParty
        ? (req.query.counterParty as string).split(",").slice(0, 3).join("_")
        : "all";
      const statusPart = (req.query.reconStatus as string) || "all";
      const dateStr = new Date().toISOString().slice(0, 10);
      const timeStr = new Date().toTimeString().slice(0, 5).replace(":", "");
      const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 40);
      const filename = `IC_Recon_${sanitize(companyPart)}_vs_${sanitize(counterPartyPart)}_${sanitize(statusPart)}_${dateStr}_${timeStr}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(xlsxBuffer));
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? (error.message || String(error)) : `Internal server error: ${error.message || String(error)}`;
      res.status(error.status || 500).json({ message });
    }
  });

  app.get("/api/export/reconciliation-template", async (req, res) => {
    try {
      const reconStatus = req.query.reconStatus as string | undefined;

      let allLines: any[] = [];

      if (req.query.partyA && req.query.partyB) {
        const partyAList = (req.query.partyA as string).split(",").map(s => s.trim()).filter(Boolean);
        const partyBList = (req.query.partyB as string).split(",").map(s => s.trim()).filter(Boolean);

        const filtersA: any = { companies: partyAList, counterParties: partyBList };
        if (reconStatus) filtersA.reconStatus = reconStatus;
        const linesA = await storage.getSummarizedLines(filtersA);

        const filtersB: any = { companies: partyBList, counterParties: partyAList };
        if (reconStatus) filtersB.reconStatus = reconStatus;
        const linesB = await storage.getSummarizedLines(filtersB);

        const seenIds = new Set<number>();
        for (const l of linesA) { seenIds.add(l.id); allLines.push(l); }
        for (const l of linesB) { if (!seenIds.has(l.id)) allLines.push(l); }
      } else {
        const filters: any = {};
        if (req.query.companies) {
          const compList = (req.query.companies as string).split(",").map(s => s.trim()).filter(Boolean);
          if (compList.length > 0) filters.companies = compList;
        } else if (req.query.company) {
          filters.company = req.query.company as string;
        }
        if (req.query.counterParty) {
          const cp = req.query.counterParty as string;
          if (cp.includes(",")) {
            filters.counterParties = cp.split(",").map(s => s.trim()).filter(Boolean);
          } else {
            filters.counterParty = cp;
          }
        }
        if (reconStatus) filters.reconStatus = reconStatus;
        allLines = await storage.getSummarizedLines(filters);
      }

      allLines.sort((a, b) => {
        const cmp = a.company.localeCompare(b.company);
        if (cmp !== 0) return cmp;
        return (a.id || 0) - (b.id || 0);
      });

      const built = buildIcReconTemplateSheet(allLines);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, built.ws, built.name);

      const xlsxBuffer = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const dateStr = new Date().toISOString().slice(0, 10);
      const filename = `recon_template_${dateStr}.xlsx`;

      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      res.send(Buffer.from(xlsxBuffer));
    } catch (error: any) {
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? (error.message || String(error)) : `Internal server error: ${error.message || String(error)}`;
      res.status(error.status || 500).json({ message });
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
        const s = line.reconStatus || "unmatched";
        if (line.company === line.counterParty) continue;
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
      const isOperational = error.status && error.status < 500;
      const message = isOperational ? (error.message || String(error)) : `Internal server error: ${error.message || String(error)}`;
      res.status(error.status || 500).json({ message });
    }
  });
}
