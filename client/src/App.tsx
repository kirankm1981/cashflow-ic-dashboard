import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import { AppSidebar } from "@/components/app-sidebar";
import NotFound from "@/pages/not-found";
import Landing from "@/pages/landing";
import Dashboard from "@/pages/dashboard";
import UploadPage from "@/pages/upload";
import Workspace from "@/pages/workspace";
import RuleConfig from "@/pages/rule-config";
import AuditTrail from "@/pages/audit-trail";
import Reports from "@/pages/reports";
import CashflowDashboard from "@/pages/cashflow-dashboard";
import CashflowUpload from "@/pages/cashflow-upload";
import CashflowUnmapped from "@/pages/cashflow-unmapped";
import IcMatrix from "@/pages/ic-matrix";
import IcMatrixUpload from "@/pages/ic-matrix-upload";
import RptDataPage from "@/pages/rpt-data";
import LoginPage from "@/pages/login";
import ForceChangePassword from "@/pages/force-change-password";
import UserManagement from "@/pages/user-management";
import { useLocation, Redirect } from "wouter";
import { ErrorBoundary } from "@/components/error-boundary";
import { UploadManagerProvider } from "@/lib/upload-manager";
import GlobalUploadNotifications from "@/components/global-upload-notifications";
import { useAuth } from "@/hooks/use-auth";

function PageTitle() {
  const [location] = useLocation();
  const titles: Record<string, string> = {
    "/": "Home",
    "/recon": "IC Recon",
    "/recon/upload": "Upload Transactions",
    "/recon/workspace": "Reconciliation Workspace",
    "/recon/reports": "Reports",
    "/recon/rpt-data": "RPT Data",
    "/recon/rules": "Rule Configuration",
    "/recon/audit": "Audit Trail",
    "/cashflow": "MIS",
    "/cashflow/upload": "MIS Upload",
    "/cashflow/unmapped": "Unmapped Items",
    "/ic-matrix": "IC Matrix",
    "/ic-matrix/upload": "Upload TB Files",
    "/admin/users": "User Management",
  };
  const module = location === "/" ? "Platform"
    : location.startsWith("/admin") ? "Admin"
    : location.startsWith("/cashflow") ? "MIS"
    : location.startsWith("/ic-matrix") ? "IC Matrix"
    : "IC Recon";
  const colors: Record<string, string> = {
    "IC Recon": "text-blue-500",
    "MIS": "text-emerald-500",
    "IC Matrix": "text-purple-500",
    "Admin": "text-amber-500",
  };
  return (
    <div className="flex items-center gap-2">
      <span className={`text-xs font-medium ${colors[module] || ""}`} data-testid="text-active-module">{module}</span>
      <span className="text-muted-foreground/40">|</span>
      <span className="text-xs text-muted-foreground" data-testid="text-page-title">{titles[location] || "Assetz Strata"}</span>
    </div>
  );
}

function ViewerGuard({ component: Component }: { component: React.ComponentType }) {
  const { isViewer } = useAuth();
  if (isViewer) return <Redirect to="/" />;
  return <Component />;
}

function ModuleGuard({ module, component: Component }: { module: string; component: React.ComponentType }) {
  const { hasModule } = useAuth();
  if (!hasModule(module)) return <Redirect to="/" />;
  return <Component />;
}

function ModuleViewerGuard({ module, component: Component }: { module: string; component: React.ComponentType }) {
  const { isViewer, hasModule } = useAuth();
  if (!hasModule(module)) return <Redirect to="/" />;
  if (isViewer) return <Redirect to="/" />;
  return <Component />;
}

function Router() {
  return (
    <Switch>
      <Route path="/">{() => <ErrorBoundary><Landing /></ErrorBoundary>}</Route>
      <Route path="/recon">{() => <ErrorBoundary><ModuleGuard module="ic_recon" component={Dashboard} /></ErrorBoundary>}</Route>
      <Route path="/recon/upload">{() => <ErrorBoundary><ModuleViewerGuard module="ic_recon" component={UploadPage} /></ErrorBoundary>}</Route>
      <Route path="/recon/workspace">{() => <ErrorBoundary><ModuleGuard module="ic_recon" component={Workspace} /></ErrorBoundary>}</Route>
      <Route path="/recon/rpt-data">{() => <ErrorBoundary><ModuleGuard module="ic_recon" component={RptDataPage} /></ErrorBoundary>}</Route>
      <Route path="/recon/rules">{() => <ErrorBoundary><ModuleGuard module="ic_recon" component={RuleConfig} /></ErrorBoundary>}</Route>
      <Route path="/recon/audit">{() => <ErrorBoundary><ModuleGuard module="ic_recon" component={AuditTrail} /></ErrorBoundary>}</Route>
      <Route path="/recon/reports">{() => <ErrorBoundary><ModuleGuard module="ic_recon" component={Reports} /></ErrorBoundary>}</Route>
      <Route path="/cashflow">{() => <ErrorBoundary><ModuleGuard module="cashflow" component={CashflowDashboard} /></ErrorBoundary>}</Route>
      <Route path="/cashflow/unmapped">{() => <ErrorBoundary><ModuleViewerGuard module="cashflow" component={CashflowUnmapped} /></ErrorBoundary>}</Route>
      <Route path="/cashflow/upload">{() => <ErrorBoundary><ModuleViewerGuard module="cashflow" component={CashflowUpload} /></ErrorBoundary>}</Route>
      <Route path="/ic-matrix">{() => <ErrorBoundary><ModuleGuard module="ic_matrix" component={IcMatrix} /></ErrorBoundary>}</Route>
      <Route path="/ic-matrix/upload">{() => <ErrorBoundary><ModuleViewerGuard module="ic_matrix" component={IcMatrixUpload} /></ErrorBoundary>}</Route>
      <Route path="/admin/users">{() => <ErrorBoundary><UserManagement /></ErrorBoundary>}</Route>
      <Route component={NotFound} />
    </Switch>
  );
}

const sidebarStyle = {
  "--sidebar-width": "16rem",
  "--sidebar-width-icon": "3rem",
};

function AuthenticatedApp() {
  return (
    <UploadManagerProvider>
      <SidebarProvider style={sidebarStyle as React.CSSProperties}>
        <div className="flex h-screen w-full">
          <AppSidebar />
          <div className="flex flex-col flex-1 min-w-0">
            <header className="flex items-center gap-2 p-2 border-b shrink-0">
              <SidebarTrigger data-testid="button-sidebar-toggle" />
              <PageTitle />
            </header>
            <main className="flex-1 overflow-auto">
              <Router />
            </main>
          </div>
        </div>
      </SidebarProvider>
      <GlobalUploadNotifications />
    </UploadManagerProvider>
  );
}

function AppGate() {
  const { isAuthenticated, isLoading, mustChangePassword } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  if (mustChangePassword) {
    return <ForceChangePassword />;
  }

  return <AuthenticatedApp />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AppGate />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
