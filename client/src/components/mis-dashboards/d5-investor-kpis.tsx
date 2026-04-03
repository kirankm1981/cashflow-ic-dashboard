import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { DashboardRow, createFmt, fmtSuffix, fmtPct, colorForValue, flowColor, FLOW_BG_COLOR } from "./types";
import type { FormatConfig, FlowColor } from "./types";

const KPI_DEFS: { tag: string; useClosing: boolean; abs: boolean; color: string; flow: FlowColor }[] = [
  { tag: "Revenue Billed", useClosing: true, abs: false, color: "#22c55e", flow: "inflow" },
  { tag: "Collections", useClosing: true, abs: false, color: "#3b82f6", flow: "inflow" },
  { tag: "WIP Balance", useClosing: true, abs: false, color: "#f97316", flow: "neutral" },
  { tag: "Cash Position", useClosing: true, abs: false, color: "#06b6d4", flow: "cash" },
  { tag: "Gross Debt", useClosing: true, abs: true, color: "#ef4444", flow: "outflow" },
  { tag: "Finance Cost", useClosing: false, abs: true, color: "#f87171", flow: "outflow" },
  { tag: "Land & JDA Cost", useClosing: true, abs: true, color: "#84cc16", flow: "outflow" },
  { tag: "Construction Cost", useClosing: false, abs: true, color: "#a855f7", flow: "outflow" },
  { tag: "Employee Cost", useClosing: false, abs: true, color: "#ec4899", flow: "outflow" },
  { tag: "Tax Paid", useClosing: false, abs: true, color: "#64748b", flow: "outflow" },
];

interface Props {
  rows: DashboardRow[];
  allRows: DashboardRow[];
  onProjectFilter?: (project: string) => void;
  formatConfig?: FormatConfig;
}

export function D5InvestorKpis({ rows, allRows, onProjectFilter, formatConfig }: Props) {
  const fmt = createFmt(formatConfig);
  const suffix = fmtSuffix(formatConfig);

  const [selectedKpis, setSelectedKpis] = useState<Set<string>>(new Set(["Revenue Billed", "Collections", "WIP Balance"]));

  const kpiValues = useMemo(() => {
    const map: Record<string, number> = {};
    for (const def of KPI_DEFS) {
      const kpiRows = rows.filter(r => r.kpiTag === def.tag);
      let val = kpiRows.reduce((s, r) => s + (def.useClosing ? r.closingNet : r.periodNet), 0);
      if (def.abs) val = Math.abs(val);
      map[def.tag] = val;
    }
    return map;
  }, [rows]);

  const revenueBilled = kpiValues["Revenue Billed"] || 0;
  const collections = kpiValues["Collections"] || 0;
  const wipBalance = kpiValues["WIP Balance"] || 0;
  const grossDebt = kpiValues["Gross Debt"] || 0;
  const financeCost = kpiValues["Finance Cost"] || 0;
  const landCost = kpiValues["Land & JDA Cost"] || 0;
  const constructionCost = kpiValues["Construction Cost"] || 0;

  const collectionEfficiency = revenueBilled > 0 ? (collections / revenueBilled) * 100 : 0;
  const debtToWip = wipBalance > 0 ? (grossDebt / wipBalance) * 100 : 0;
  const finCostToRevenue = revenueBilled > 0 ? (financeCost / revenueBilled) * 100 : 0;
  const landPctOfWip = wipBalance > 0 ? (landCost / wipBalance) * 100 : 0;
  const constructionPctOfRevenue = revenueBilled > 0 ? (constructionCost / revenueBilled) * 100 : 0;

  const derivedKpis = [
    {
      label: "Collections Efficiency",
      value: collectionEfficiency,
      color: collectionEfficiency > 85 ? "green" : collectionEfficiency >= 70 ? "amber" : "red",
      thresholds: "Green: >85% | Amber: 70–85% | Red: <70%",
    },
    {
      label: "Debt-to-WIP Ratio",
      value: debtToWip,
      color: debtToWip < 70 ? "green" : debtToWip <= 85 ? "amber" : "red",
      thresholds: "Green: <70% | Amber: 70–85% | Red: >85%",
    },
    {
      label: "Finance Cost to Revenue",
      value: finCostToRevenue,
      color: finCostToRevenue < 15 ? "green" : finCostToRevenue <= 20 ? "amber" : "red",
      thresholds: "Green: <15% | Amber: 15–20% | Red: >20%",
    },
    {
      label: "Land Cost % of WIP",
      value: landPctOfWip,
      color: landPctOfWip < 30 ? "green" : "amber",
      thresholds: "Target: <30%",
    },
    {
      label: "Construction Cost % of Revenue",
      value: constructionPctOfRevenue,
      color: constructionPctOfRevenue < 65 ? "green" : "amber",
      thresholds: "Target: <65%",
    },
  ];

  const colorMap: Record<string, string> = {
    green: "bg-green-500", amber: "bg-amber-500", red: "bg-red-500",
  };
  const textColorMap: Record<string, string> = {
    green: "text-green-600 dark:text-green-400",
    amber: "text-amber-600 dark:text-amber-400",
    red: "text-red-600 dark:text-red-400",
  };

  const trendData = useMemo(() => {
    const periods = [...new Set(allRows.map(r => r.periodTag).filter(Boolean))].sort();
    if (periods.length <= 1) return [];
    return periods.map(period => {
      const periodRows = allRows.filter(r => r.periodTag === period);
      const entry: Record<string, any> = { period };
      for (const def of KPI_DEFS) {
        const kpiRows = periodRows.filter(r => r.kpiTag === def.tag);
        let val = kpiRows.reduce((s, r) => s + (def.useClosing ? r.closingNet : r.periodNet), 0);
        if (def.abs) val = Math.abs(val);
        entry[def.tag] = val;
      }
      return entry;
    });
  }, [allRows]);

  const projectTable = useMemo(() => {
    const projMap: Record<string, Record<string, number>> = {};
    for (const r of rows) {
      if (!r.kpiTag || !r.projectName) continue;
      if (!projMap[r.projectName]) projMap[r.projectName] = {};
      const def = KPI_DEFS.find(d => d.tag === r.kpiTag);
      if (!def) continue;
      const val = def.useClosing ? r.closingNet : r.periodNet;
      projMap[r.projectName][r.kpiTag] = (projMap[r.projectName][r.kpiTag] || 0) + (def.abs ? Math.abs(val) : val);
    }
    return Object.entries(projMap).map(([project, kpis]) => {
      const rev = kpis["Revenue Billed"] || 0;
      const coll = kpis["Collections"] || 0;
      const eff = rev > 0 ? (coll / rev) * 100 : 0;
      const wip = kpis["WIP Balance"] || 0;
      const debt = kpis["Gross Debt"] || 0;
      const debtWip = wip > 0 ? (debt / wip) * 100 : 0;
      return { project, revenue: rev, collections: coll, efficiency: eff, wip, grossDebt: debt, cash: kpis["Cash Position"] || 0, debtWipRatio: debtWip };
    }).sort((a, b) => Math.abs(b.revenue) - Math.abs(a.revenue));
  }, [rows]);


  return (
    <div className="space-y-4" data-testid="d5-investor-kpis">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {KPI_DEFS.map(def => {
          const val = kpiValues[def.tag] || 0;
          const bgClass = def.flow === "sign"
            ? (val >= 0 ? FLOW_BG_COLOR.inflow : FLOW_BG_COLOR.outflow)
            : (def.flow !== "sign" ? FLOW_BG_COLOR[def.flow] : "");
          return (
            <Card key={def.tag}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-muted-foreground">{def.tag}</span>
                  <div className={`w-2 h-2 rounded-full ${bgClass}`} />
                </div>
                <p className={`text-sm font-bold ${flowColor(val, def.flow)}`} data-testid={`kpi-${def.tag.toLowerCase().replace(/\s+/g, "-")}`}>
                  {fmt(val)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
        {derivedKpis.map(dk => (
          <Card key={dk.label} className="border-l-4" style={{ borderLeftColor: dk.color === "green" ? "#22c55e" : dk.color === "amber" ? "#f59e0b" : "#ef4444" }}>
            <CardContent className="p-3">
              <span className="text-[10px] text-muted-foreground">{dk.label}</span>
              <p className={`text-lg font-bold ${textColorMap[dk.color]}`}>
                {fmtPct(dk.value)}
              </p>
              <Progress
                value={Math.min(dk.value, 100)}
                className="h-1.5 mt-1"
              />
              <span className="text-[9px] text-muted-foreground">{dk.thresholds}</span>
            </CardContent>
          </Card>
        ))}
      </div>

      {trendData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm">Multi-Period Trend</CardTitle>
              <div className="flex items-center gap-3 flex-wrap">
                {KPI_DEFS.map(def => (
                  <label key={def.tag} className="flex items-center gap-1 text-[10px] cursor-pointer">
                    <Checkbox
                      checked={selectedKpis.has(def.tag)}
                      onCheckedChange={(checked) => {
                        const next = new Set(selectedKpis);
                        checked ? next.add(def.tag) : next.delete(def.tag);
                        setSelectedKpis(next);
                      }}
                    />
                    <span style={{ color: def.color }}>{def.tag}</span>
                  </label>
                ))}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <LineChart data={trendData}>
                <XAxis dataKey="period" tick={{ fontSize: 10 }} />
                <YAxis tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend wrapperStyle={{ fontSize: 10 }} />
                {KPI_DEFS.filter(d => selectedKpis.has(d.tag)).map(def => (
                  <Line key={def.tag} type="monotone" dataKey={def.tag} stroke={def.color} dot={{ r: 3 }} strokeWidth={2} />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      {projectTable.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Per-Project Breakdown</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[400px] overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-[180px]">Project</TableHead>
                    <TableHead className="text-right">Revenue ({suffix})</TableHead>
                    <TableHead className="text-right">Collections ({suffix})</TableHead>
                    <TableHead className="text-right">Efficiency %</TableHead>
                    <TableHead className="text-right">WIP ({suffix})</TableHead>
                    <TableHead className="text-right">Gross Debt ({suffix})</TableHead>
                    <TableHead className="text-right">Cash ({suffix})</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {projectTable.map(r => (
                    <TableRow
                      key={r.project}
                      className={`cursor-pointer hover:bg-muted/30 ${onProjectFilter ? "" : ""}`}
                      onClick={() => onProjectFilter?.(r.project)}
                    >
                      <TableCell className="text-xs font-medium">{r.project}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(r.revenue)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(r.collections)}</TableCell>
                      <TableCell className={`text-right text-xs font-medium ${r.efficiency < 70 ? "text-red-600" : r.efficiency < 85 ? "text-amber-600" : "text-green-600"}`}>
                        {fmtPct(r.efficiency)}
                      </TableCell>
                      <TableCell className="text-right text-xs">{fmt(r.wip)}</TableCell>
                      <TableCell className="text-right text-xs">{fmt(r.grossDebt)}</TableCell>
                      <TableCell className={`text-right text-xs ${colorForValue(r.cash)}`}>{fmt(r.cash)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

    </div>
  );
}
