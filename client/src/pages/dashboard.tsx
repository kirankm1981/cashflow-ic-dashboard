import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import {
  CheckCircle,
  XCircle,
  TrendingUp,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
} from "lucide-react";
import Workspace from "@/pages/workspace";
import Reports from "@/pages/reports";
import { useDashboardSettings } from "@/hooks/use-dashboard-settings";
import { formatAmount } from "@/lib/number-format";
import { ChartFormatSettings } from "@/components/chart-format-settings";

interface DashboardStats {
  totalTransactions: number;
  matchedTransactions: number;
  unmatchedTransactions: number;
  matchRate: number;
  totalDebit: number;
  totalCredit: number;
  companySummary: { company: string; total: number; matched: number; reversal: number; review: number; suggested: number; unmatched: number; icTotal: number; icReconciled: number }[];
  ruleBreakdown: { rule: string; count: number; matchType: string }[];
  statusBreakdown: { status: string; count: number }[];
  glSources?: { label: string; enterpriseName: string | null; reportPeriod: string | null; icRecords: number }[];
}

const COLORS = [
  "hsl(210, 78%, 42%)",
  "hsl(190, 65%, 38%)",
  "hsl(25, 75%, 42%)",
  "hsl(280, 60%, 45%)",
  "hsl(145, 55%, 40%)",
  "hsl(350, 65%, 45%)",
  "hsl(45, 70%, 50%)",
];

const STATUS_COLORS: Record<string, string> = {
  matched: "hsl(145, 55%, 40%)",
  reversal: "hsl(280, 55%, 50%)",
  review_match: "hsl(185, 60%, 40%)",
  suggested_match: "hsl(30, 80%, 50%)",
  probable: "hsl(40, 70%, 50%)",
  unmatched: "hsl(0, 72%, 50%)",
};

const STATUS_LABELS: Record<string, string> = {
  matched: "Auto Match",
  reversal: "Reversal",
  review_match: "Review Match",
  suggested_match: "Suggested Match",
  probable: "Probable",
  unmatched: "Unmatched",
};

const CLASSIFICATION_BADGE: Record<string, { variant: "default" | "outline" | "secondary"; className: string; label: string }> = {
  AUTO_MATCH: { variant: "default", className: "", label: "Auto" },
  REVERSAL: { variant: "outline", className: "border-purple-500 text-purple-600 dark:text-purple-400", label: "Reversal" },
  REVIEW_MATCH: { variant: "outline", className: "border-teal-500 text-teal-600 dark:text-teal-400", label: "Review" },
  SUGGESTED_MATCH: { variant: "outline", className: "border-orange-500 text-orange-600 dark:text-orange-400", label: "Suggested" },
};


function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

function KPICard({
  title,
  value,
  subtitle,
  icon: Icon,
  trend,
  className,
  extra,
}: {
  title: string;
  value: string;
  subtitle?: string;
  icon: any;
  trend?: "up" | "down";
  className?: string;
  extra?: React.ReactNode;
}) {
  return (
    <Card className={className}>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-2">
          <div className="space-y-1">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{title}</p>
            <p className="text-2xl font-bold" data-testid={`text-kpi-${title.toLowerCase().replace(/\s/g, "-")}`}>
              {value}
            </p>
            {subtitle && (
              <p className="text-xs text-muted-foreground flex items-center gap-1">
                {trend === "up" && <ArrowUpRight className="w-3 h-3 text-green-500" />}
                {trend === "down" && <ArrowDownRight className="w-3 h-3 text-red-500" />}
                {subtitle}
              </p>
            )}
          </div>
          <div className="flex items-center gap-1">
            {extra}
            <div className="p-2 rounded-md bg-primary/10">
              <Icon className="w-5 h-5 text-primary" />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function EntitySummaryContent({ stats, nameMap }: { stats: DashboardStats; nameMap: Record<string, string> }) {
  const displayName = (code: string) => nameMap[code] ? `${nameMap[code]} (${code})` : code;

  if (!stats.companySummary || stats.companySummary.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center justify-center py-16">
          <p className="text-sm text-muted-foreground">No entity data available. Upload GL files and run reconciliation.</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Entity Summary</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="table-entity-summary">
            <thead>
              <tr className="border-b">
                <th className="text-left py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Entity</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Total</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Matched</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Reversal</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Review</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Suggested</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Unmatched</th>
                <th className="text-right py-2.5 px-3 text-xs font-medium text-muted-foreground uppercase">Rate</th>
              </tr>
            </thead>
            <tbody>
              {stats.companySummary.map((cs) => {
                const reconciled = cs.matched + cs.reversal + cs.review + cs.suggested;
                const rate = cs.total > 0 ? (reconciled / cs.total) * 100 : 0;
                return (
                  <tr key={cs.company} className="border-b last:border-0" data-testid={`row-entity-${cs.company}`}>
                    <td className="py-2.5 px-3 font-medium">{displayName(cs.company)}</td>
                    <td className="py-2.5 px-3 text-right">{formatNumber(cs.total)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-600">{formatNumber(cs.matched)}</td>
                    <td className="py-2.5 px-3 text-right text-purple-600">{formatNumber(cs.reversal)}</td>
                    <td className="py-2.5 px-3 text-right text-teal-600">{formatNumber(cs.review)}</td>
                    <td className="py-2.5 px-3 text-right text-orange-600">{formatNumber(cs.suggested)}</td>
                    <td className="py-2.5 px-3 text-right text-red-600">{formatNumber(cs.unmatched)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Badge variant={rate > 90 ? "default" : "secondary"}>
                        {rate.toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              {(() => {
                const t = stats.companySummary.reduce((acc, cs) => ({
                  total: acc.total + cs.total,
                  matched: acc.matched + cs.matched,
                  reversal: acc.reversal + cs.reversal,
                  review: acc.review + cs.review,
                  suggested: acc.suggested + cs.suggested,
                  unmatched: acc.unmatched + cs.unmatched,
                }), { total: 0, matched: 0, reversal: 0, review: 0, suggested: 0, unmatched: 0 });
                const reconciled = t.matched + t.reversal + t.review + t.suggested;
                const rate = t.total > 0 ? (reconciled / t.total) * 100 : 0;
                return (
                  <tr className="border-t-2 font-semibold bg-muted/30" data-testid="row-entity-total">
                    <td className="py-2.5 px-3">Total</td>
                    <td className="py-2.5 px-3 text-right">{formatNumber(t.total)}</td>
                    <td className="py-2.5 px-3 text-right text-emerald-600">{formatNumber(t.matched)}</td>
                    <td className="py-2.5 px-3 text-right text-purple-600">{formatNumber(t.reversal)}</td>
                    <td className="py-2.5 px-3 text-right text-teal-600">{formatNumber(t.review)}</td>
                    <td className="py-2.5 px-3 text-right text-orange-600">{formatNumber(t.suggested)}</td>
                    <td className="py-2.5 px-3 text-right text-red-600">{formatNumber(t.unmatched)}</td>
                    <td className="py-2.5 px-3 text-right">
                      <Badge variant={rate > 90 ? "default" : "secondary"}>
                        {rate.toFixed(1)}%
                      </Badge>
                    </td>
                  </tr>
                );
              })()}
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function OverviewContent({ stats, nameMap }: { stats: DashboardStats; nameMap: Record<string, string> }) {
  const { getFormat } = useDashboardSettings();
  const volumeFmt = getFormat("recon-volume");
  const displayName = (code: string) => nameMap[code] ? `${nameMap[code]} (${code})` : code;
  const pieData = (stats.statusBreakdown || [])
    .filter(s => s.count > 0)
    .map(s => ({
      name: STATUS_LABELS[s.status] || s.status,
      value: s.count,
      fill: STATUS_COLORS[s.status] || "hsl(210, 10%, 60%)",
    }));

  if (pieData.length === 0) {
    pieData.push(
      { name: "Matched", value: stats.matchedTransactions, fill: STATUS_COLORS.matched },
      { name: "Unmatched", value: stats.unmatchedTransactions, fill: STATUS_COLORS.unmatched },
    );
  }

  const barChartHeight = Math.max(350, stats.companySummary.length * 40 + 60);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <KPICard
          title="Total Lines"
          value={formatNumber(stats.totalTransactions)}
          icon={FileText}
        />
        <KPICard
          title="Reconciled"
          value={formatNumber(stats.matchedTransactions)}
          subtitle={`${stats.matchRate.toFixed(1)}% reconciliation rate`}
          icon={CheckCircle}
          trend="up"
        />
        <KPICard
          title="Unmatched"
          value={formatNumber(stats.unmatchedTransactions)}
          subtitle="Requires attention"
          icon={XCircle}
          trend="down"
        />
        <KPICard
          title="Reconciliation Rate"
          value={`${stats.matchRate.toFixed(1)}%`}
          subtitle={`₹${formatAmount(stats.totalDebit, volumeFmt)} total volume`}
          icon={TrendingUp}
          trend="up"
          extra={<ChartFormatSettings chartId="recon-volume" />}
        />
      </div>

      <Card>
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between">
            <CardTitle className="text-base">Company Reconciliation Status</CardTitle>
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { label: "Matched", color: "hsl(145, 55%, 40%)" },
                { label: "Reversal", color: "hsl(280, 55%, 50%)" },
                { label: "Review", color: "hsl(185, 60%, 40%)" },
                { label: "Suggested", color: "hsl(30, 80%, 50%)" },
                { label: "Unmatched", color: "hsl(0, 72%, 50%)" },
              ].map(item => (
                <div key={item.label} className="flex items-center gap-1.5">
                  <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span className="text-[11px] text-muted-foreground">{item.label}</span>
                </div>
              ))}
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {stats.companySummary.length > 0 ? (
            <ResponsiveContainer width="100%" height={barChartHeight}>
              <BarChart
                data={stats.companySummary.map(cs => ({ ...cs, displayCompany: displayName(cs.company) }))}
                layout="vertical"
                margin={{ top: 5, right: 30, bottom: 5, left: 10 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(210, 5%, 85%)" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="displayCompany"
                  tick={{ fontSize: 12, fontWeight: 500 }}
                  width={200}
                  interval={0}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(210, 5%, 96%)",
                    border: "1px solid hsl(210, 5%, 88%)",
                    borderRadius: "6px",
                    fontSize: "12px",
                  }}
                />
                <Bar dataKey="matched" stackId="a" fill="hsl(145, 55%, 40%)" name="Matched" />
                <Bar dataKey="reversal" stackId="a" fill="hsl(280, 55%, 50%)" name="Reversal" />
                <Bar dataKey="review" stackId="a" fill="hsl(185, 60%, 40%)" name="Review" />
                <Bar dataKey="suggested" stackId="a" fill="hsl(30, 80%, 50%)" name="Suggested" />
                <Bar dataKey="unmatched" stackId="a" fill="hsl(0, 72%, 50%)" name="Unmatched" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
              No data available
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Match Distribution</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <ResponsiveContainer width="100%" height={240}>
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    innerRadius={55}
                    outerRadius={80}
                    paddingAngle={4}
                    dataKey="value"
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={index} fill={entry.fill} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(210, 5%, 96%)",
                      border: "1px solid hsl(210, 5%, 88%)",
                      borderRadius: "6px",
                      fontSize: "12px",
                    }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="flex items-center justify-center gap-3 mt-2 flex-wrap">
                {pieData.map((entry) => (
                  <div key={entry.name} className="flex items-center gap-1.5">
                    <div className="w-3 h-3 rounded-sm" style={{ backgroundColor: entry.fill }} />
                    <span className="text-xs">{entry.name}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="space-y-3 pt-4">
              <h4 className="text-sm font-medium mb-2">Rule Breakdown</h4>
              {stats.ruleBreakdown.length > 0 ? (
                stats.ruleBreakdown.map((rb, i) => {
                  const badge = CLASSIFICATION_BADGE[rb.matchType] || CLASSIFICATION_BADGE.AUTO_MATCH;
                  return (
                    <div key={rb.rule} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: COLORS[i % COLORS.length] }}
                        />
                        <span className="text-xs truncate">{rb.rule}</span>
                        <Badge variant={badge.variant} className={`text-[10px] px-1.5 py-0 shrink-0 ${badge.className}`}>
                          {badge.label}
                        </Badge>
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">
                        {rb.count}
                      </Badge>
                    </div>
                  );
                })
              ) : (
                <p className="text-xs text-muted-foreground">Run reconciliation to see rule breakdown</p>
              )}
              {stats.ruleBreakdown.length > 0 && (
                <div className="flex items-center justify-between gap-2 pt-2 border-t mt-2">
                  <span className="text-xs font-semibold">Total</span>
                  <Badge variant="secondary" className="text-xs font-semibold shrink-0">
                    {stats.ruleBreakdown.reduce((s, rb) => s + rb.count, 0)}
                  </Badge>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function Dashboard() {
  const [activeTab, setActiveTab] = useState("overview");
  const { data: stats, isLoading } = useQuery<DashboardStats>({
    queryKey: ["/api/dashboard"],
  });
  const { data: nameMap } = useQuery<Record<string, string>>({
    queryKey: ["/api/company-name-map"],
  });

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">IC Reconciliation Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of intercompany reconciliation status</p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i}>
              <CardContent className="p-5">
                <Skeleton className="h-4 w-24 mb-2" />
                <Skeleton className="h-8 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
          <Card><CardContent className="p-6"><Skeleton className="h-64 w-full" /></CardContent></Card>
        </div>
      </div>
    );
  }

  if (!stats || stats.totalTransactions === 0) {
    return (
      <div className="p-6 space-y-6">
        <div>
          <h1 className="text-2xl font-bold">IC Reconciliation Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of intercompany reconciliation status</p>
        </div>
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList data-testid="tabs-recon-dashboard">
            <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
            <TabsTrigger value="workspace" data-testid="tab-workspace">Workspace</TabsTrigger>
            <TabsTrigger value="entitySummary" data-testid="tab-entity-summary">Entity Summary</TabsTrigger>
            <TabsTrigger value="reports" data-testid="tab-reports">Entity Counter-Party Summary</TabsTrigger>
          </TabsList>
          <TabsContent value="overview">
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                  <FileText className="w-8 h-8 text-muted-foreground" />
                </div>
                <h3 className="text-lg font-semibold mb-1">No Data Yet</h3>
                <p className="text-sm text-muted-foreground text-center max-w-md">
                  Upload your intercompany transaction files to get started with reconciliation. Navigate to the Upload page to begin.
                </p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="workspace"><Workspace embedded /></TabsContent>
          <TabsContent value="entitySummary">
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">No entity data available. Upload GL files and run reconciliation.</p>
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="reports"><Reports embedded /></TabsContent>
        </Tabs>
      </div>
    );
  }

  const reconPeriod = (() => {
    if (!stats?.glSources || stats.glSources.length === 0) return null;
    const periods = stats.glSources.map(s => s.reportPeriod).filter(Boolean);
    const enterprises = stats.glSources.map(s => s.enterpriseName).filter(Boolean);
    if (periods.length === 0 && enterprises.length === 0) return null;
    const uniquePeriods = [...new Set(periods)];
    const uniqueEnterprises = [...new Set(enterprises)];
    return { periods: uniquePeriods, enterprises: uniqueEnterprises };
  })();

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold" data-testid="text-page-title">IC Reconciliation Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Overview of intercompany reconciliation status</p>
        </div>
        {reconPeriod && (
          <div className="text-right shrink-0" data-testid="text-recon-period">
            {reconPeriod.periods.length > 0 && (
              <p className="text-sm font-semibold">
                Period: {reconPeriod.periods.join(" | ")}
              </p>
            )}
            {reconPeriod.enterprises.length > 0 && (
              <p className="text-xs text-muted-foreground mt-0.5">
                {reconPeriod.enterprises.join(", ")}
              </p>
            )}
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-recon-dashboard">
          <TabsTrigger value="overview" data-testid="tab-overview">Overview</TabsTrigger>
          <TabsTrigger value="workspace" data-testid="tab-workspace">Workspace</TabsTrigger>
          <TabsTrigger value="entitySummary" data-testid="tab-entity-summary">Entity Summary</TabsTrigger>
          <TabsTrigger value="reports" data-testid="tab-reports">Entity Counter-Party Summary</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewContent stats={stats} nameMap={nameMap || {}} />
        </TabsContent>
        <TabsContent value="workspace"><Workspace embedded /></TabsContent>
        <TabsContent value="entitySummary">
          <EntitySummaryContent stats={stats} nameMap={nameMap || {}} />
        </TabsContent>
        <TabsContent value="reports"><Reports embedded /></TabsContent>
      </Tabs>
    </div>
  );
}
