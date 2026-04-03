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
import { IndianRupee, TrendingUp, TrendingDown, ChevronRight, ChevronDown, Download, FileDown, ArrowRightLeft } from "lucide-react";
import { useState, useMemo, Fragment } from "react";
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
  ReferenceLine,
  PieChart,
  Pie,
} from "recharts";
import { useDashboardSettings } from "@/hooks/use-dashboard-settings";
import { formatAmount, SCALE_SUFFIXES } from "@/lib/number-format";
import { ChartFormatSettings } from "@/components/chart-format-settings";
import { DashboardFilters } from "@/components/mis-dashboards/dashboard-filters";
import { D1CashflowStatement } from "@/components/mis-dashboards/d1-cashflow-statement";
import { D2PlWip } from "@/components/mis-dashboards/d2-pl-wip";
import { D3WorkingCapital } from "@/components/mis-dashboards/d3-working-capital";
import { D4DebtFinancing } from "@/components/mis-dashboards/d4-debt-financing";
import { D5InvestorKpis } from "@/components/mis-dashboards/d5-investor-kpis";
import { filterRows, colorForValue, flowColor, FLOW_BG_COLOR, type FilterState, type DashboardDataResponse, type FlowColor } from "@/components/mis-dashboards/types";


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
  const [dashFilters, setDashFilters] = useState<FilterState>({ companies: [], projects: [], period: null });
  const { getFormat } = useDashboardSettings();
  const cfFmt = getFormat("cf-amounts");

  const { data: summary, isLoading: loadingSummary } = useQuery<any>({
    queryKey: ["/api/cashflow/summary"],
  });

  const { data: unifiedResult, isLoading: loadingUnified } = useQuery<UnifiedResponse>({
    queryKey: ["/api/cashflow/unified-data"],
  });

  const { data: pastLossesData, isLoading: loadingPastLosses } = useQuery<Array<{
    id: number; company: string | null; project: string | null; cashflow: string | null;
    cfHead: string | null; amount: number | null; asPerFs: string | null; lossesUpto: string | null;
  }>>({
    queryKey: ["/api/cashflow/past-losses"],
  });

  const { data: dashboardData, isLoading: loadingDashData } = useQuery<DashboardDataResponse>({
    queryKey: ["/api/cashflow/dashboard-data"],
  });

  const filteredDashRows = useMemo(() => {
    if (!dashboardData?.rows) return [];
    return filterRows(dashboardData.rows, dashFilters);
  }, [dashboardData, dashFilters]);

  const allDashRows = dashboardData?.rows || [];

  const isAnalyticTab = ["d1", "d2", "d3", "d4", "d5"].includes(activeTab);

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


  const hasData = (summary?.tbFiles || 0) > 0 || (unifiedResult?.totalCount || 0) > 0;

  if (loadingSummary || loadingUnified) {
    return (
      <div className="p-6 space-y-6" data-testid="page-cashflow-dashboard">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">MIS</h1>
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
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-title">MIS</h1>
            <p className="text-muted-foreground text-sm mt-1">Monitor and analyze cashflows across entities</p>
          </div>
        </div>
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16 text-center">
            <IndianRupee className="w-12 h-12 text-muted-foreground/40 mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Data Yet</h3>
            <p className="text-sm text-muted-foreground max-w-md mb-4">
              Upload Trial Balance files and a MIS Mapping file to get started.
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
                  <span className="text-xs font-semibold text-gray-900 dark:text-zinc-100 tabular-nums">₹{formatAmount(displayValue, cfFmt)}</span>
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
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-title">MIS</h1>
          <p className="text-muted-foreground text-sm mt-1">Monitor and analyze cashflows across entities</p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {(periodDisplay || enterpriseDisplay) && (
            <div className="text-right" data-testid="text-cf-period">
              {periodDisplay && <p className="text-sm font-semibold">{periodDisplay}</p>}
              {enterpriseDisplay && <p className="text-xs text-muted-foreground mt-0.5">{enterpriseDisplay}</p>}
            </div>
          )}
          <ChartFormatSettings chartId="cf-amounts" />
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-cashflow-dashboard">
          <TabsTrigger value="dashboard" data-testid="tab-cf-dashboard">Cashflow Overview</TabsTrigger>
          <TabsTrigger value="detailed" data-testid="tab-cf-detailed">Cashflow by Project</TabsTrigger>
          <TabsTrigger value="d1" data-testid="tab-d1">CF Statement</TabsTrigger>
          <TabsTrigger value="d2" data-testid="tab-d2">PL & WIP</TabsTrigger>
          <TabsTrigger value="d3" data-testid="tab-d3">Working Capital</TabsTrigger>
          <TabsTrigger value="d4" data-testid="tab-d4">Debt & Finance</TabsTrigger>
          <TabsTrigger value="d5" data-testid="tab-d5">KPIs</TabsTrigger>
          <TabsTrigger value="pastLosses" data-testid="tab-cf-past-losses" className="relative">
            Past Losses
            {(pastLossesData?.length || 0) > 0 && (
              <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0 h-4">{pastLossesData?.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        {isAnalyticTab && (
          <div className="mt-3">
            <DashboardFilters
              companies={dashboardData?.companies || []}
              projects={dashboardData?.projects || []}
              periods={dashboardData?.periods || []}
              filters={dashFilters}
              onChange={setDashFilters}
            />
          </div>
        )}

        {(activeTab === "dashboard" || activeTab === "detailed") && (
          <div className="flex items-center gap-2 flex-wrap mt-3" data-testid="status-filter-buttons">
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
        )}

        <TabsContent value="dashboard" className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {([
              { label: "Total Inflow", value: totalInflow, icon: TrendingUp, flow: "inflow" as FlowColor, testId: "card-total-inflows" },
              { label: "Total Outflow", value: totalOutflow, icon: TrendingDown, flow: "outflow" as FlowColor, testId: "card-total-outflows" },
              { label: "Cash & Bank", value: totalCashBank, icon: IndianRupee, flow: "cash" as FlowColor, testId: "card-cash-bank" },
              { label: "Net Cashflow", value: totalInflow + totalOutflow + totalCashBank, icon: ArrowRightLeft, flow: "sign" as FlowColor, testId: "card-net-cashflow" },
            ]).map(k => {
              const bgClass = k.flow === "sign"
                ? (k.value >= 0 ? FLOW_BG_COLOR.inflow : FLOW_BG_COLOR.outflow)
                : FLOW_BG_COLOR[k.flow];
              return (
                <Card key={k.label} data-testid={k.testId}>
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs text-muted-foreground">{k.label}</span>
                      <div className={`p-1.5 rounded-md ${bgClass}`}>
                        <k.icon className="w-4 h-4 text-muted-foreground" />
                      </div>
                    </div>
                    <p className={`text-lg font-bold ${flowColor(k.value, k.flow)}`} data-testid={`kpi-${k.label.toLowerCase().replace(/\s+/g, "-")}`}>
                      ₹{formatAmount(k.value, cfFmt)}
                    </p>
                  </CardContent>
                </Card>
              );
            })}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cashflow Breakdown</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart
                    data={cashflowByType.map(d => ({
                      ...d,
                      absValue: Math.abs(d.value),
                      fill: CASHFLOW_COLORS[d.name] || "#94a3b8",
                    }))}
                    margin={{ top: 20, right: 16, left: 8, bottom: 8 }}
                    barCategoryGap="30%"
                  >
                    <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="none" vertical={false} />
                    <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: CHART_COLORS.axisLabel, fontWeight: 500 }} dy={8} />
                    <YAxis tickFormatter={v => formatAmount(v, { ...cfFmt, decimals: 0 })} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} width={56} />
                    <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                    <Bar dataKey="absValue" name="Amount" radius={[6, 6, 0, 0]} maxBarSize={72}>
                      {cashflowByType.map((d, i) => (
                        <Cell key={i} fill={CASHFLOW_COLORS[d.name] || "#94a3b8"} />
                      ))}
                      <LabelList dataKey="value" position="top" formatter={(v: number) => v ? `₹${formatAmount(v, cfFmt)}` : ""} style={{ fontSize: 10, fontWeight: 600, fill: CHART_COLORS.axisLabel }} />
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cashflow Proportions</CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={280}>
                  <PieChart>
                    <Pie
                      data={cashflowByType.filter(d => Math.abs(d.value) > 0).map(d => ({ name: d.name, value: Math.abs(d.value), fill: CASHFLOW_COLORS[d.name] || "#94a3b8" }))}
                      cx="50%" cy="50%" innerRadius={50} outerRadius={90} dataKey="value"
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={true}
                    >
                      {cashflowByType.filter(d => Math.abs(d.value) > 0).map((d, i) => (
                        <Cell key={i} fill={CASHFLOW_COLORS[d.name] || "#94a3b8"} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                    <Legend content={renderLegend} />
                  </PieChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Cashflow by Project Status</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart
                  data={cashflowByProject}
                  margin={{ top: 16, right: 16, left: 8, bottom: 8 }}
                  barCategoryGap="20%"
                  barGap={2}
                >
                  <CartesianGrid stroke={CHART_COLORS.grid} strokeDasharray="none" vertical={false} />
                  <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axisLabel, fontWeight: 500 }} interval={0} dy={8} />
                  <YAxis tickFormatter={v => formatAmount(v, { ...cfFmt, decimals: 0 })} axisLine={false} tickLine={false} tick={{ fontSize: 10, fill: CHART_COLORS.axis }} width={56} />
                  <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                  <Legend content={renderLegend} />
                  <Bar dataKey="inflow" name="Inflow" fill={CHART_COLORS.inflow} radius={[6, 6, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="outflow" name="Outflow" fill={CHART_COLORS.outflow} radius={[6, 6, 0, 0]} maxBarSize={36} />
                  <Bar dataKey="cashBank" name="Cash & Bank" fill={CHART_COLORS.cashBank} radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="detailed" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Cashflow by Project</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">
                    {pivotData.projectList.length} projects
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-detailed", "_blank")} data-testid="button-download-detailed">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-auto max-h-[600px]">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="sticky left-0 bg-background z-10 min-w-[280px]">Cashflow / CF Head</TableHead>
                      {pivotData.projectList.map(proj => (
                        <TableHead key={proj} className="text-right text-xs min-w-[120px] whitespace-nowrap">{proj} ({SCALE_SUFFIXES[cfFmt.scale] || "₹"})</TableHead>
                      ))}
                      <TableHead className="text-right min-w-[130px] font-bold">Total ({SCALE_SUFFIXES[cfFmt.scale] || "₹"})</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(() => {
                      const SECTION_COLORS: Record<string, string> = {
                        "Inflow": "#22c55e",
                        "Outflow": "#f97316",
                        "Cash/Bank Balance": "#3b82f6",
                      };
                      const cfTypes = Array.from(new Set(pivotData.rows.map(r => r.cfType)));
                      let grandTotal = 0;
                      const grandProjects: Record<string, number> = {};
                      return (
                        <>
                          {cfTypes.map(cfType => {
                            const parent = pivotData.rows.find(r => r.isParent && r.cfType === cfType);
                            const children = pivotData.rows.filter(r => !r.isParent && r.cfType === cfType);
                            const isExpanded = expandedRows.has(cfType);
                            const sectionTotal = parent?.total || 0;
                            grandTotal += sectionTotal;
                            for (const proj of pivotData.projectList) {
                              grandProjects[proj] = (grandProjects[proj] || 0) + (parent?.projects[proj] || 0);
                            }
                            const dotColor = SECTION_COLORS[cfType] || "#888";

                            return (
                              <Fragment key={cfType}>
                                <TableRow
                                  className="bg-muted/50 cursor-pointer hover:bg-muted"
                                  onClick={() => toggleExpand(cfType)}
                                  data-testid={`pivot-parent-${cfType}`}
                                >
                                  <TableCell className="sticky left-0 bg-muted/50 z-10 font-semibold text-xs">
                                    <div className="flex items-center gap-1">
                                      {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                                      <span className="w-2.5 h-2.5 rounded-full mr-1" style={{ background: dotColor }} />
                                      {cfType}
                                    </div>
                                  </TableCell>
                                  {pivotData.projectList.map(proj => (
                                    <TableCell key={proj} className="text-right text-xs font-medium">
                                      {parent?.projects[proj] ? `₹${formatAmount(parent.projects[proj], cfFmt)}` : "—"}
                                    </TableCell>
                                  ))}
                                  <TableCell className={`text-right text-xs font-bold ${colorForValue(sectionTotal)}`}>
                                    ₹{formatAmount(sectionTotal, cfFmt)}
                                  </TableCell>
                                </TableRow>
                                {isExpanded && children.map((row) => (
                                  <TableRow key={`${cfType}-${row.cfHead}`} data-testid={`pivot-child-${cfType}-${row.cfHead}`} className="hover:bg-muted/30">
                                    <TableCell className="sticky left-0 bg-background z-10 text-xs pl-8">{row.cfHead}</TableCell>
                                    {pivotData.projectList.map(proj => (
                                      <TableCell key={proj} className="text-right text-xs">
                                        {row.projects[proj] ? `₹${formatAmount(row.projects[proj], cfFmt)}` : "—"}
                                      </TableCell>
                                    ))}
                                    <TableCell className={`text-right text-xs font-medium ${colorForValue(row.total)}`}>
                                      ₹{formatAmount(row.total, cfFmt)}
                                    </TableCell>
                                  </TableRow>
                                ))}
                                <TableRow className="border-t-2">
                                  <TableCell className="sticky left-0 bg-background z-10 text-xs font-bold pl-4">
                                    Subtotal — {cfType}
                                  </TableCell>
                                  {pivotData.projectList.map(proj => (
                                    <TableCell key={proj} className="text-right text-xs font-bold">
                                      {parent?.projects[proj] ? `₹${formatAmount(parent.projects[proj], cfFmt)}` : "—"}
                                    </TableCell>
                                  ))}
                                  <TableCell className={`text-right text-xs font-bold ${colorForValue(sectionTotal)}`}>
                                    ₹{formatAmount(sectionTotal, cfFmt)}
                                  </TableCell>
                                </TableRow>
                              </Fragment>
                            );
                          })}
                          <TableRow className="bg-muted font-bold border-t-4">
                            <TableCell className="sticky left-0 bg-muted z-10 text-xs font-bold">Grand Total — Net Cashflow</TableCell>
                            {pivotData.projectList.map(proj => (
                              <TableCell key={proj} className="text-right text-xs font-bold">
                                {grandProjects[proj] ? `₹${formatAmount(grandProjects[proj], cfFmt)}` : "—"}
                              </TableCell>
                            ))}
                            <TableCell className={`text-right text-xs font-bold ${colorForValue(grandTotal)}`}>
                              ₹{formatAmount(grandTotal, cfFmt)}
                            </TableCell>
                          </TableRow>
                        </>
                      );
                    })()}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="pastLosses" className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-sm">Past Losses</CardTitle>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-[10px]">{pastLossesData?.length || 0} records</Badge>
                  {pastLossesData && pastLossesData.length > 0 && (
                    <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-past-losses", "_blank")} data-testid="button-download-past-losses">
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              {loadingPastLosses ? (
                <div className="flex items-center justify-center py-12 text-muted-foreground">Loading past losses...</div>
              ) : !pastLossesData || pastLossesData.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <p className="text-xs">No past losses data uploaded</p>
                  <p className="text-[11px] mt-1">Upload a mapping file with a "Past Losses" sheet</p>
                </div>
              ) : (
                <div className="overflow-auto max-h-[500px]">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="sticky left-0 bg-background z-10 min-w-[40px]">#</TableHead>
                        <TableHead className="min-w-[160px]">Company</TableHead>
                        <TableHead className="min-w-[160px]">Project</TableHead>
                        <TableHead className="min-w-[100px]">Cashflow</TableHead>
                        <TableHead className="min-w-[140px]">CF Head</TableHead>
                        <TableHead className="text-right min-w-[120px]">Amount ({SCALE_SUFFIXES[cfFmt.scale] || "₹"})</TableHead>
                        <TableHead className="min-w-[100px]">As Per FS</TableHead>
                        <TableHead className="min-w-[100px]">Losses Upto</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {pastLossesData.map((row, idx) => (
                        <TableRow key={row.id} data-testid={`row-past-loss-${row.id}`}>
                          <TableCell className="sticky left-0 bg-background z-10 text-xs text-muted-foreground">{idx + 1}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={row.company || ""}>{row.company || "-"}</TableCell>
                          <TableCell className="text-xs max-w-[200px] truncate" title={row.project || ""}>{row.project || "-"}</TableCell>
                          <TableCell className="text-xs">{row.cashflow || "-"}</TableCell>
                          <TableCell className="text-xs max-w-[180px] truncate" title={row.cfHead || ""}>{row.cfHead || "-"}</TableCell>
                          <TableCell className={`text-right text-xs tabular-nums font-medium ${colorForValue(row.amount || 0)}`}>{row.amount != null ? `₹${formatAmount(row.amount, cfFmt)}` : "-"}</TableCell>
                          <TableCell className="text-xs">{row.asPerFs || "-"}</TableCell>
                          <TableCell className="text-xs">{row.lossesUpto || "-"}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="d1">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D1CashflowStatement rows={filteredDashRows} formatConfig={cfFmt} />
          )}
        </TabsContent>

        <TabsContent value="d2">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D2PlWip rows={filteredDashRows} formatConfig={cfFmt} />
          )}
        </TabsContent>

        <TabsContent value="d3">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D3WorkingCapital rows={filteredDashRows} formatConfig={cfFmt} />
          )}
        </TabsContent>

        <TabsContent value="d4">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D4DebtFinancing rows={filteredDashRows} allRows={allDashRows} formatConfig={cfFmt} />
          )}
        </TabsContent>

        <TabsContent value="d5">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D5InvestorKpis
              rows={filteredDashRows}
              allRows={allDashRows}
              formatConfig={cfFmt}
              onProjectFilter={(project) => {
                setDashFilters(prev => ({ ...prev, projects: [project] }));
              }}
            />
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
