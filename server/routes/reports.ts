import type { Express } from "express";
import { storage } from "../storage";
import * as XLSX from "xlsx";

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

      const rows = allLines.map(l => ({
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

  app.get("/api/reports/entity-counterparty", async (_req, res) => {
    try {
      const lines = await storage.getSummarizedLines({});
      const pairMap = new Map<string, {
        entity: string; counterParty: string; total: number;
        matched: number; review: number; suggested: number; unmatched: number;
      }>();

      for (const line of lines) {
        const s = line.reconStatus || "unmatched";
        if (s === "reversal") continue;
        if (line.company === line.counterParty) continue;
        const key = `${line.company}||${line.counterParty}`;
        if (!pairMap.has(key)) {
          pairMap.set(key, {
            entity: line.company,
            counterParty: line.counterParty,
            total: 0, matched: 0, review: 0, suggested: 0, unmatched: 0,
          });
        }
        const entry = pairMap.get(key)!;
        entry.total++;
        if (s === "matched" || s === "manual") entry.matched++;
        else if (s === "review_match") entry.review++;
        else if (s === "suggested_match") entry.suggested++;
        else entry.unmatched++;
      }

      const result = Array.from(pairMap.values())
        .map(p => ({
          ...p,
          rate: p.total > 0 ? Math.round(((p.matched + p.review + p.suggested) / p.total) * 10000) / 100 : 0,
        }))
        .sort((a, b) => a.entity.localeCompare(b.entity) || a.counterParty.localeCompare(b.counterParty));

      res.json(result);
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
