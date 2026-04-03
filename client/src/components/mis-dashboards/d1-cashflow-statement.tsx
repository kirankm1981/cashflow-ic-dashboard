import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, TrendingUp, TrendingDown, ArrowRightLeft } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend, ReferenceLine, ComposedChart, Line } from "recharts";
import { DashboardRow, createFmt, fmtSuffix, colorForValue } from "./types";
import type { FormatConfig } from "./types";

const COLORS = { Operating: "#22c55e", Investing: "#f97316", Financing: "#3b82f6", "Cash & Cash Equivalents": "#8b5cf6" };

interface Props {
  rows: DashboardRow[];
  formatConfig?: FormatConfig;
}

export function D1CashflowStatement({ rows, formatConfig }: Props) {
  const fmt = createFmt(formatConfig);
  const suffix = fmtSuffix(formatConfig);
  const [expandedActivities, setExpandedActivities] = useState<Set<string>>(new Set());
  const [expandedLines, setExpandedLines] = useState<Set<string>>(new Set());

  const cfRows = useMemo(() => rows.filter(r => r.activityType), [rows]);

  const activitySums = useMemo(() => {
    const map: Record<string, { periodDebit: number; periodCredit: number; periodNet: number }> = {};
    for (const r of cfRows) {
      const at = r.activityType!;
      if (!map[at]) map[at] = { periodDebit: 0, periodCredit: 0, periodNet: 0 };
      map[at].periodDebit += r.periodDebit || 0;
      map[at].periodCredit += r.periodCredit || 0;
      map[at].periodNet += r.periodNet;
    }
    return map;
  }, [cfRows]);

  const operatingCF = activitySums["Operating"]?.periodNet || 0;
  const investingCF = activitySums["Investing"]?.periodNet || 0;
  const financingCF = activitySums["Financing"]?.periodNet || 0;
  const netChange = operatingCF + investingCF + financingCF;

  const barData = [
    { name: "Operating", value: operatingCF, fill: COLORS.Operating },
    { name: "Investing", value: investingCF, fill: COLORS.Investing },
    { name: "Financing", value: financingCF, fill: COLORS.Financing },
  ];

  const pieData = barData.map(d => ({ ...d, value: Math.abs(d.value) })).filter(d => d.value > 0);

  const cfTable = useMemo(() => {
    const sectionOrder = ["Operating", "Investing", "Financing", "Cash & Cash Equivalents"];
    const structure: { activity: string; lines: { line: string; debit: number; credit: number; net: number; accountHeads: { head: string; debit: number; credit: number; net: number }[] }[] }[] = [];

    for (const activity of sectionOrder) {
      const activityRows = cfRows.filter(r => r.activityType === activity);
      if (activityRows.length === 0) continue;

      const lineMap = new Map<string, { debit: number; credit: number; net: number; ahMap: Map<string, { debit: number; credit: number; net: number }> }>();
      for (const r of activityRows) {
        const lineName = r.cfStatementLine || "Other";
        if (!lineMap.has(lineName)) lineMap.set(lineName, { debit: 0, credit: 0, net: 0, ahMap: new Map() });
        const entry = lineMap.get(lineName)!;
        entry.debit += r.periodDebit || 0;
        entry.credit += r.periodCredit || 0;
        entry.net += r.periodNet;
        const ah = r.accountHead || "Unknown";
        if (!entry.ahMap.has(ah)) entry.ahMap.set(ah, { debit: 0, credit: 0, net: 0 });
        const ahEntry = entry.ahMap.get(ah)!;
        ahEntry.debit += r.periodDebit || 0;
        ahEntry.credit += r.periodCredit || 0;
        ahEntry.net += r.periodNet;
      }

      const lines = [...lineMap.entries()].map(([line, data]) => ({
        line,
        debit: data.debit,
        credit: data.credit,
        net: data.net,
        accountHeads: [...data.ahMap.entries()].map(([head, d]) => ({ head, ...d })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
      })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));

      structure.push({ activity, lines });
    }
    return structure;
  }, [cfRows]);

  const waterfallData = useMemo(() => {
    const opLines = cfRows.filter(r => r.activityType === "Operating");
    const lineMap = new Map<string, number>();
    for (const r of opLines) {
      const line = r.cfStatementLine || "Other";
      lineMap.set(line, (lineMap.get(line) || 0) + r.periodNet);
    }
    const entries = [...lineMap.entries()].sort((a, b) => Math.abs(b[1]) - Math.abs(a[1])).slice(0, 8);
    let running = 0;
    const data = entries.map(([name, value]) => {
      const start = running;
      running += value;
      return { name: name.length > 20 ? name.substring(0, 18) + "…" : name, value, start, end: running, fill: value >= 0 ? "#22c55e" : "#ef4444" };
    });
    data.push({ name: "Net Operating CF", value: running, start: 0, end: running, fill: running >= 0 ? "#16a34a" : "#dc2626" });
    return data;
  }, [cfRows]);

  const toggleActivity = (a: string) => {
    const next = new Set(expandedActivities);
    next.has(a) ? next.delete(a) : next.add(a);
    setExpandedActivities(next);
  };

  const toggleLine = (key: string) => {
    const next = new Set(expandedLines);
    next.has(key) ? next.delete(key) : next.add(key);
    setExpandedLines(next);
  };

  const kpis = [
    { label: "Operating CF", value: operatingCF, icon: TrendingUp },
    { label: "Investing CF", value: investingCF, icon: TrendingDown },
    { label: "Financing CF", value: financingCF, icon: ArrowRightLeft },
    { label: "Net Change in Cash", value: netChange, icon: TrendingUp },
  ];

  return (
    <div className="space-y-4" data-testid="d1-cashflow-statement">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => (
          <Card key={k.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 mb-1">
                <k.icon className="w-4 h-4 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">{k.label}</span>
              </div>
              <p className={`text-lg font-bold ${colorForValue(k.value)}`} data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                {fmt(k.value)}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Activity Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={barData} layout="vertical">
                <XAxis type="number" tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={80} tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <ReferenceLine x={0} stroke="#888" />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {barData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">CF Proportions</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie data={pieData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {pieData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Pie>
                <Tooltip formatter={(v: number) => fmt(v)} />
                <Legend />
                <text x="50%" y="50%" textAnchor="middle" dominantBaseline="middle" className="text-xs fill-foreground">
                  Net: {fmt(netChange, 1)}
                </text>
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {waterfallData.length > 1 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Operating CF Build-up</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={280}>
              <ComposedChart data={waterfallData}>
                <XAxis dataKey="name" tick={{ fontSize: 9 }} angle={-25} textAnchor="end" height={60} />
                <YAxis tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <ReferenceLine y={0} stroke="#888" />
                <Bar dataKey="start" stackId="a" fill="transparent" />
                <Bar dataKey="value" stackId="a" radius={[2, 2, 0, 0]}>
                  {waterfallData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
                <Line type="monotone" dataKey="end" stroke="#6366f1" dot={{ r: 3 }} strokeWidth={2} yAxisId={0} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Indirect Cash Flow Statement</CardTitle>
            <Badge variant="secondary" className="text-[10px]">{cfRows.length} lines</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="sticky left-0 bg-background z-10 min-w-[280px]">CF Statement Line</TableHead>
                  <TableHead className="text-right min-w-[120px]">Debit ({suffix})</TableHead>
                  <TableHead className="text-right min-w-[120px]">Credit ({suffix})</TableHead>
                  <TableHead className="text-right min-w-[130px]">Net Movement ({suffix})</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {cfTable.map(section => {
                  const sectionNet = section.lines.reduce((s, l) => s + l.net, 0);
                  const sectionDebit = section.lines.reduce((s, l) => s + l.debit, 0);
                  const sectionCredit = section.lines.reduce((s, l) => s + l.credit, 0);
                  const isExpanded = expandedActivities.has(section.activity);
                  return (
                    <>{/* Section header */}
                      <TableRow
                        key={section.activity}
                        className="bg-muted/50 cursor-pointer hover:bg-muted"
                        onClick={() => toggleActivity(section.activity)}
                        data-testid={`cf-section-${section.activity}`}
                      >
                        <TableCell className="sticky left-0 bg-muted/50 z-10 font-semibold text-xs">
                          <div className="flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                            <span className="w-2.5 h-2.5 rounded-full mr-1" style={{ background: (COLORS as any)[section.activity] || "#888" }} />
                            {section.activity}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs font-medium">{fmt(sectionDebit)}</TableCell>
                        <TableCell className="text-right text-xs font-medium">{fmt(sectionCredit)}</TableCell>
                        <TableCell className={`text-right text-xs font-bold ${colorForValue(sectionNet)}`}>{fmt(sectionNet)}</TableCell>
                      </TableRow>
                      {isExpanded && section.lines.map(line => {
                        const lineKey = `${section.activity}:${line.line}`;
                        const lineExpanded = expandedLines.has(lineKey);
                        return (
                          <>{/* Line row */}
                            <TableRow
                              key={lineKey}
                              className="cursor-pointer hover:bg-muted/30"
                              onClick={() => toggleLine(lineKey)}
                            >
                              <TableCell className="sticky left-0 bg-background z-10 text-xs pl-8">
                                <div className="flex items-center gap-1">
                                  {lineExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                                  {line.line}
                                </div>
                              </TableCell>
                              <TableCell className="text-right text-xs">{fmt(line.debit)}</TableCell>
                              <TableCell className="text-right text-xs">{fmt(line.credit)}</TableCell>
                              <TableCell className={`text-right text-xs font-medium ${colorForValue(line.net)}`}>{fmt(line.net)}</TableCell>
                            </TableRow>
                            {lineExpanded && line.accountHeads.map(ah => (
                              <TableRow key={`${lineKey}:${ah.head}`} className="bg-muted/10">
                                <TableCell className="sticky left-0 bg-muted/10 z-10 text-[11px] pl-14 text-muted-foreground">{ah.head}</TableCell>
                                <TableCell className="text-right text-[11px] text-muted-foreground">{fmt(ah.debit)}</TableCell>
                                <TableCell className="text-right text-[11px] text-muted-foreground">{fmt(ah.credit)}</TableCell>
                                <TableCell className={`text-right text-[11px] ${colorForValue(ah.net)}`}>{fmt(ah.net)}</TableCell>
                              </TableRow>
                            ))}
                          </>
                        );
                      })}
                      <TableRow key={`subtotal-${section.activity}`} className="border-t-2">
                        <TableCell className="sticky left-0 bg-background z-10 text-xs font-bold pl-4">
                          Subtotal — {section.activity}
                        </TableCell>
                        <TableCell className="text-right text-xs font-bold">{fmt(sectionDebit)}</TableCell>
                        <TableCell className="text-right text-xs font-bold">{fmt(sectionCredit)}</TableCell>
                        <TableCell className={`text-right text-xs font-bold ${colorForValue(sectionNet)}`}>{fmt(sectionNet)}</TableCell>
                      </TableRow>
                    </>
                  );
                })}
                <TableRow className="bg-muted font-bold border-t-4">
                  <TableCell className="sticky left-0 bg-muted z-10 text-xs font-bold">Grand Total — Net Change in Cash</TableCell>
                  <TableCell className="text-right text-xs font-bold" />
                  <TableCell className="text-right text-xs font-bold" />
                  <TableCell className={`text-right text-xs font-bold ${colorForValue(netChange)}`}>{fmt(netChange)}</TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
