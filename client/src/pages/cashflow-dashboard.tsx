import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { IndianRupee, TrendingUp, TrendingDown, AlertTriangle, ChevronRight, ChevronDown, Download, Save, RefreshCw, FileDown } from "lucide-react";
import { useState, useMemo, useCallback } from "react";
import { useLocation } from "wouter";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
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
import { useDashboardSettings } from "@/hooks/use-dashboard-settings";
import { formatAmount, SCALE_SUFFIXES } from "@/lib/number-format";
import { ChartFormatSettings } from "@/components/chart-format-settings";
import { DashboardFilters } from "@/components/mis-dashboards/dashboard-filters";
import { D1CashflowStatement } from "@/components/mis-dashboards/d1-cashflow-statement";
import { D2PlWip } from "@/components/mis-dashboards/d2-pl-wip";
import { D3WorkingCapital } from "@/components/mis-dashboards/d3-working-capital";
import { D4DebtFinancing } from "@/components/mis-dashboards/d4-debt-financing";
import { D5InvestorKpis } from "@/components/mis-dashboards/d5-investor-kpis";
import { filterRows, type FilterState, type DashboardDataResponse } from "@/components/mis-dashboards/types";


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

interface UnmappedGLItem {
  id: number;
  accountHead: string;
  group1: string;
  group2: string;
  group3: string;
  group4: string;
  group5: string;
  cashflow: string;
  cfHead: string;
  activityType: string;
  cfStatementLine: string;
  plCategory: string;
  plSign: number;
  wipComponent: string;
  wcBucket: string;
  wcSign: number;
  debtBucket: string;
  kpiTag: string;
  netClosingBalance: number;
  rowCount: number;
}

interface UnmappedEntityItem {
  id: number;
  company: string;
  businessUnit: string;
  structure: string;
  projectName: string;
  entityStatus: string;
  remarks: string;
  netClosingBalance: number;
  rowCount: number;
}

interface UnmappedResponse {
  unmappedGLs: {
    count: number;
    items: UnmappedGLItem[];
  };
  unmappedEntities: {
    count: number;
    items: UnmappedEntityItem[];
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
  const [dashFilters, setDashFilters] = useState<FilterState>({ companies: [], projects: [], period: null });
  const { getFormat } = useDashboardSettings();
  const cfFmt = getFormat("cf-amounts");

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

  const { data: dashboardData, isLoading: loadingDashData } = useQuery<DashboardDataResponse>({
    queryKey: ["/api/cashflow/dashboard-data"],
  });

  const { toast } = useToast();
  const [glEdits, setGlEdits] = useState<Record<string, Partial<UnmappedGLItem>>>({});
  const [entityEdits, setEntityEdits] = useState<Record<string, Partial<UnmappedEntityItem>>>({});
  const [savingGLs, setSavingGLs] = useState(false);
  const [savingEntities, setSavingEntities] = useState(false);

  const updateGLField = useCallback((accountHead: string, field: string, value: string | number) => {
    setGlEdits(prev => ({
      ...prev,
      [accountHead]: { ...prev[accountHead], [field]: value },
    }));
  }, []);

  const updateEntityField = useCallback((company: string, field: string, value: string) => {
    setEntityEdits(prev => ({
      ...prev,
      [company]: { ...prev[company], [field]: value },
    }));
  }, []);

  const getGLValue = useCallback((item: UnmappedGLItem, field: keyof UnmappedGLItem) => {
    const edit = glEdits[item.accountHead];
    if (edit && field in edit) return edit[field as keyof typeof edit];
    return item[field];
  }, [glEdits]);

  const getEntityValue = useCallback((item: UnmappedEntityItem, field: keyof UnmappedEntityItem) => {
    const edit = entityEdits[item.company];
    if (edit && field in edit) return edit[field as keyof typeof edit];
    return item[field];
  }, [entityEdits]);

  const hasGLEdits = Object.keys(glEdits).length > 0;
  const hasEntityEdits = Object.keys(entityEdits).length > 0;

  const saveGLMappings = async () => {
    const updates = Object.entries(glEdits).map(([accountHead, edits]) => {
      const original = unmappedResult?.unmappedGLs?.items?.find(i => i.accountHead === accountHead);
      return {
        accountHead,
        cashflow: edits.cashflow ?? original?.cashflow ?? "",
        cfHead: edits.cfHead ?? original?.cfHead ?? "",
        activityType: edits.activityType ?? original?.activityType ?? "",
        cfStatementLine: edits.cfStatementLine ?? original?.cfStatementLine ?? "",
        plCategory: edits.plCategory ?? original?.plCategory ?? "",
        plSign: edits.plSign != null ? Number(edits.plSign) : (original?.plSign ?? 0),
        wipComponent: edits.wipComponent ?? original?.wipComponent ?? "",
        wcBucket: edits.wcBucket ?? original?.wcBucket ?? "",
        wcSign: edits.wcSign != null ? Number(edits.wcSign) : (original?.wcSign ?? 0),
        debtBucket: edits.debtBucket ?? original?.debtBucket ?? "",
        kpiTag: edits.kpiTag ?? original?.kpiTag ?? "",
      };
    });
    setSavingGLs(true);
    try {
      await apiRequest("POST", "/api/cashflow/update-gl-mapping", { updates });
      setGlEdits({});
      toast({ title: "GL mappings saved", description: `${updates.length} mapping(s) updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
    } catch (e: any) {
      toast({ title: "Error saving GL mappings", description: e.message, variant: "destructive" });
    } finally {
      setSavingGLs(false);
    }
  };

  const saveEntityMappings = async () => {
    const updates = Object.entries(entityEdits).map(([company, edits]) => {
      const original = unmappedResult?.unmappedEntities?.items?.find(i => i.company === company);
      return {
        company,
        businessUnit: original?.businessUnit ?? "",
        structure: edits.structure ?? original?.structure ?? "",
        projectName: edits.projectName ?? original?.projectName ?? "",
        entityStatus: edits.entityStatus ?? original?.entityStatus ?? "",
        remarks: edits.remarks ?? original?.remarks ?? "",
      };
    });
    setSavingEntities(true);
    try {
      await apiRequest("POST", "/api/cashflow/update-entity-mapping", { updates });
      setEntityEdits({});
      toast({ title: "Entity mappings saved", description: `${updates.length} mapping(s) updated` });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/mapping-summary"] });
    } catch (e: any) {
      toast({ title: "Error saving entity mappings", description: e.message, variant: "destructive" });
    } finally {
      setSavingEntities(false);
    }
  };

  const reprocessAfterSave = async () => {
    try {
      await apiRequest("POST", "/api/cashflow/reprocess");
      toast({ title: "Reprocessing complete", description: "TB data has been reprocessed with updated mappings" });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unmapped-items"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/unified-data"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/summary"] });
      queryClient.invalidateQueries({ queryKey: ["/api/cashflow/dashboard-data"] });
    } catch (e: any) {
      toast({ title: "Reprocess failed", description: e.message, variant: "destructive" });
    }
  };

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

  const unmappedGLCount = unmappedResult?.unmappedGLs?.count || 0;
  const unmappedEntityCount = unmappedResult?.unmappedEntities?.count || 0;
  const totalUnmapped = (unmappedResult?.unmappedGLs?.items?.length || 0) + (unmappedResult?.unmappedEntities?.items?.length || 0);

  const hasData = (summary?.tbFiles || 0) > 0 || (unifiedResult?.totalCount || 0) > 0;

  if (loadingSummary || loadingUnified) {
    return (
      <div className="p-6 space-y-6" data-testid="page-cashflow-dashboard">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Assetz MIS</h1>
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
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-title">Assetz MIS</h1>
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
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-cashflow-title">Assetz MIS</h1>
          <p className="text-muted-foreground text-sm mt-1">Monitor and analyze cashflows across entities</p>
        </div>
        {(periodDisplay || enterpriseDisplay) && (
          <div className="text-right shrink-0" data-testid="text-cf-period">
            {periodDisplay && <p className="text-sm font-semibold">{periodDisplay}</p>}
            {enterpriseDisplay && <p className="text-xs text-muted-foreground mt-0.5">{enterpriseDisplay}</p>}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-cashflow-dashboard">
          <TabsTrigger value="dashboard" data-testid="tab-cf-dashboard">Dashboard</TabsTrigger>
          <TabsTrigger value="detailed" data-testid="tab-cf-detailed">Detailed MIS</TabsTrigger>
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
          <TabsTrigger value="d1" data-testid="tab-d1">CF Statement</TabsTrigger>
          <TabsTrigger value="d2" data-testid="tab-d2">P&L & WIP</TabsTrigger>
          <TabsTrigger value="d3" data-testid="tab-d3">Working Capital</TabsTrigger>
          <TabsTrigger value="d4" data-testid="tab-d4">Debt & Finance</TabsTrigger>
          <TabsTrigger value="d5" data-testid="tab-d5">Investor KPIs</TabsTrigger>
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

        <TabsContent value="dashboard" className="space-y-4">
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
                    <p className="text-2xl font-bold text-green-600">₹{formatAmount(totalInflow, cfFmt)}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <ChartFormatSettings chartId="cf-amounts" />
                    <div className="p-2 rounded-md bg-green-500/10"><TrendingUp className="w-5 h-5 text-green-500" /></div>
                  </div>
                </div>
              </CardContent>
            </Card>
            <Card data-testid="card-total-outflows">
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Total Outflow</p>
                    <p className="text-2xl font-bold text-red-600">₹{formatAmount(totalOutflow, cfFmt)}</p>
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
                    <p className="text-2xl font-bold">₹{formatAmount(totalCashBank, cfFmt)}</p>
                  </div>
                  <div className="p-2 rounded-md bg-blue-500/10"><IndianRupee className="w-5 h-5 text-blue-500" /></div>
                </div>
              </CardContent>
            </Card>
          </div>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="overflow-hidden border-0 shadow-sm bg-white dark:bg-zinc-900">
              <CardHeader className="pb-0 pt-5 px-6">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-semibold text-gray-900 dark:text-zinc-100">Cashflow by Type</CardTitle>
                    <p className="text-[11px] text-gray-400 dark:text-zinc-500 mt-0.5">Amount in ₹{SCALE_SUFFIXES[cfFmt.scale] ? ` ${SCALE_SUFFIXES[cfFmt.scale]}` : ""}</p>
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
                        tickFormatter={(v: number) => formatAmount(v, cfFmt)}
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
                        <LabelList dataKey="value" position="top" formatter={(v: number) => v ? `₹${formatAmount(v, cfFmt)}` : ""} style={{ fontSize: 10, fontWeight: 600, fill: CHART_COLORS.axisLabel }} />
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
                        tickFormatter={(v: number) => formatAmount(v, cfFmt)}
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
                <CardTitle className="text-base">Detailed MIS — Type / CF Head / Projects</CardTitle>
                <div className="flex items-center gap-2">
                  <Badge variant="secondary" className="text-xs">
                    {pivotData.projectList.length} projects
                  </Badge>
                  <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-detailed", "_blank")} data-testid="button-download-detailed">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                </div>
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
                                {row.projects[proj] ? `₹${formatAmount(row.projects[proj], cfFmt)}` : "—"}
                              </TableCell>
                            ))}
                            <TableCell className="text-right text-sm font-bold">₹{formatAmount(row.total, cfFmt)}</TableCell>
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
                              {row.projects[proj] ? `₹${formatAmount(row.projects[proj], cfFmt)}` : "—"}
                            </TableCell>
                          ))}
                          <TableCell className="text-right text-xs font-medium">₹{formatAmount(row.total, cfFmt)}</TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="unmapped" className="space-y-6">
          {loadingUnmapped ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <>
              <div className="flex items-center justify-between flex-wrap gap-2">
                <div className="flex items-center gap-3">
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    {unmappedGLCount} unmapped GL rows
                  </Badge>
                  <Badge variant="outline" className="text-amber-600 border-amber-300">
                    {unmappedEntityCount} unmapped entity rows
                  </Badge>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-unmapped", "_blank")} data-testid="button-download-unmapped">
                    <Download className="w-4 h-4 mr-1" />
                    Download Unmapped
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-mapping", "_blank")} data-testid="button-download-mapping">
                    <FileDown className="w-4 h-4 mr-1" />
                    Download Mapping File
                  </Button>
                  {(hasGLEdits || hasEntityEdits) && (
                    <Button size="sm" variant="default" onClick={reprocessAfterSave} data-testid="button-reprocess-unmapped">
                      <RefreshCw className="w-4 h-4 mr-1" />
                      Reprocess TB
                    </Button>
                  )}
                </div>
              </div>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Unmapped GLs — Account Head Mapping
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {hasGLEdits && (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {Object.keys(glEdits).length} edited
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        disabled={!hasGLEdits || savingGLs}
                        onClick={saveGLMappings}
                        data-testid="button-save-gl-mappings"
                      >
                        <Save className="w-4 h-4 mr-1" />
                        {savingGLs ? "Saving..." : "Save GL Mappings"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    TB lines where Cashflow or CF Head is blank. Edit cells below to update the mapping directly.
                  </p>
                </CardHeader>
                <CardContent>
                  {unmappedGLCount === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-all-gl-mapped">All GL items are mapped</div>
                  ) : (
                    <div className="overflow-auto max-h-[500px] border rounded-md">
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted z-10">
                          <TableRow>
                            <TableHead className="min-w-[200px]">Account Head</TableHead>
                            <TableHead className="min-w-[100px]">Group 1</TableHead>
                            <TableHead className="min-w-[100px]">Group 2</TableHead>
                            <TableHead className="min-w-[100px]">Group 3</TableHead>
                            <TableHead className="text-right min-w-[120px]">Net Balance</TableHead>
                            <TableHead className="text-right min-w-[60px]">Rows</TableHead>
                            <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">Cashflow</TableHead>
                            <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">CF Head</TableHead>
                            <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">Activity Type</TableHead>
                            <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">CF Statement Line</TableHead>
                            <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">P&L Category</TableHead>
                            <TableHead className="min-w-[80px] bg-green-50 dark:bg-green-950">P&L Sign</TableHead>
                            <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">WIP Component</TableHead>
                            <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">WC Bucket</TableHead>
                            <TableHead className="min-w-[80px] bg-green-50 dark:bg-green-950">WC Sign</TableHead>
                            <TableHead className="min-w-[120px] bg-green-50 dark:bg-green-950">Debt Bucket</TableHead>
                            <TableHead className="min-w-[100px] bg-green-50 dark:bg-green-950">KPI Tag</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {unmappedResult?.unmappedGLs?.items?.map((item) => (
                            <TableRow key={item.id} data-testid={`unmapped-gl-${item.id}`} className={glEdits[item.accountHead] ? "bg-blue-50/50 dark:bg-blue-950/30" : ""}>
                              <TableCell className="text-xs font-medium">{item.accountHead}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.group1}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.group2}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.group3}</TableCell>
                              <TableCell className={`text-right text-xs font-mono ${(item.netClosingBalance || 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                                ₹{formatAmount(item.netClosingBalance || 0, cfFmt)}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">{item.rowCount}</TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "cashflow") || "")} onChange={(e) => updateGLField(item.accountHead, "cashflow", e.target.value)} data-testid={`input-gl-cashflow-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "cfHead") || "")} onChange={(e) => updateGLField(item.accountHead, "cfHead", e.target.value)} data-testid={`input-gl-cfhead-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "activityType") || "")} onChange={(e) => updateGLField(item.accountHead, "activityType", e.target.value)} data-testid={`input-gl-activity-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "cfStatementLine") || "")} onChange={(e) => updateGLField(item.accountHead, "cfStatementLine", e.target.value)} data-testid={`input-gl-cfline-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "plCategory") || "")} onChange={(e) => updateGLField(item.accountHead, "plCategory", e.target.value)} data-testid={`input-gl-plcat-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs w-16" type="number" value={String(getGLValue(item, "plSign") ?? 0)} onChange={(e) => updateGLField(item.accountHead, "plSign", parseFloat(e.target.value) || 0)} data-testid={`input-gl-plsign-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "wipComponent") || "")} onChange={(e) => updateGLField(item.accountHead, "wipComponent", e.target.value)} data-testid={`input-gl-wip-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "wcBucket") || "")} onChange={(e) => updateGLField(item.accountHead, "wcBucket", e.target.value)} data-testid={`input-gl-wcbucket-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs w-16" type="number" value={String(getGLValue(item, "wcSign") ?? 0)} onChange={(e) => updateGLField(item.accountHead, "wcSign", parseFloat(e.target.value) || 0)} data-testid={`input-gl-wcsign-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "debtBucket") || "")} onChange={(e) => updateGLField(item.accountHead, "debtBucket", e.target.value)} data-testid={`input-gl-debt-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getGLValue(item, "kpiTag") || "")} onChange={(e) => updateGLField(item.accountHead, "kpiTag", e.target.value)} data-testid={`input-gl-kpi-${item.id}`} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base flex items-center gap-2">
                      <AlertTriangle className="w-4 h-4 text-amber-500" />
                      Unmapped Entities — Company Mapping
                    </CardTitle>
                    <div className="flex items-center gap-2">
                      {hasEntityEdits && (
                        <Badge variant="secondary" className="bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">
                          {Object.keys(entityEdits).length} edited
                        </Badge>
                      )}
                      <Button
                        size="sm"
                        disabled={!hasEntityEdits || savingEntities}
                        onClick={saveEntityMappings}
                        data-testid="button-save-entity-mappings"
                      >
                        <Save className="w-4 h-4 mr-1" />
                        {savingEntities ? "Saving..." : "Save Entity Mappings"}
                      </Button>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    TB lines where Project or Entity Status is blank. Edit cells below to update the mapping directly.
                  </p>
                </CardHeader>
                <CardContent>
                  {unmappedEntityCount === 0 ? (
                    <div className="text-center py-8 text-sm text-muted-foreground" data-testid="text-all-entity-mapped">All entities are mapped</div>
                  ) : (
                    <div className="overflow-auto max-h-[400px] border rounded-md">
                      <Table>
                        <TableHeader className="sticky top-0 bg-muted z-10">
                          <TableRow>
                            <TableHead className="min-w-[200px]">Company</TableHead>
                            <TableHead className="min-w-[120px]">Business Unit</TableHead>
                            <TableHead className="text-right min-w-[120px]">Net Balance</TableHead>
                            <TableHead className="text-right min-w-[60px]">Rows</TableHead>
                            <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">Structure</TableHead>
                            <TableHead className="min-w-[200px] bg-green-50 dark:bg-green-950">Project Name</TableHead>
                            <TableHead className="min-w-[130px] bg-green-50 dark:bg-green-950">Entity Status</TableHead>
                            <TableHead className="min-w-[150px] bg-green-50 dark:bg-green-950">Remarks</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {unmappedResult?.unmappedEntities?.items?.map((item) => (
                            <TableRow key={item.id} data-testid={`unmapped-entity-${item.id}`} className={entityEdits[item.company] ? "bg-blue-50/50 dark:bg-blue-950/30" : ""}>
                              <TableCell className="text-xs font-medium">{item.company}</TableCell>
                              <TableCell className="text-xs text-muted-foreground">{item.businessUnit}</TableCell>
                              <TableCell className={`text-right text-xs font-mono ${(item.netClosingBalance || 0) < 0 ? "text-red-600" : "text-green-600"}`}>
                                ₹{formatAmount(item.netClosingBalance || 0, cfFmt)}
                              </TableCell>
                              <TableCell className="text-right text-xs text-muted-foreground">{item.rowCount}</TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getEntityValue(item, "structure") || "")} onChange={(e) => updateEntityField(item.company, "structure", e.target.value)} data-testid={`input-entity-structure-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getEntityValue(item, "projectName") || "")} onChange={(e) => updateEntityField(item.company, "projectName", e.target.value)} data-testid={`input-entity-project-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getEntityValue(item, "entityStatus") || "")} onChange={(e) => updateEntityField(item.company, "entityStatus", e.target.value)} data-testid={`input-entity-status-${item.id}`} />
                              </TableCell>
                              <TableCell className="p-1 bg-green-50/50 dark:bg-green-950/30">
                                <Input className="h-7 text-xs" value={String(getEntityValue(item, "remarks") || "")} onChange={(e) => updateEntityField(item.company, "remarks", e.target.value)} data-testid={`input-entity-remarks-${item.id}`} />
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="pastLosses" className="space-y-4">
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-lg">Past Losses</CardTitle>
                  <p className="text-sm text-muted-foreground">
                    {pastLossesData?.length || 0} records from mapping file
                  </p>
                </div>
                {pastLossesData && pastLossesData.length > 0 && (
                  <Button variant="outline" size="sm" onClick={() => window.open("/api/cashflow/download-past-losses", "_blank")} data-testid="button-download-past-losses">
                    <Download className="w-4 h-4 mr-1" />
                    Download
                  </Button>
                )}
              </div>
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
                          <TableCell className="text-right tabular-nums font-medium">{row.amount != null ? `₹${formatAmount(row.amount, cfFmt)}` : "-"}</TableCell>
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

        <TabsContent value="d1">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D1CashflowStatement rows={filteredDashRows} />
          )}
        </TabsContent>

        <TabsContent value="d2">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D2PlWip rows={filteredDashRows} />
          )}
        </TabsContent>

        <TabsContent value="d3">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D3WorkingCapital rows={filteredDashRows} />
          )}
        </TabsContent>

        <TabsContent value="d4">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D4DebtFinancing rows={filteredDashRows} allRows={allDashRows} />
          )}
        </TabsContent>

        <TabsContent value="d5">
          {loadingDashData ? (
            <div className="space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-24 w-full" />)}</div>
          ) : (
            <D5InvestorKpis
              rows={filteredDashRows}
              allRows={allDashRows}
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
