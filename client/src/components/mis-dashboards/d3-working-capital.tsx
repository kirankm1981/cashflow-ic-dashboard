import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ComposedChart, Line, ReferenceLine, Cell } from "recharts";
import { DashboardRow, createFmt, fmtSuffix, colorForValue, flowColor, FLOW_BG_COLOR } from "./types";
import type { FormatConfig, FlowColor } from "./types";

interface Props {
  rows: DashboardRow[];
  formatConfig?: FormatConfig;
}

export function D3WorkingCapital({ rows, formatConfig }: Props) {
  const fmt = createFmt(formatConfig);
  const suffix = fmtSuffix(formatConfig);
  const [expandedBuckets, setExpandedBuckets] = useState<Set<string>>(new Set());

  const wcRows = useMemo(() => rows.filter(r => r.wcBucket), [rows]);

  const bucketData = useMemo(() => {
    const map: Record<string, { wcSign: number; closingNet: number; openingNet: number; wcMovement: number; items: { head: string; closing: number; opening: number }[] }> = {};
    const ahMap: Record<string, Record<string, { closing: number; opening: number }>> = {};
    for (const r of wcRows) {
      const bucket = r.wcBucket!;
      const sign = r.wcSign || 0;
      if (!map[bucket]) map[bucket] = { wcSign: sign, closingNet: 0, openingNet: 0, wcMovement: 0, items: [] };
      map[bucket].closingNet += r.closingNet;
      map[bucket].openingNet += r.openingNet;
      map[bucket].wcMovement += (r.closingNet - r.openingNet) * sign;
      if (!ahMap[bucket]) ahMap[bucket] = {};
      const ah = r.accountHead || "Other";
      if (!ahMap[bucket][ah]) ahMap[bucket][ah] = { closing: 0, opening: 0 };
      ahMap[bucket][ah].closing += r.closingNet;
      ahMap[bucket][ah].opening += r.openingNet;
    }
    for (const bucket of Object.keys(ahMap)) {
      map[bucket].items = Object.entries(ahMap[bucket]).map(([head, d]) => ({ head, ...d })).sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
    }
    return map;
  }, [wcRows]);

  const currentAssets = Object.entries(bucketData).filter(([, d]) => d.wcSign > 0).reduce((s, [, d]) => s + d.closingNet, 0);
  const currentLiabilities = Math.abs(Object.entries(bucketData).filter(([, d]) => d.wcSign < 0).reduce((s, [, d]) => s + d.closingNet, 0));
  const nwc = currentAssets - currentLiabilities;
  const wcChange = Object.values(bucketData).reduce((s, d) => s + d.wcMovement, 0);

  const horizontalBarData = useMemo(() => {
    return Object.entries(bucketData)
      .map(([name, d]) => ({
        name: name.length > 25 ? name.substring(0, 23) + "…" : name,
        fullName: name,
        value: d.closingNet * d.wcSign,
        fill: d.wcSign > 0 ? "#3b82f6" : "#f97316",
      }))
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));
  }, [bucketData]);

  const waterfallData = useMemo(() => {
    const openingNWC = Object.entries(bucketData).reduce((s, [, d]) => {
      return s + d.openingNet * (d.wcSign > 0 ? 1 : -1);
    }, 0);

    const movements = Object.entries(bucketData)
      .map(([name, d]) => ({ name: name.length > 18 ? name.substring(0, 16) + "…" : name, value: d.wcMovement }))
      .filter(d => d.value !== 0)
      .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
      .slice(0, 8);

    let running = openingNWC;
    const data = [{ name: "Opening NWC", value: openingNWC, start: 0, end: openingNWC, fill: "#6366f1" }];
    for (const m of movements) {
      const start = running;
      running += m.value;
      data.push({ name: m.name, value: m.value, start, end: running, fill: m.value >= 0 ? "#ef4444" : "#22c55e" });
    }
    data.push({ name: "Closing NWC", value: nwc, start: 0, end: nwc, fill: "#6366f1" });
    return data;
  }, [bucketData, nwc]);

  const assetBuckets = Object.entries(bucketData).filter(([, d]) => d.wcSign > 0).sort((a, b) => Math.abs(b[1].closingNet) - Math.abs(a[1].closingNet));
  const liabilityBuckets = Object.entries(bucketData).filter(([, d]) => d.wcSign < 0).sort((a, b) => Math.abs(b[1].closingNet) - Math.abs(a[1].closingNet));

  const statutoryRows = useMemo(() => {
    const statBucket = wcRows.filter(r => r.wcBucket === "Statutory Dues Payable");
    const map: Record<string, number> = {};
    for (const r of statBucket) {
      const ah = r.accountHead || "Other";
      let tag = "Other";
      const upper = ah.toUpperCase();
      if (upper.includes("GST")) tag = "GST Payable";
      else if (upper.includes("TDS")) tag = "TDS Payable";
      else if (upper.includes("PF") || upper.includes("PROVIDENT FUND")) tag = "PF Payable";
      else if (upper.includes("ESI")) tag = "ESI Payable";
      else tag = ah;
      map[tag] = (map[tag] || 0) + Math.abs(r.closingNet);
    }
    return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
  }, [wcRows]);

  const kpis: { label: string; value: number; flow: FlowColor }[] = [
    { label: "Current Assets", value: currentAssets, flow: "inflow" },
    { label: "Current Liabilities", value: currentLiabilities, flow: "outflow" },
    { label: "Net Working Capital", value: nwc, flow: "sign" },
    { label: "WC Change (Period)", value: wcChange, flow: "sign" },
  ];

  const toggleBucket = (b: string) => {
    const next = new Set(expandedBuckets);
    next.has(b) ? next.delete(b) : next.add(b);
    setExpandedBuckets(next);
  };

  if (wcRows.length === 0) {
    return (
      <Card data-testid="d3-working-capital">
        <CardContent className="py-12 text-center text-sm text-muted-foreground">
          No Working Capital data available. Ensure WC Bucket mapping is configured in the mapping file.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4" data-testid="d3-working-capital">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {kpis.map(k => {
          const bgClass = k.flow === "sign"
            ? (k.value >= 0 ? FLOW_BG_COLOR.inflow : FLOW_BG_COLOR.outflow)
            : FLOW_BG_COLOR[k.flow];
          return (
            <Card key={k.label}>
              <CardContent className="p-4">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] text-muted-foreground">{k.label}</span>
                  <div className={`w-2 h-2 rounded-full ${bgClass}`} />
                </div>
                <p className={`text-lg font-bold ${flowColor(k.value, k.flow)}`} data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                  {fmt(k.value)}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">WC Bucket Breakdown</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={Math.max(200, horizontalBarData.length * 28 + 40)}>
              <BarChart data={horizontalBarData} layout="vertical">
                <XAxis type="number" tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 9 }} />
                <Tooltip formatter={(v: number) => fmt(v)} labelFormatter={(l) => horizontalBarData.find(d => d.name === l)?.fullName || l} />
                <ReferenceLine x={0} stroke="#888" />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>
                  {horizontalBarData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2"><CardTitle className="text-sm">WC Movement Waterfall</CardTitle></CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={260}>
              <ComposedChart data={waterfallData}>
                <XAxis dataKey="name" tick={{ fontSize: 8 }} angle={-20} textAnchor="end" height={50} />
                <YAxis tickFormatter={v => fmt(v, 0)} tick={{ fontSize: 10 }} />
                <Tooltip formatter={(v: number) => fmt(v)} />
                <ReferenceLine y={0} stroke="#888" />
                <Bar dataKey="start" stackId="a" fill="transparent" />
                <Bar dataKey="value" stackId="a" radius={[2, 2, 0, 0]}>
                  {waterfallData.map((d, i) => <Cell key={i} fill={d.fill} />)}
                </Bar>
                <Line type="monotone" dataKey="end" stroke="#6366f1" dot={{ r: 3 }} strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Working Capital Breakdown</CardTitle></CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[500px] overflow-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[250px]">WC Bucket</TableHead>
                  <TableHead className="text-right">Opening ({suffix})</TableHead>
                  <TableHead className="text-right">Closing ({suffix})</TableHead>
                  <TableHead className="text-right">Change ({suffix})</TableHead>
                  <TableHead className="text-right">Change %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow className="bg-blue-50/50 dark:bg-blue-950/30">
                  <TableCell className="font-bold text-xs text-blue-700 dark:text-blue-400" colSpan={5}>CURRENT ASSETS</TableCell>
                </TableRow>
                {assetBuckets.map(([bucket, data]) => {
                  const change = data.closingNet - data.openingNet;
                  const changePct = data.openingNet !== 0 ? (change / Math.abs(data.openingNet)) * 100 : 0;
                  const isExpanded = expandedBuckets.has(bucket);
                  return (
                    <>{/* Asset bucket */}
                      <TableRow key={bucket} className="cursor-pointer hover:bg-muted/30" onClick={() => toggleBucket(bucket)}>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {bucket}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmt(data.openingNet)}</TableCell>
                        <TableCell className="text-right text-xs">{fmt(data.closingNet)}</TableCell>
                        <TableCell className={`text-right text-xs ${colorForValue(change)}`}>{fmt(change)}</TableCell>
                        <TableCell className={`text-right text-xs ${Math.abs(changePct) > 50 ? "text-red-600 font-bold" : Math.abs(changePct) > 20 ? "text-amber-600" : ""}`}>
                          {changePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      {isExpanded && data.items.map(ah => (
                        <TableRow key={`${bucket}:${ah.head}`} className="bg-muted/10">
                          <TableCell className="text-[11px] pl-10 text-muted-foreground">{ah.head}</TableCell>
                          <TableCell className="text-right text-[11px]">{fmt(ah.opening)}</TableCell>
                          <TableCell className="text-right text-[11px]">{fmt(ah.closing)}</TableCell>
                          <TableCell className={`text-right text-[11px] ${colorForValue(ah.closing - ah.opening)}`}>{fmt(ah.closing - ah.opening)}</TableCell>
                          <TableCell className="text-right text-[11px]">{ah.opening !== 0 ? (((ah.closing - ah.opening) / Math.abs(ah.opening)) * 100).toFixed(1) + "%" : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </>
                  );
                })}
                <TableRow className="border-t-2 bg-muted/30">
                  <TableCell className="font-bold text-xs">Sub-Total Current Assets</TableCell>
                  <TableCell className="text-right text-xs font-bold">{fmt(assetBuckets.reduce((s, [, d]) => s + d.openingNet, 0))}</TableCell>
                  <TableCell className="text-right text-xs font-bold">{fmt(currentAssets)}</TableCell>
                  <TableCell className="text-right text-xs font-bold" colSpan={2} />
                </TableRow>

                <TableRow className="bg-orange-50/50 dark:bg-orange-950/30">
                  <TableCell className="font-bold text-xs text-orange-700 dark:text-orange-400" colSpan={5}>CURRENT LIABILITIES</TableCell>
                </TableRow>
                {liabilityBuckets.map(([bucket, data]) => {
                  const change = data.closingNet - data.openingNet;
                  const changePct = data.openingNet !== 0 ? (change / Math.abs(data.openingNet)) * 100 : 0;
                  const isExpanded = expandedBuckets.has(bucket);
                  return (
                    <>{/* Liability bucket */}
                      <TableRow key={bucket} className="cursor-pointer hover:bg-muted/30" onClick={() => toggleBucket(bucket)}>
                        <TableCell className="text-xs">
                          <div className="flex items-center gap-1">
                            {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
                            {bucket}
                          </div>
                        </TableCell>
                        <TableCell className="text-right text-xs">{fmt(Math.abs(data.openingNet))}</TableCell>
                        <TableCell className="text-right text-xs">{fmt(Math.abs(data.closingNet))}</TableCell>
                        <TableCell className={`text-right text-xs ${colorForValue(-change)}`}>{fmt(Math.abs(change))}</TableCell>
                        <TableCell className={`text-right text-xs ${Math.abs(changePct) > 50 ? "text-red-600 font-bold" : Math.abs(changePct) > 20 ? "text-amber-600" : ""}`}>
                          {changePct.toFixed(1)}%
                        </TableCell>
                      </TableRow>
                      {isExpanded && data.items.map(ah => (
                        <TableRow key={`${bucket}:${ah.head}`} className="bg-muted/10">
                          <TableCell className="text-[11px] pl-10 text-muted-foreground">{ah.head}</TableCell>
                          <TableCell className="text-right text-[11px]">{fmt(Math.abs(ah.opening))}</TableCell>
                          <TableCell className="text-right text-[11px]">{fmt(Math.abs(ah.closing))}</TableCell>
                          <TableCell className={`text-right text-[11px]`}>{fmt(Math.abs(ah.closing - ah.opening))}</TableCell>
                          <TableCell className="text-right text-[11px]">{ah.opening !== 0 ? (((ah.closing - ah.opening) / Math.abs(ah.opening)) * 100).toFixed(1) + "%" : "—"}</TableCell>
                        </TableRow>
                      ))}
                    </>
                  );
                })}
                <TableRow className="border-t-2 bg-muted/30">
                  <TableCell className="font-bold text-xs">Sub-Total Current Liabilities</TableCell>
                  <TableCell className="text-right text-xs font-bold">{fmt(Math.abs(liabilityBuckets.reduce((s, [, d]) => s + d.openingNet, 0)))}</TableCell>
                  <TableCell className="text-right text-xs font-bold">{fmt(currentLiabilities)}</TableCell>
                  <TableCell className="text-right text-xs font-bold" colSpan={2} />
                </TableRow>

                <TableRow className="bg-muted border-t-4 font-bold">
                  <TableCell className="text-xs font-bold">NET WORKING CAPITAL</TableCell>
                  <TableCell className="text-right text-xs font-bold" />
                  <TableCell className={`text-right text-xs font-bold ${colorForValue(nwc)}`}>{fmt(nwc)}</TableCell>
                  <TableCell className="text-right text-xs font-bold" colSpan={2} />
                </TableRow>
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {statutoryRows.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <CardTitle className="text-sm">Statutory Dues Payable</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {statutoryRows.map(r => (
                <div key={r.name} className="p-2 rounded border bg-muted/30">
                  <span className="text-[10px] text-muted-foreground">{r.name}</span>
                  <p className={`text-sm font-bold ${r.value > 1000000 ? "text-red-600" : ""}`}>
                    {fmt(r.value)}
                    {r.value > 1000000 && <AlertTriangle className="w-3 h-3 inline ml-1 text-red-500" />}
                  </p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
