import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IndianRupee, TrendingUp, TrendingDown, AlertTriangle, ChevronRight, ChevronDown } from "lucide-react";
import { useState, useMemo } from "react";
import { useLocation } from "wouter";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  Cell,
  LabelList,
} from "recharts";

function formatCrores(value: number): string {
  if (value === 0) return "₹0 Cr";
  const sign = value < 0 ? "-" : "";
  const crores = Math.abs(value) / 10000000;
  if (crores >= 100) return `${sign}₹${crores.toFixed(0)} Cr`;
  if (crores >= 10) return `${sign}₹${crores.toFixed(1)} Cr`;
  return `${sign}₹${crores.toFixed(2)} Cr`;
}

function formatCroresShort(value: number): string {
  if (value === 0) return "0";
  const sign = value < 0 ? "-" : "";
  const crores = Math.abs(value) / 10000000;
  if (crores >= 100) return `${sign}${crores.toFixed(0)}`;
  if (crores >= 10) return `${sign}${crores.toFixed(0)}`;
  if (crores >= 1) return `${sign}${crores.toFixed(1)}`;
  return `${sign}${crores.toFixed(2)}`;
}

function formatBarLabel(value: number): string {
  if (!value || value === 0) return "";
  const sign = value < 0 ? "-" : "";
  const crores = Math.abs(value) / 10000000;
  if (crores >= 100) return `${sign}₹${crores.toFixed(0)} Cr`;
  if (crores >= 10) return `${sign}₹${crores.toFixed(0)} Cr`;
  if (crores >= 1) return `${sign}₹${crores.toFixed(1)} Cr`;
  return `${sign}₹${crores.toFixed(2)} Cr`;
}

interface UnifiedRow {
  company: string;
  projectName: string | null;
  entityStatus: string | null;
  cashflow: string | null;
  cfHead: string | null;
  amount: number | null;
}

interface UnifiedResponse {
  data: UnifiedRow[];
  tbCount: number;
  pastLossesCount: number;
  totalCount: number;
}

interface UnmappedItem {
  id: number;
  company: string;
  accountHead: string;
  cashflow: string | null;
  cfHead: string | null;
  projectName: string | null;
  entityStatus: string | null;
  netClosingBalance: number;
}

interface UnmappedResponse {
  unmappedCashflow: {
    count: number;
    items: UnmappedItem[];
    uniqueAccountHeads: string[];
  };
  unmappedEntity: {
    count: number;
    items: UnmappedItem[];
    uniqueCompanies: string[];
  };
}

const STATUS_OPTIONS = ["All", "Ongoing Project", "Corporate", "Completed Project", "New Project"] as const;
const CASHFLOW_COLORS: Record<string, string> = {
  "Inflow": "#0ea5e9",
  "Outflow": "#f97316",
  "Cash/Bank Balance": "#10b981",
};
const CHART_COLORS = {
  inflow: "#0ea5e9",
  outflow: "#f97316",
  cashBank: "#10b981",
  grid: "#e5e7eb",
  axis: "#9ca3af",
  axisLabel: "#6b7280",
};

export default function CashflowDashboard() {
  const [, navigate] = useLocation();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [statusFilter, setStatusFilter] = useState<string>("All");
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data: summary, isLoading: loadingSummary } = useQuery<any>({
    queryKey: ["/api/cashflow/summary"],
  });

  const { data: unifiedResult, isLoading: loadingUnified } = useQuery<UnifiedResponse>({
    queryKey: ["/api/cashflow/unified-data"],
  });

  const { data: unmappedResult, isLoading: loadingUnmapped } = useQuery<UnmappedResponse>({
    queryKey: ["/api/cashflow/unmapped-items"],
  });

  const { data: pastLossesData, isLoading: loadingPastLosses } = useQuery<Array<{
    id: number; company: string | null; project: string | null; cashflow: string | null;
    cfHead: string | null; amount: number | null; asPerFs: string | null; lossesUpto: string | null;
  }>>({
    queryKey: ["/api/cashflow/past-losses"],
  });

  const unified = unifiedResult?.data || [];

  const filteredData = useMemo(() => {
    if (statusFilter === "All") return unified;
    return unified.filter(r => r.entityStatus === statusFilter);
  }, [unified, statusFilter]);

  const CASHFLOW_ORDER = ["Inflow", "Outflow", "Cash/Bank Balance"];
  const cashflowByType = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of filteredData) {
      const type = r.cashflow || "Unclassified";
      map.set(type, (map.get(type) || 0) + (r.amount || 0));
    }
    return Array.from(map.entries())
      .map(([name, value]) => ({ name, value, absValue: Math.abs(value) }))
      .sort((a, b) => {
        const ai = CASHFLOW_ORDER.indexOf(a.name);
        const bi = CASHFLOW_ORDER.indexOf(b.name);
        return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
      });
  }, [filteredData]);

  const cashflowByProject = useMemo(() => {
    const statusMap = new Map<string, { inflow: number; outflow: number; cashBank: number }>();
    for (const r of filteredData) {
      const status = r.entityStatus || "Unassigned";
      if (!statusMap.has(status)) statusMap.set(status, { inflow: 0, outflow: 0, cashBank: 0 });
      const entry = statusMap.get(status)!;
      if (r.cashflow === "Inflow") entry.inflow += (r.amount || 0);
      else if (r.cashflow === "Outflow") entry.outflow += (r.amount || 0);
      else entry.cashBank += (r.amount || 0);
    }
    return Array.from(statusMap.entries())
      .map(([name, v]) => ({
        name,
        inflow: Math.abs(v.inflow),
        outflow: Math.abs(v.outflow),
        cashBank: Math.abs(v.cashBank),
        rawInflow: v.inflow,
        rawOutflow: v.outflow,
        rawCashBank: v.cashBank,
      }))
      .sort((a, b) => (b.inflow + b.outflow + b.cashBank) - (a.inflow + a.outflow + a.cashBank));
  }, [filteredData]);

  const pivotData = useMemo(() => {
    const projects = new Set<string>();
    const structure = new Map<string, Map<string, Map<string, number>>>();

    for (const r of filteredData) {
      const cfType = r.cashflow || "Unclassified";
      const head = r.cfHead || "Unmapped";
      const project = r.projectName || "Unassigned";
      projects.add(project);

      if (!structure.has(cfType)) structure.set(cfType, new Map());
      const heads = structure.get(cfType)!;
      if (!heads.has(head)) heads.set(head, new Map());
      const projectMap = heads.get(head)!;
      projectMap.set(project, (projectMap.get(project) || 0) + (r.amount || 0));
    }

    const projectList = Array.from(projects).sort();
    const rows: Array<{
      cfType: string;
      cfHead: string;
      isParent: boolean;
      projects: Record<string, number>;
      total: number;
    }> = [];

    for (const [cfType, heads] of structure) {
      const parentProjects: Record<string, number> = {};
      let parentTotal = 0;
      for (const [head, projectMap] of heads) {
        const rowProjects: Record<string, number> = {};
        let rowTotal = 0;
        for (const [proj, val] of projectMap) {
          rowProjects[proj] = val;
          rowTotal += val;
          parentProjects[proj] = (parentProjects[proj] || 0) + val;
        }
        parentTotal += rowTotal;
        rows.push({ cfType, cfHead: head, isParent: false, projects: rowProjects, total: rowTotal });
      }
      rows.push({ cfType, cfHead: "", isParent: true, projects: parentProjects, total: parentTotal });
    }

    const sortedRows: typeof rows = [];
    const cfTypes = Array.from(structure.keys()).sort();
    for (const cfType of cfTypes) {
      const parent = rows.find(r => r.isParent && r.cfType === cfType)!;
      const children = rows.filter(r => !r.isParent && r.cfType === cfType).sort((a, b) => a.cfHead.localeCompare(b.cfHead));
      sortedRows.push(parent);
      sortedRows.push(...children);
    }

    return { projectList, rows: sortedRows };
  }, [filteredData]);

  const totalInflow = useMemo(() =>
    filteredData.filter(r => r.cashflow === "Inflow").reduce((s, r) => s + (r.amount || 0), 0),
    [filteredData]);
  const totalOutflow = useMemo(() =>
    filteredData.filter(r => r.cashflow === "Outflow").reduce((s, r) => s + (r.amount || 0), 0),
    [filteredData]);
  const totalCashBank = useMemo(() =>
    filteredData.filter(r => r.cashflow !== "Inflow" && r.cashflow !== "Outflow").reduce((s, r) => s + (r.amount || 0), 0),
    [filteredData]);

  const unmappedCfCount = unmappedResult?.unmappedCashflow?.count || 0;
  const unmappedEntityCount = unmappedResult?.unmappedEntity?.count || 0;
  const totalUnmapped = useMemo(() => {
    if (!unmappedResult) return 0;
    const cfIds = new Set(unmappedResult.unmappedCashflow?.items?.map(i => i.id) || []);
    const entityIds = new Set(unmappedResult.unmappedEntity?.items?.map(i => i.id) || []);
    const allIds = new Set([...cfIds, ...entityIds]);
    return allIds.size;
  }, [unmappedResult]);

  const hasData = (summary?.tbFiles || 0) > 0 || (unifiedResult?.totalCount || 0) > 0;

  if (loadingSummary || loadingUnified) {
    return (
      <div className="p-6 space-y-6" data-testid="page-cashflow-dashboard">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Cashflow Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Monitor and analyze cashflows across entities</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <Card key={i}><CardContent className="p-5"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-16" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  if (!hasData) {
    return (
      <div className="p-6 space-y-6" data-testid="page-cashflow-dashboard">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-title">Cashflow Dashboard</h1>
            <p className="text-muted-foreground text-sm mt-1">Monitor and analyze cashflows across entities</p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <IndianRupee className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Data Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Upload Trial Balance files and a Cashflow Mapping file to get started.
            </p>
            <button
              className="text-sm text-primary underline cursor-pointer"
              onClick={() => navigate("/cashflow/upload")}
              data-testid="link-go-to-upload"
            >
              Go to Upload Page
            </button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const periodDisplay = summary?.periods?.join(" | ") || "";
  const enterpriseDisplay = summary?.enterprises?.join(", ") || "";

  const toggleExpand = (key: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name?: string; color?: string; dataKey?: string; payload?: Record<string, number> }>; label?: string }) => {
    if (active && payload && payload.length) {
      return (
        <div className="bg-white/95 dark:bg-zinc-900/95 backdrop-blur-sm border border-gray-200/60 dark:border-zinc-700/60 rounded-xl shadow-xl px-4 py-3 min-w-[160px]">
          <p className="text-xs font-semibold text-gray-500 dark:text-zinc-400 uppercase tracking-wider mb-2">{label}</p>
          <div className="space-y-1.5">
            {payload.filter(p => p.value !== 0).map((p, i) => {
              const displayValue = p.dataKey === "absValue" && p.payload?.value !== undefined ? p.payload.value : p.value;
              return (
                <div key={i} className="flex items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                    <span className="text-xs text-gray-600 dark:text-zinc-300">{p.name || "Amount"}</span>
                  </div>
                  <span className="text-xs font-semibold text-gray-900 dark:text-zinc-100 tabular-nums">{formatCrores(displayValue)}</span>
                </div>
              );
            })}
          </div>
        </div>
      );
    }
    return null;
  };

  const renderLegend = (props: { payload?: Array<{ value: string; color: string }> }) => {
    const { payload } = props;
    if (!payload) return null;
    return (
      <div className="flex items-center justify-center gap-5 mt-2">
        {payload.map((entry, idx) => (
          <div key={idx} className="flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: entry.color }} />
            <span className="text-[11px] font-medium text-gray-500 dark:text-zinc-400">{entry.value}</span>
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="p-6 space-y-4" data-testid="page-cashflow-dashboard">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-title">Cashflow Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Monitor and analyze cashflows across entities</p>
        </div>
        {(periodDisplay || enterpriseDisplay) && (
          <div className="text-right shrink-0" data-testid="text-cf-period">
            {periodDisplay && <p className="text-sm font-semibold">{periodDisplay}</p>}
            {enterpriseDisplay && <p className="text-xs text-muted-foreground mt-0.5">{enterpriseDisplay}</p>}
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap" data-testid="status-filter-buttons">
        {STATUS_OPTIONS.map(status => (
          <Button
            key={status}
            variant={statusFilter === status ? "default" : "outline"}
            size="sm"
            onClick={() => setStatusFilter(status)}
            data-testid={`btn-filter-${status.toLowerCase().replace(/\s+/g, "-")}`}
          >
            {status}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card data-testid="card-total-inflows">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Inflow</p>
                <p className="text-2xl font-bold text-green-600">{formatCrores(totalInflow)}</p>
              </div>
              <div className="p-2 rounded-md bg-green-500/10"><TrendingUp className="w-5 h-5 text-green-500" /></div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-total-outflows">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Outflow</p>
                <p className="text-2xl font-bold text-red-600">{formatCrores(totalOutflow)}</p>
              </div>
              <div className="p-2 rounded-md bg-red-500/10"><TrendingDown className="w-5 h-5 text-red-500" /></div>
            </div>
          </CardContent>
        </Card>
        <Card data-testid="card-cash-bank">
          <CardContent className="p-5">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Cash & Bank</p>
                <p className="text-2xl font-bold">{formatCrores(totalCashBank)}</p>
              </div>
              <div className="p-2 rounded-md bg-blue-500/10"><IndianRupee className="w-5 h-5 text-blue-500" /></div>
            </div>
          </CardContent>
        </Card>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-cashflow-dashboard">
          <TabsTrigger value="dashboard" data-testid="tab-cf-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="detailed" data-testid="tab-cf-detailed">Detailed Cashflow</TabsTrigger>
          <TabsTrigger value="unmapped" data-testid="tab-cf-unmapped" className="relative">
            Unmapped Items
            {totalUnmapped > 0 && (
              <Badge variant="destructive" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{totalUnmapped}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="pastLosses" data-testid="tab-cf-past-losses" className="relative">
            Past Losses
            {(pastLossesData?.length || 0) > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{pastLossesData?.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="overflow-hidden border-0 shadow-sm bg-white dark:bg-zinc-900">
              <CardHeader className="pb-0 pt-5 px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Cashflow by Type</CardTitle>
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Amount in ₹ Crores</p>
                  </div>
                  <div className="flex items-center gap-4">
                    {cashflowByType.map((entry) => (
                      <div key={entry.name} className="flex items-center gap-1.5">
                        <span className="w-2 h-2 rounded-full" style={{ backgroundColor: CASHFLOW_COLORS[entry.name] || "#94a3b8" }} />
                        <span className="text-[10px] font-medium text-gray-400 dark:text-zinc-500">{entry.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-2">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashflowByType} margin={{ top: 24, right: 16, left: 8, bottom: 8 }} barCategoryGap="30%">
                      <defs>
                        <linearGradient id="gradInflow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#0ea5e9" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0.55} />
                        </linearGradient>
                        <linearGradient id="gradOutflow" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f97316" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#f97316" stopOpacity={0.55} />
                        </linearGradient>
                        <linearGradient id="gradCashBank" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity={0.9} />
                          <stop offset="100%" stopColor="#10b981" stopOpacity={0.55} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="none" vertical={false} />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 11, fill: CHART_COLORS.axisLabel, fontWeight: 500 }}
                        dy={8}
                      />
                      <YAxis
                        tickFormatter={(v: number) => formatCroresShort(v)}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
                        width={56}
                        domain={[0, 'auto']}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                      <Bar dataKey="absValue" name="Amount" radius={[6, 6, 0, 0]} maxBarSize={72}>
                        {cashflowByType.map((entry, idx) => {
                          const gradId = entry.name === "Inflow" ? "url(#gradInflow)" : entry.name === "Outflow" ? "url(#gradOutflow)" : "url(#gradCashBank)";
                          return <Cell key={idx} fill={gradId} />;
                        })}
                        <LabelList dataKey="value" position="top" formatter={formatBarLabel} style={{ fontSize: 10, fontWeight: 600, fill: CHART_COLORS.axisLabel }} />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card className="overflow-hidden border-0 shadow-sm bg-white dark:bg-zinc-900">
              <CardHeader className="pb-0 pt-5 px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Cashflow by Project Status</CardTitle>
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Inflow, Outflow & Cash/Bank breakdown</p>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="px-4 pb-4 pt-2">
                <div className="h-[300px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={cashflowByProject} margin={{ top: 16, right: 16, left: 8, bottom: 8 }} barCategoryGap="20%" barGap={2}>
                      <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="none" vertical={false} />
                      <XAxis
                        dataKey="name"
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: CHART_COLORS.axisLabel, fontWeight: 500 }}
                        interval={0}
                        dy={8}
                      />
                      <YAxis
                        tickFormatter={(v: number) => formatCroresShort(v)}
                        axisLine={false}
                        tickLine={false}
                        tick={{ fontSize: 10, fill: CHART_COLORS.axis }}
                        width={56}
                        domain={[0, 'auto']}
                      />
                      <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                      <Legend content={renderLegend} />
                      <Bar dataKey="inflow" name="Inflow" fill="#0ea5e9" radius={[6, 6, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="outflow" name="Outflow" fill="#f97316" radius={[6, 6, 0, 0]} maxBarSize={36} />
                      <Bar dataKey="cashBank" name="Cash & Bank" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={36} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="detailed" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base">Detailed Cashflow — Type / CF Head / Projects</CardTitle>
                <Badge variant="secondary" className="text-xs">
                  {pivotData.projectList.length} projects
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10 min-w-[220px]">Cashflow / CF Head</TableHead>
                      {pivotData.projectList.map(proj => (
                        <TableHead key={proj} className="text-right text-xs min-w-[120px] whitespace-nowrap">{proj}</TableHead>
                      ))}
                      <TableHead className="text-right min-w-[120px] font-bold">Total</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pivotData.rows.map((row, idx) => {
                      if (row.isParent) {
                        const isExpanded = expandedRows.has(row.cfType);
                        return (
                          <TableRow
                            key={`parent-${row.cfType}`}
                            className="bg-muted/50 cursor-pointer hover:bg-muted/80"
                            onClick={() => toggleExpand(row.cfType)}
                            data-testid={`pivot-parent-${row.cfType}`}
                          >
                            <TableCell className="sticky left-0 bg-muted/50 z-10 font-semibold text-sm">
                              <div className="flex items-center gap-1">
                                {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                                {row.cfType}
                              </div>
                            </TableCell>
                            {pivotData.projectList.map(proj => (
                              <TableCell key={proj} className="text-right text-xs font-medium">
                                {row.projects[proj] ? formatCrores(row.projects[proj]) : "—"}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-bold">{formatCrores(row.total)}</TableCell>
                          </TableRow>
                        );
                      }
                      const isExpanded = expandedRows.has(row.cfType);
                      if (!isExpanded) return null;
                      return (
                        <TableRow key={`child-${row.cfType}-${row.cfHead}`} data-testid={`pivot-child-${idx}`}>
                          <TableCell className="sticky left-0 bg-background z-10 text-xs pl-8">{row.cfHead}</TableCell>
                          {pivotData.projectList.map(proj => (
                            <TableCell key={proj} className="text-right text-xs">
                              {row.projects[proj] ? formatCrores(row.projects[proj]) : "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right text-xs font-medium">{formatCrores(row.total)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unmapped" className="space-y-4">
          {loadingUnmapped ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <Card className="border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Unmapped Cashflow/CF Head
                      </CardTitle>
                      <Badge variant="secondary">{unmappedCfCount} items</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      TB lines where Cashflow or CF Head is blank after mapping
                    </p>
                  </CardHeader>
                  <CardContent>
                    {unmappedCfCount === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">All items are mapped</div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          Missing account heads: {unmappedResult?.unmappedCashflow?.uniqueAccountHeads?.join(", ")}
                        </p>
                        <div className="overflow-auto max-h-[300px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Company</TableHead>
                                <TableHead>Account Head</TableHead>
                                <TableHead className="text-right">Net Closing Balance</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {unmappedResult?.unmappedCashflow?.items?.map((item: UnmappedItem) => (
                                <TableRow key={item.id} data-testid={`unmapped-cf-${item.id}`}>
                                  <TableCell className="text-xs">{item.company}</TableCell>
                                  <TableCell className="text-xs">{item.accountHead}</TableCell>
                                  <TableCell className="text-right text-xs">{formatCrores(item.netClosingBalance || 0)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>

                <Card className="border-amber-200 dark:border-amber-800">
                  <CardHeader className="pb-2">
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-base flex items-center gap-2">
                        <AlertTriangle className="w-4 h-4 text-amber-500" />
                        Unmapped Entity
                      </CardTitle>
                      <Badge variant="secondary">{unmappedEntityCount} items</Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      TB lines where Project or Status is blank after mapping
                    </p>
                  </CardHeader>
                  <CardContent>
                    {unmappedEntityCount === 0 ? (
                      <div className="text-center py-6 text-sm text-muted-foreground">All entities are mapped</div>
                    ) : (
                      <>
                        <p className="text-xs text-muted-foreground mb-2">
                          Missing companies: {unmappedResult?.unmappedEntity?.uniqueCompanies?.join(", ")}
                        </p>
                        <div className="overflow-auto max-h-[300px]">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Company</TableHead>
                                <TableHead>Account Head</TableHead>
                                <TableHead className="text-right">Net Closing Balance</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {unmappedResult?.unmappedEntity?.items?.map((item: UnmappedItem) => (
                                <TableRow key={item.id} data-testid={`unmapped-entity-${item.id}`}>
                                  <TableCell className="text-xs">{item.company}</TableCell>
                                  <TableCell className="text-xs">{item.accountHead}</TableCell>
                                  <TableCell className="text-right text-xs">{formatCrores(item.netClosingBalance || 0)}</TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </TabsContent>

        <TabsContent value="pastLosses" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Past Losses</CardTitle>
              <p className="text-sm text-muted-foreground">
                {pastLossesData?.length || 0} records from mapping file
              </p>
            </CardHeader>
            <CardContent>
              {loadingPastLosses ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">Loading past losses...</div>
              ) : !pastLossesData || pastLossesData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <p>No past losses data uploaded</p>
                  <p className="text-xs mt-1">Upload a mapping file with a "Past Losses" sheet</p>
                </div>
              ) : (
                <div className="overflow-auto max-h-[600px] rounded-md border">
                  <Table>
                    <TableHeader>
                      <TableRow className="bg-muted/50">
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">#</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">Company</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">Project</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">Cashflow</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">CF Head</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm text-right">Amount</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">As Per FS</TableHead>
                        <TableHead className="font-semibold text-xs sticky top-0 bg-muted/90 backdrop-blur-sm">Losses Upto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pastLossesData.map((row, idx) => (
                        <TableRow key={row.id} data-testid={`row-past-loss-${row.id}`} className="text-xs">
                          <TableCell className="text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={row.company || ""}>{row.company || "-"}</TableCell>
                          <TableCell className="max-w-[200px] truncate" title={row.project || ""}>{row.project || "-"}</TableCell>
                          <TableCell>{row.cashflow || "-"}</TableCell>
                          <TableCell className="max-w-[180px] truncate" title={row.cfHead || ""}>{row.cfHead || "-"}</TableCell>
                          <TableCell className="text-right tabular-nums font-medium">{row.amount != null ? formatCrores(row.amount) : "-"}</TableCell>
                          <TableCell>{row.asPerFs || "-"}</TableCell>
                          <TableCell>{row.lossesUpto || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
