import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer, BarChart, Bar, XAxis, YAxis } from "recharts";
import { DashboardRow, createFmt, fmtSuffix, fmtPct, colorForValue } from "./types";
import type { FormatConfig } from "./types";

const DEBT_COLORS: Record<string, string> = {
  "Secured LT Borrowings": "#1e40af",
  "Unsecured LT Borrowings": "#3b82f6",
  "Secured ST Borrowings": "#0ea5e9",
  "Unsecured ST Borrowings": "#7dd3fc",
  "Debentures & Instruments": "#f59e0b",
  "ICD Given": "#ef4444",
  "ICD Received": "#22c55e",
  "Inter-BU Loans": "#8b5cf6",
};

const GROSS_DEBT_BUCKETS = ["Secured LT Borrowings", "Unsecured LT Borrowings", "Secured ST Borrowings", "Unsecured ST Borrowings", "Debentures & Instruments"];

interface Props {
  rows: DashboardRow[];
  allRows: DashboardRow[];
  formatConfig?: FormatConfig;
}

export function D4DebtFinancing({ rows, allRows, formatConfig }: Props) {
  const fmt = createFmt(formatConfig);
  const suffix = fmtSuffix(formatConfig);
  const [tab, setTab] = useState("debt");

  const debtRows = useMemo(() => rows.filter(r => r.debtBucket), [rows]);

  const bucketData = useMemo(() => {
    const map: Record<string, { opening: number; closing: number; periodDr: number; periodCr: number }> = {};
    for (const r of debtRows) {
      const bucket = r.debtBucket!;
      if (!map[bucket]) map[bucket] = { opening: 0, closing: 0, periodDr: 0, periodCr: 0 };
      map[bucket].opening += Math.abs(r.openingNet);
      map[bucket].closing += Math.abs(r.closingNet);
      map[bucket].periodDr += r.periodDebit || 0;
      map[bucket].periodCr += r.periodCredit || 0;
    }
    return map;
  }, [debtRows]);

  const grossDebt = GROSS_DEBT_BUCKETS.reduce((s, b) => s + (bucketData[b]?.closing || 0), 0);
  const secured = ["Secured LT Borrowings", "Secured ST Borrowings"].reduce((s, b) => s + (bucketData[b]?.closing || 0), 0);
  const unsecured = ["Unsecured LT Borrowings", "Unsecured ST Borrowings"].reduce((s, b) => s + (bucketData[b]?.closing || 0), 0);
  const debentures = bucketData["Debentures & Instruments"]?.closing || 0;

  const cashPosition = useMemo(() => {
    return rows.filter(r => r.kpiTag === "Cash Position").reduce((s, r) => s + r.closingNet, 0);
  }, [rows]);

  const netDebt = grossDebt - Math.abs(cashPosition);

  const donutData = GROSS_DEBT_BUCKETS.filter(b => bucketData[b]?.closing > 0).map(b => ({
    name: b,
    value: bucketData[b].closing,
    fill: DEBT_COLORS[b] || "#888",
  }));

  const entityDebtData = useMemo(() => {
    const compMap: Record<string, Record<string, number>> = {};
    for (const r of debtRows) {
      if (!GROSS_DEBT_BUCKETS.includes(r.debtBucket!)) continue;
      const comp = r.company;
      if (!compMap[comp]) compMap[comp] = {};
      compMap[comp][r.debtBucket!] = (compMap[comp][r.debtBucket!] || 0) + Math.abs(r.closingNet);
    }
    return Object.entries(compMap).map(([company, buckets]) => ({
      company: company.length > 20 ? company.substring(0, 18) + "…" : company,
      ...buckets,
      total: Object.values(buckets).reduce((s, v) => s + v, 0),
    })).sort((a, b) => b.total - a.total);
  }, [debtRows]);

  const financeCostPL = useMemo(() => {
    return allRows.filter(r => r.cfHead === "Finance Cost").reduce((s, r) => s + Math.abs(r.periodNet), 0);
  }, [allRows]);

  const financeCostCapitalised = useMemo(() => {
    return allRows.filter(r => r.cfHead === "Finance Cost (Project)").reduce((s, r) => s + Math.abs(r.periodNet), 0);
  }, [allRows]);

  const totalInterest = financeCostPL + financeCostCapitalised;
  const openingGrossDebt = GROSS_DEBT_BUCKETS.reduce((s, b) => s + (bucketData[b]?.opening || 0), 0);
  const avgGrossDebt = (openingGrossDebt + grossDebt) / 2;

  const periodMonths = useMemo(() => {
    const periods = [...new Set(rows.map(r => r.periodTag).filter(Boolean))];
    if (periods.length === 0) return 12;
    const period = periods[0]!;
    const match = period.match(/(\w+)-(\w+)\s+(\d{4})/);
    if (!match) return 12;
    const months: Record<string, number> = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6, Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };
    const start = months[match[1]] || 1;
    const end = months[match[2]] || 12;
    return end >= start ? end - start + 1 : 12 - start + end + 1;
  }, [rows]);

  const effectiveRate = avgGrossDebt > 0 ? (totalInterest / avgGrossDebt) * (12 / periodMonths) * 100 : 0;

  const finCostPieData = [
    { name: "P&L Finance Cost", value: financeCostPL, fill: "#ef4444" },
    { name: "Capitalised (WIP)", value: financeCostCapitalised, fill: "#f97316" },
  ].filter(d => d.value > 0);

  const kpis = [
    { label: "Gross Debt", value: grossDebt },
    { label: "Secured", value: secured },
    { label: "Unsecured", value: unsecured },
    { label: "Debentures", value: debentures },
    { label: "Net Debt", value: netDebt },
  ];

  if (debtRows.length === 0) {
    return (
      <Card data-testid="d4-debt-financing">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No Debt data available. Ensure Debt Bucket mapping is configured in the mapping file.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="d4-debt-financing">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="p-3">
              <span className="text-[10px] text-muted-foreground">{k.label}</span>
              <p className={`text-sm font-bold ${k.label === "Net Debt" ? colorForValue(-k.value) : ""}`} data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {fmt(k.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="debt" data-testid="tab-debt-overview">Debt Overview</TabsTrigger>
          <TabsTrigger value="finance" data-testid="tab-finance-cost">Finance Cost</TabsTrigger>
        </TabsList>

        <TabsContent value="debt" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">Debt Composition</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={250}>
                  <PieChart>
                    <Pie data={donutData} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" label={({ name, percent }) => `${name.replace(" Borrowings", "").substring(0, 12)} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {donutData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {entityDebtData.length > 1 && (
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Debt by Entity</CardTitle></CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={250}>
                    <BarChart data={entityDebtData}>
                      <XAxis dataKey="company" tick={{ fontSize: 8 }} angle={-20} textAnchor="end" height={50} />
                      <YAxis tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(v: number) => fmt(v)} />
                      {GROSS_DEBT_BUCKETS.map(b => (
                        <Bar key={b} dataKey={b} stackId="a" fill={DEBT_COLORS[b]} />
                      ))}
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            )}
          </div>

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">Debt Movement Schedule</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[400px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[200px]">Debt Type</TableHead>
                      <TableHead className="text-right">Opening ({suffix})</TableHead>
                      <TableHead className="text-right">Additions ({suffix})</TableHead>
                      <TableHead className="text-right">Repayments ({suffix})</TableHead>
                      <TableHead className="text-right">Closing ({suffix})</TableHead>
                      <TableHead className="text-right">% of Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {Object.entries(bucketData).sort((a, b) => b[1].closing - a[1].closing).map(([bucket, data]) => {
                      const pctOfTotal = grossDebt > 0 ? (data.closing / grossDebt) * 100 : 0;
                      const debtUp = data.closing > data.opening;
                      return (
                        <TableRow key={bucket}>
                          <TableCell className="text-xs font-medium">
                            <div className="flex items-center gap-1.5">
                              <span className="w-2 h-2 rounded-full" style={{ background: DEBT_COLORS[bucket] || "#888" }} />
                              {bucket}
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-xs">{fmt(data.opening)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt(data.periodDr)}</TableCell>
                          <TableCell className="text-right text-xs">{fmt(data.periodCr)}</TableCell>
                          <TableCell className={`text-right text-xs font-medium ${debtUp ? "text-red-600" : "text-green-600"}`}>{fmt(data.closing)}</TableCell>
                          <TableCell className="text-right text-xs">{fmtPct(pctOfTotal)}</TableCell>
                        </TableRow>
                      );
                    })}
                    <TableRow className="bg-muted border-t-2 font-bold">
                      <TableCell className="text-xs font-bold">Grand Total</TableCell>
                      <TableCell className="text-right text-xs font-bold">{fmt(openingGrossDebt)}</TableCell>
                      <TableCell className="text-right text-xs font-bold">{fmt(Object.values(bucketData).reduce((s, d) => s + d.periodDr, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-bold">{fmt(Object.values(bucketData).reduce((s, d) => s + d.periodCr, 0))}</TableCell>
                      <TableCell className="text-right text-xs font-bold">{fmt(grossDebt)}</TableCell>
                      <TableCell className="text-right text-xs font-bold">100%</TableCell>
                    </TableRow>
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="finance" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "Finance Cost (P&L)", value: financeCostPL },
              { label: "Interest Capitalised–WIP", value: financeCostCapitalised },
              { label: "Total Interest Outflow", value: totalInterest },
              { label: "Effective Interest Rate", value: effectiveRate, isPct: true },
            ].map(k => (
              <Card key={k.label}>
                <CardContent className="p-3">
                  <span className="text-[10px] text-muted-foreground">{k.label}</span>
                  <p className="text-sm font-bold" data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                    {k.isPct ? fmtPct(k.value) : fmt(k.value)}
                  </p>
                </CardContent>
              </Card>
            ))}
          </div>

          {finCostPieData.length > 0 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">P&L vs Capitalised Interest</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={220}>
                  <PieChart>
                    <Pie data={finCostPieData} cx="50%" cy="50%" innerRadius={40} outerRadius={70} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                      {finCostPieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Pie>
                    <Tooltip formatter={(v: number) => fmt(v)} />
                  </PieChart>
                </ResponsiveContainer>
                <p className="text-xs text-muted-foreground text-center mt-2 italic">
                  Higher capitalisation defers cost via WIP — monitor project timelines.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
