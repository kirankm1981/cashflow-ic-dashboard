import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { GitCompare, IndianRupee, Grid3X3, ArrowRight } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "@tanstack/react-query";
import { Skeleton } from "@/components/ui/skeleton";

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function formatDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  try {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return null;
    return d.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
  } catch { return null; }
}

function LastUploadSubline({ hasModule }: { hasModule: (k: string) => boolean }) {
  const { data: tbFiles } = useQuery<any[]>({
    queryKey: ["/api/cashflow/tb-files"],
    enabled: hasModule("cashflow"),
  });
  const { data: glFiles } = useQuery<any[]>({
    queryKey: ["/api/recon/gl-files"],
    enabled: hasModule("ic_recon"),
  });

  const parts: string[] = [];

  if (hasModule("cashflow") && tbFiles && tbFiles.length > 0) {
    const latest = tbFiles.reduce((a: any, b: any) =>
      (a.uploadedAt || "") > (b.uploadedAt || "") ? a : b
    );
    const d = formatDate(latest.uploadedAt);
    if (d) parts.push(`MIS: ${d}`);
  }

  if (hasModule("ic_recon") && glFiles && glFiles.length > 0) {
    const latest = glFiles.reduce((a: any, b: any) =>
      (a.uploadedAt || "") > (b.uploadedAt || "") ? a : b
    );
    const d = formatDate(latest.uploadedAt);
    if (d) parts.push(`IC Recon: ${d}`);
  }

  if (parts.length === 0) return null;

  return (
    <p className="text-sm text-muted-foreground" data-testid="text-last-upload">
      Last upload &mdash; {parts.join(" · ")}
    </p>
  );
}

function MisCardStats() {
  const { data, isLoading } = useQuery<{
    tbFiles: number;
    enterprises: string[];
    periods: string[];
    entityCount: number;
  }>({ queryKey: ["/api/cashflow/summary"] });

  if (isLoading) return <StatsLoader />;
  if (!data || data.tbFiles === 0) return null;

  const entityCount = data.entityCount || 0;
  const lastPeriod = data.periods.length > 0 ? data.periods[data.periods.length - 1] : null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="stats-mis">
      {entityCount > 0 && <span><span className="text-muted-foreground">Entities: </span><span className="font-semibold">{entityCount}</span></span>}
      {lastPeriod && <span><span className="text-muted-foreground">Period: </span><span className="font-semibold">{lastPeriod}</span></span>}
      <span><span className="text-muted-foreground">TB Files: </span><span className="font-semibold">{data.tbFiles}</span></span>
    </div>
  );
}

function IcMatrixCardStats() {
  const { data, isLoading } = useQuery<{
    tbFiles: number;
    totalRecords: number;
    companyMappings: number;
    period: string;
  }>({ queryKey: ["/api/ic-matrix/summary"] });

  if (isLoading) return <StatsLoader />;
  if (!data || data.tbFiles === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="stats-ic-matrix">
      <span><span className="text-muted-foreground">Entities: </span><span className="font-semibold">{data.companyMappings}</span></span>
      {data.period && <span><span className="text-muted-foreground">Period: </span><span className="font-semibold">{data.period}</span></span>}
      <span><span className="text-muted-foreground">Records: </span><span className="font-semibold">{data.totalRecords.toLocaleString()}</span></span>
    </div>
  );
}

function IcReconCardStats() {
  const { data, isLoading } = useQuery<{
    totalTransactions: number;
    matchedTransactions: number;
    unmatchedTransactions: number;
    matchRate: number;
  }>({ queryKey: ["/api/dashboard"] });

  if (isLoading) return <StatsLoader />;
  if (!data || data.totalTransactions === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs" data-testid="stats-ic-recon">
      <span><span className="text-muted-foreground">Match Rate: </span><span className="font-semibold">{data.matchRate.toFixed(1)}%</span></span>
      <span><span className="text-muted-foreground">Unmatched: </span><span className="font-semibold">{data.unmatchedTransactions.toLocaleString()}</span></span>
      <span><span className="text-muted-foreground">Total: </span><span className="font-semibold">{data.totalTransactions.toLocaleString()}</span></span>
    </div>
  );
}

function StatsLoader() {
  return (
    <div className="flex gap-4">
      <Skeleton className="h-4 w-20" />
      <Skeleton className="h-4 w-24" />
      <Skeleton className="h-4 w-16" />
    </div>
  );
}

const statsComponents: Record<string, () => JSX.Element> = {
  cashflow: MisCardStats,
  ic_matrix: IcMatrixCardStats,
  ic_recon: IcReconCardStats,
};

const allModules = [
  {
    key: "cashflow",
    title: "MIS",
    description: "Consolidated financial dashboards covering cashflow, profitability, working capital, debt, and key performance indicators",
    icon: IndianRupee,
    href: "/cashflow",
    gradient: "from-emerald-500 to-teal-600",
    hoverBorder: "hover:border-emerald-400",
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-500",
  },
  {
    key: "ic_matrix",
    title: "IC Matrix",
    description: "Intercompany balance matrix showing positions between entity pairs and net balances",
    icon: Grid3X3,
    href: "/ic-matrix",
    gradient: "from-purple-500 to-violet-600",
    hoverBorder: "hover:border-purple-400",
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-500",
  },
  {
    key: "ic_recon",
    title: "IC Recon",
    description: "Intercompany reconciliation with auto matching rules and exception management",
    icon: GitCompare,
    href: "/recon",
    gradient: "from-blue-500 to-indigo-600",
    hoverBorder: "hover:border-blue-400",
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
  },
];

export default function Landing() {
  const [, navigate] = useLocation();
  const { user, hasModule } = useAuth();
  const modules = allModules.filter(m => hasModule(m.key));
  const displayName = user?.displayName || user?.username || "there";

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-6 md:p-10" data-testid="page-landing">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-1">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight" data-testid="text-landing-title">
            {getGreeting()}, {displayName}
          </h1>
          <LastUploadSubline hasModule={hasModule} />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {modules.map((mod) => {
            const StatsComp = statsComponents[mod.key];
            return (
              <Card
                key={mod.title}
                className={`group cursor-pointer transition-all duration-200 border-2 border-transparent ${mod.hoverBorder} hover:shadow-lg`}
                onClick={() => navigate(mod.href)}
                data-testid={`card-module-${mod.href.replace("/", "")}`}
              >
                <CardContent className="p-6 flex flex-col h-full">
                  <div className={`w-12 h-12 rounded-xl ${mod.iconBg} flex items-center justify-center mb-4`}>
                    <mod.icon className={`w-6 h-6 ${mod.iconColor}`} />
                  </div>
                  <h2 className="text-lg font-semibold mb-2" data-testid={`text-module-title-${mod.href.replace("/", "")}`}>
                    {mod.title}
                  </h2>
                  <div className="mb-4 flex-1 min-h-[2rem]">
                    {StatsComp ? <StatsComp /> : (
                      <p className="text-sm text-muted-foreground">{mod.description}</p>
                    )}
                  </div>
                  <div className="flex items-center justify-end pt-3 border-t">
                    <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
