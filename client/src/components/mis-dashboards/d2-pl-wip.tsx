import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ComposedChart, Line, ReferenceLine } from "recharts";
import { DashboardRow, createFmt, fmtSuffix, colorForValue, flowColor, FLOW_BG_COLOR } from "./types";
import type { FormatConfig, FlowColor } from "./types";

const PL_ORDER = [
  "Revenue from Operations",
  "Other Income",
  "__TOTAL_INCOME__",
  "Cost of Construction",
  "__GROSS_PROFIT__",
  "Employee Expenses",
  "Sales & Marketing",
  "Admin & Other Expenses",
  "Facility Management",
  "__EBITDA__",
  "Depreciation & Amortization",
  "__EBIT__",
  "Finance Cost",
  "__EBT__",
  "Tax Expense",
  "__PAT__",
];

const PL_SIGNS: Record<string, number> = {
  "Revenue from Operations": 1, "Other Income": 1,
  "Cost of Construction": -1, "Employee Expenses": -1, "Sales & Marketing": -1,
  "Admin & Other Expenses": -1, "Facility Management": -1,
  "Depreciation & Amortization": -1, "Finance Cost": -1, "Tax Expense": -1,
};

const WIP_COLORS = ["#3b82f6", "#f97316", "#22c55e", "#ef4444", "#8b5cf6", "#06b6d4"];

interface Props {
  rows: DashboardRow[];
  formatConfig?: FormatConfig;
}

export function D2PlWip({ rows, formatConfig }: Props) {
  const fmt = createFmt(formatConfig);
  const suffix = fmtSuffix(formatConfig);
  const [plTab, setPlTab] = useState("pl");
  const [expandedPl, setExpandedPl] = useState<Set<string>>(new Set());

  const plRows = useMemo(() => rows.filter(r => r.plCategory), [rows]);
  const wipRows = useMemo(() => rows.filter(r => r.wipComponent), [rows]);

  const plSums = useMemo(() => {
    const map: Record<string, { periodNet: number; items: { head: string; net: number }[] }> = {};
    const ahMap: Record<string, Record<string, number>> = {};
    for (const r of plRows) {
      const cat = r.plCategory!;
      const sign = r.plSign || PL_SIGNS[cat] || 0;
      const val = r.periodNet * sign;
      if (!map[cat]) map[cat] = { periodNet: 0, items: [] };
      map[cat].periodNet += val;
      if (!ahMap[cat]) ahMap[cat] = {};
      const ah = r.accountHead || "Other";
      ahMap[cat][ah] = (ahMap[cat][ah] || 0) + val;
    }
    for (const cat of Object.keys(ahMap)) {
      map[cat].items = Object.entries(ahMap[cat]).map(([head, net]) => ({ head, net })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    }
    return map;
  }, [plRows]);

  const revenue = (plSums["Revenue from Operations"]?.periodNet || 0);
  const otherIncome = (plSums["Other Income"]?.periodNet || 0);
  const totalIncome = revenue + otherIncome;
  const costOfConstruction = (plSums["Cost of Construction"]?.periodNet || 0);
  const grossProfit = totalIncome + costOfConstruction;
  const employee = plSums["Employee Expenses"]?.periodNet || 0;
  const salesMkt = plSums["Sales & Marketing"]?.periodNet || 0;
  const admin = plSums["Admin & Other Expenses"]?.periodNet || 0;
  const facility = plSums["Facility Management"]?.periodNet || 0;
  const ebitda = grossProfit + employee + salesMkt + admin + facility;
  const depreciation = plSums["Depreciation & Amortization"]?.periodNet || 0;
  const ebit = ebitda + depreciation;
  const financeCost = plSums["Finance Cost"]?.periodNet || 0;
  const ebt = ebit + financeCost;
  const tax = plSums["Tax Expense"]?.periodNet || 0;
  const pat = ebt + tax;

  const calculatedRows: Record<string, number> = {
    "__TOTAL_INCOME__": totalIncome,
    "__GROSS_PROFIT__": grossProfit,
    "__EBITDA__": ebitda,
    "__EBIT__": ebit,
    "__EBT__": ebt,
    "__PAT__": pat,
  };

  const calculatedLabels: Record<string, string> = {
    "__TOTAL_INCOME__": "TOTAL INCOME",
    "__GROSS_PROFIT__": "GROSS PROFIT",
    "__EBITDA__": "EBITDA",
    "__EBIT__": "EBIT",
    "__EBT__": "EBT (Earnings Before Tax)",
    "__PAT__": "PAT (Profit After Tax)",
  };

  const waterfallData = [
    { name: "Revenue", value: revenue, fill: "#22c55e" },
    { name: "Other Inc.", value: otherIncome, fill: "#86efac" },
    { name: "Construction", value: costOfConstruction, fill: "#ef4444" },
    { name: "Employee", value: employee, fill: "#f97316" },
    { name: "Sales & Mktg", value: salesMkt, fill: "#fb923c" },
    { name: "Admin", value: admin, fill: "#fbbf24" },
    { name: "Depreciation", value: depreciation, fill: "#a78bfa" },
    { name: "Finance", value: financeCost, fill: "#f87171" },
    { name: "Tax", value: tax, fill: "#94a3b8" },
  ].filter(d => d.value !== 0);

  let wfRunning = 0;
  const waterfallChart = waterfallData.map(d => {
    const start = wfRunning;
    wfRunning += d.value;
    return { ...d, start, end: wfRunning };
  });
  waterfallChart.push({ name: "PAT", value: pat, start: 0, end: pat, fill: pat >= 0 ? "#16a34a" : "#dc2626" });

  const wipByComponent = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of wipRows) {
      const comp = r.wipComponent!;
      map[comp] = (map[comp] || 0) + (r.closingNet);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value: Math.abs(value) })).sort((a, b) => b.value - a.value);
  }, [wipRows]);

  const wipByProject = useMemo(() => {
    const projMap: Record<string, Record<string, number>> = {};
    for (const r of wipRows) {
      const proj = r.projectName || "Unassigned";
      const comp = r.wipComponent!;
      if (!projMap[proj]) projMap[proj] = {};
      projMap[proj][comp] = (projMap[proj][comp] || 0) + Math.abs(r.closingNet);
    }
    return Object.entries(projMap).map(([project, comps]) => ({
      project,
      ...comps,
      total: Object.values(comps).reduce((s, v) => s + v, 0),
    })).sort((a, b) => b.total - a.total).slice(0, 10);
  }, [wipRows]);

  const wipComponents = useMemo(() => [...new Set(wipRows.map(r => r.wipComponent!))], [wipRows]);

  const kpis: { label: string; value: number; flow: FlowColor }[] = [
    { label: "Revenue from Ops", value: revenue, flow: "inflow" },
    { label: "Other Income", value: otherIncome, flow: "inflow" },
    { label: "Cost of Construction", value: Math.abs(costOfConstruction), flow: "outflow" },
    { label: "Gross Profit", value: grossProfit, flow: "sign" },
    { label: "EBITDA", value: ebitda, flow: "sign" },
  ];

  return (
    <div className="space-y-4" data-testid="d2-pl-wip">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {kpis.map(k => {
          const bgClass = k.flow === "sign"
            ? (k.value >= 0 ? FLOW_BG_COLOR.inflow : FLOW_BG_COLOR.outflow)
            : FLOW_BG_COLOR[k.flow];
          return (
            <Card key={k.label}>
              <CardContent className="p-3">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-muted-foreground">{k.label}</span>
                  <div className={`w-2 h-2 rounded-full ${bgClass}`} />
                </div>
                <p className={`text-sm font-bold ${flowColor(k.value, k.flow)}`} data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {fmt(k.value)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Tabs value={plTab} onValueChange={setPlTab}>
        <TabsList>
          <TabsTrigger value="pl" data-testid="tab-pl">P&L Statement</TabsTrigger>
          <TabsTrigger value="wip" data-testid="tab-wip">WIP Breakdown</TabsTrigger>
        </TabsList>

        <TabsContent value="pl" className="space-y-4">
          {waterfallChart.length > 1 && (
            <Card>
              <CardHeader className="pb-2"><CardTitle className="text-sm">P&L Waterfall</CardTitle></CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={260}>
                  <ComposedChart data={waterfallChart}>
                    <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-20} textAnchor="end" height={50} />
                    <YAxis tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                    <Tooltip formatter={(v: number) => fmt(v)} />
                    <ReferenceLine y={0} stroke="#888" />
                    <Bar dataKey="start" stackId="a" fill="transparent" />
                    <Bar dataKey="value" stackId="a" radius={[2, 2, 0, 0]}>
                      {waterfallChart.map((d, i) => <Cell key={i} fill={d.fill} />)}
                    </Bar>
                    <Line type="monotone" dataKey="end" stroke="#6366f1" dot={{ r: 3 }} strokeWidth={2} />
                  </ComposedChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Profit & Loss Statement</CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              <div className="max-h-[500px] overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[280px]">P&L Category</TableHead>
                      <TableHead className="text-right min-w-[130px]">Amount ({suffix})</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {PL_ORDER.map(item => {
                      if (item.startsWith("__")) {
                        const val = calculatedRows[item] || 0;
                        return (
                          <TableRow key={item} className="bg-blue-50/50 dark:bg-blue-950/30 border-t-2">
                            <TableCell className="font-bold text-xs text-blue-700 dark:text-blue-400">
                              {calculatedLabels[item]}
                            </TableCell>
                            <TableCell className={`text-right text-xs font-bold ${colorForValue(val)}`}>
                              {fmt(val)}
                            </TableCell>
                          </TableRow>
                        );
                      }
                      const data = plSums[item];
                      if (!data) return null;
                      const isExpanded = expandedPl.has(item);
                      const sign = PL_SIGNS[item] || 1;
                      return (
                        <>{/* P&L line */}
                          <TableRow
                            key={item}
                            className="cursor-pointer hover:bg-muted/30"
                            onClick={() => {
                              const next = new Set(expandedPl);
                              next.has(item) ? next.delete(item) : next.add(item);
                              setExpandedPl(next);
                            }}
                          >
                            <TableCell className={`text-xs ${sign < 0 ? "text-red-700 dark:text-red-400" : ""}`}>
                              <div className="flex items-center gap-1">
                                {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                {item}
                              </div>
                            </TableCell>
                            <TableCell className={`text-right text-xs font-medium ${colorForValue(data.periodNet)}`}>
                              {fmt(data.periodNet)}
                            </TableCell>
                          </TableRow>
                          {isExpanded && data.items.map(ah => (
                            <TableRow key={`${item}:${ah.head}`} className="bg-muted/10">
                              <TableCell className="text-[11px] pl-10 text-muted-foreground">{ah.head}</TableCell>
                              <TableCell className={`text-right text-[11px] ${colorForValue(ah.net)}`}>{fmt(ah.net)}</TableCell>
                            </TableRow>
                          ))}
                        </>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="wip" className="space-y-4">
          {wipByComponent.length === 0 ? (
            <Card><CardContent className="py-12 text-center text-sm text-muted-foreground">No WIP data available. Ensure WIP Component mapping is configured.</CardContent></Card>
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">WIP by Component</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <PieChart>
                        <Pie data={wipByComponent} cx="50%" cy="50%" innerRadius={45} outerRadius={75} dataKey="value" label={({ name, percent }) => `${name.substring(0, 15)} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                          {wipByComponent.map((_, i) => <Cell key={i} fill={WIP_COLORS[i % WIP_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">WIP by Project</CardTitle></CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={250}>
                      <BarChart data={wipByProject}>
                        <XAxis dataKey="project" tick={{ fontSize: 8 }} angle={-25} textAnchor="end" height={60} />
                        <YAxis tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(v: number) => fmt(v)} />
                        {wipComponents.map((comp, i) => (
                          <Bar key={comp} dataKey={comp} stackId="a" fill={WIP_COLORS[i % WIP_COLORS.length]} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">WIP Detail Table</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <div className="max-h-[400px] overflow-auto">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Project</TableHead>
                          <TableHead>WIP Component</TableHead>
                          <TableHead className="text-right">Opening ({suffix})</TableHead>
                          <TableHead className="text-right">Period Add. ({suffix})</TableHead>
                          <TableHead className="text-right">Closing ({suffix})</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {wipRows.reduce<{ project: string; component: string; opening: number; period: number; closing: number }[]>((acc, r) => {
                          const key = `${r.projectName || "Unassigned"}|${r.wipComponent}`;
                          const existing = acc.find(a => `${a.project}|${a.component}` === key);
                          if (existing) {
                            existing.opening += r.openingNet;
                            existing.period += r.periodNet;
                            existing.closing += r.closingNet;
                          } else {
                            acc.push({ project: r.projectName || "Unassigned", component: r.wipComponent!, opening: r.openingNet, period: r.periodNet, closing: r.closingNet });
                          }
                          return acc;
                        }, []).sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing)).map((r, i) => (
                          <TableRow key={i}>
                            <TableCell className="text-xs">{r.project}</TableCell>
                            <TableCell className="text-xs">{r.component}</TableCell>
                            <TableCell className="text-right text-xs">{fmt(r.opening)}</TableCell>
                            <TableCell className="text-right text-xs">{fmt(r.period)}</TableCell>
                            <TableCell className={`text-right text-xs font-medium ${colorForValue(r.closing)}`}>{fmt(r.closing)}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
