import { useState, useEffect } from "react";
import {
  LayoutDashboard,
  Upload,
  GitCompare,
  IndianRupee,
  Grid3X3,
  Gauge,
  ChevronDown,
  Settings2,
  Database,
  Users,
  LogOut,
  Shield,
  User,
  KeyRound,
  Check,
  X,
  AlertTriangle,
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarHeader,
  SidebarFooter,
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/hooks/use-auth";

function getIcReconItems(isViewer: boolean) {
  const items = [
    { title: "Dashboard", url: "/recon", icon: LayoutDashboard },
    ...(!isViewer ? [{ title: "Upload", url: "/recon/upload", icon: Upload }] : []),
    { title: "RPT Data", url: "/recon/rpt-data", icon: Database },
  ];
  return items;
}

const icReconAdminItems = [
  { title: "Rules", url: "/recon/rules", icon: Settings2 },
];

function getCashflowItems(isViewer: boolean) {
  const items = [
    { title: "Dashboard", url: "/cashflow", icon: IndianRupee },
    { title: "Unmapped Items", url: "/cashflow/unmapped", icon: AlertTriangle },
    ...(!isViewer ? [{ title: "Upload", url: "/cashflow/upload", icon: Upload }] : []),
  ];
  return items;
}

function getIcMatrixItems(isViewer: boolean) {
  const items = [
    { title: "Dashboard", url: "/ic-matrix", icon: Grid3X3 },
    ...(!isViewer ? [{ title: "Upload", url: "/ic-matrix/upload", icon: Upload }] : []),
  ];
  return items;
}

interface NavGroupProps {
  label: string;
  icon: any;
  items: { title: string; url: string; icon: any }[];
  defaultOpen: boolean;
  location: string;
  testId: string;
  linkPrefix: string;
}

function NavGroup({ label, icon: Icon, items, defaultOpen, location, testId, linkPrefix }: NavGroupProps) {
  const isModuleActive = items.some(item => location === item.url) || (linkPrefix === "recon" && location.startsWith("/recon"));
  const [open, setOpen] = useState(defaultOpen || isModuleActive);

  useEffect(() => {
    if (isModuleActive) {
      setOpen(true);
    }
  }, [isModuleActive]);

  const isActive = (url: string) => {
    return location === url;
  };

  return (
    <SidebarGroup>
      <SidebarGroupLabel
        className="cursor-pointer flex items-center justify-between w-full hover:text-sidebar-foreground transition-colors py-2"
        data-testid={testId}
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-2">
          <Icon className="w-4 h-4" />
          <span className="text-[13px] font-bold tracking-wide uppercase">{label}</span>
        </div>
        <ChevronDown className={`w-3.5 h-3.5 transition-transform duration-200 ${open ? "" : "-rotate-90"}`} />
      </SidebarGroupLabel>
      {open && (
        <SidebarGroupContent className="pl-3">
          <SidebarMenu>
            {items.map((item) => (
              <SidebarMenuItem key={item.title}>
                <SidebarMenuButton
                  asChild
                  data-active={isActive(item.url)}
                >
                  <Link href={item.url} data-testid={`link-${linkPrefix}-${item.title.toLowerCase().replace(/\s/g, "-")}`}>
                    <item.icon className="w-4 h-4" />
                    <span>{item.title}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      )}
    </SidebarGroup>
  );
}

const PW_RULES = [
  { label: "At least 8 characters", test: (p: string) => p.length >= 8 },
  { label: "At least one uppercase letter", test: (p: string) => /[A-Z]/.test(p) },
  { label: "At least one lowercase letter", test: (p: string) => /[a-z]/.test(p) },
  { label: "At least one number", test: (p: string) => /[0-9]/.test(p) },
  { label: "At least one special character (!@#$%^&*...)", test: (p: string) => /[!@#$%^&*()_+\-=\[\]{}|;':",.<>?\/\\`~]/.test(p) },
];

function PasswordHints({ password }: { password: string }) {
  if (!password) return null;
  return (
    <div className="mt-2 space-y-1" data-testid="password-requirements-live">
      <p className="text-xs text-muted-foreground font-medium">Password requirements:</p>
      {PW_RULES.map((r, i) => {
        const pass = r.test(password);
        return (
          <p key={i} className={`text-xs flex items-center gap-1.5 ${pass ? "text-emerald-500" : "text-muted-foreground"}`}>
            {pass ? <Check className="w-3 h-3 flex-shrink-0" /> : <X className="w-3 h-3 flex-shrink-0" />}
            {r.label}
          </p>
        );
      })}
    </div>
  );
}

export function AppSidebar() {
  const [location] = useLocation();
  const { user, isAdmin, isViewer, hasModule, logout } = useAuth();
  const { toast } = useToast();
  const [showChangePw, setShowChangePw] = useState(false);
  const [pwFields, setPwFields] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" });
  const [pwLoading, setPwLoading] = useState(false);

  const handleChangePassword = async () => {
    if (pwFields.newPassword !== pwFields.confirmPassword) {
      toast({ title: "Passwords do not match", variant: "destructive" });
      return;
    }
    const hasUpper = /[A-Z]/.test(pwFields.newPassword);
    const hasLower = /[a-z]/.test(pwFields.newPassword);
    const hasNum = /[0-9]/.test(pwFields.newPassword);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{}|;':",.<>?\/\\`~]/.test(pwFields.newPassword);
    if (pwFields.newPassword.length < 8 || !hasUpper || !hasLower || !hasNum || !hasSpecial) {
      toast({ title: "Password must be at least 8 characters with uppercase, lowercase, number, and special character", variant: "destructive" });
      return;
    }
    setPwLoading(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", {
        currentPassword: pwFields.currentPassword,
        newPassword: pwFields.newPassword,
      });
      toast({ title: "Password changed successfully" });
      setShowChangePw(false);
      setPwFields({ currentPassword: "", newPassword: "", confirmPassword: "" });
    } catch (err: any) {
      toast({ title: "Failed to change password", description: err.message?.includes("401") ? "Current password is incorrect" : err.message, variant: "destructive" });
    } finally {
      setPwLoading(false);
    }
  };

  const isReconActive = location.startsWith("/recon");
  const isCashflowActive = location.startsWith("/cashflow");
  const isMatrixActive = location.startsWith("/ic-matrix");

  return (
    <>
      <Sidebar>
        <SidebarHeader className="p-4 border-b border-sidebar-border">
          <Link href="/">
            <div className="flex items-center gap-3 cursor-pointer">
              <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-emerald-500 to-blue-600 flex items-center justify-center shadow-md">
                <Gauge className="w-5 h-5 text-white" />
              </div>
              <div>
                <p className="text-sm font-bold tracking-tight text-white" data-testid="text-app-name">MIS & IC</p>
                <p className="text-[11px] text-sidebar-foreground/60 font-medium">Dashboard Platform</p>
              </div>
            </div>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          {hasModule("cashflow") && (
            <NavGroup
              label="MIS"
              icon={IndianRupee}
              items={getCashflowItems(isViewer)}
              defaultOpen={isCashflowActive}
              location={location}
              testId="group-cashflow"
              linkPrefix="cashflow"
            />
          )}
          {hasModule("ic_matrix") && (
            <NavGroup
              label="IC Matrix"
              icon={Grid3X3}
              items={getIcMatrixItems(isViewer)}
              defaultOpen={isMatrixActive}
              location={location}
              testId="group-ic-matrix"
              linkPrefix="matrix"
            />
          )}
          {hasModule("ic_recon") && (
            <NavGroup
              label="IC Recon"
              icon={GitCompare}
              items={isAdmin ? [...getIcReconItems(isViewer), ...icReconAdminItems] : getIcReconItems(isViewer)}
              defaultOpen={isReconActive}
              location={location}
              testId="group-ic-recon"
              linkPrefix="recon"
            />
          )}

          {isAdmin && (
            <SidebarGroup>
              <SidebarGroupLabel className="py-2">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4" />
                  <span className="text-[13px] font-bold tracking-wide uppercase">Admin</span>
                </div>
              </SidebarGroupLabel>
              <SidebarGroupContent className="pl-3">
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton asChild data-active={location === "/admin/users"}>
                      <Link href="/admin/users" data-testid="link-admin-users">
                        <Users className="w-4 h-4" />
                        <span>Users</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          )}
        </SidebarContent>
        <SidebarFooter className="border-t border-sidebar-border p-3 space-y-2">
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isAdmin ? "bg-amber-500/15 text-amber-400" : isViewer ? "bg-slate-500/15 text-slate-400" : "bg-blue-500/15 text-blue-400"}`}>
              {isAdmin ? <Shield className="w-4 h-4" /> : <User className="w-4 h-4" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-sidebar-foreground truncate" data-testid="text-current-user">
                {user?.displayName || user?.username}
              </p>
              <p className="text-[10px] text-sidebar-foreground/50">
                {isAdmin ? "Admin" : isViewer ? "Viewer" : "Recon User"}
              </p>
            </div>
            <button
              onClick={() => setShowChangePw(true)}
              className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
              data-testid="button-change-password"
              title="Change password"
            >
              <KeyRound className="w-4 h-4" />
            </button>
            <button
              onClick={() => logout.mutate()}
              className="p-1.5 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/50 hover:text-sidebar-foreground transition-colors"
              data-testid="button-logout"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </SidebarFooter>
      </Sidebar>

      <Dialog open={showChangePw} onOpenChange={setShowChangePw}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Change Password</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-1">
              <label className="text-sm font-medium">Current Password</label>
              <Input
                data-testid="input-current-password"
                type="password"
                value={pwFields.currentPassword}
                onChange={(e) => setPwFields({ ...pwFields, currentPassword: e.target.value })}
                placeholder="Enter current password"
              />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">New Password</label>
              <Input
                data-testid="input-new-password"
                type="password"
                value={pwFields.newPassword}
                onChange={(e) => setPwFields({ ...pwFields, newPassword: e.target.value })}
                placeholder="Enter new password"
              />
              <PasswordHints password={pwFields.newPassword} />
            </div>
            <div className="space-y-1">
              <label className="text-sm font-medium">Confirm New Password</label>
              <Input
                data-testid="input-confirm-password"
                type="password"
                value={pwFields.confirmPassword}
                onChange={(e) => setPwFields({ ...pwFields, confirmPassword: e.target.value })}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowChangePw(false)}>Cancel</Button>
            <Button
              onClick={handleChangePassword}
              disabled={pwLoading || !pwFields.currentPassword || !pwFields.newPassword || !pwFields.confirmPassword}
              data-testid="button-submit-change-password"
            >
              {pwLoading ? "Changing..." : "Change Password"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
