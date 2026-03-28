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
} from "lucide-react";
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
} from "@/components/ui/sidebar";
import { Link, useLocation } from "wouter";

const icReconItems = [
  { title: "Dashboard", url: "/recon", icon: LayoutDashboard },
  { title: "Upload", url: "/recon/upload", icon: Upload },
  { title: "RPT Data", url: "/recon/rpt-data", icon: Database },
  { title: "Rules", url: "/recon/rules", icon: Settings2 },
];

const cashflowItems = [
  { title: "Dashboard", url: "/cashflow", icon: IndianRupee },
  { title: "Upload", url: "/cashflow/upload", icon: Upload },
];

const icMatrixItems = [
  { title: "Dashboard", url: "/ic-matrix", icon: Grid3X3 },
  { title: "Upload", url: "/ic-matrix/upload", icon: Upload },
];

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

export function AppSidebar() {
  const [location] = useLocation();

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
                <p className="text-sm font-bold tracking-tight text-white" data-testid="text-app-name">Cashflow & IC</p>
                <p className="text-[11px] text-sidebar-foreground/60 font-medium">Dashboard Platform</p>
              </div>
            </div>
          </Link>
        </SidebarHeader>
        <SidebarContent>
          <NavGroup
            label="Cashflow"
            icon={IndianRupee}
            items={cashflowItems}
            defaultOpen={isCashflowActive}
            location={location}
            testId="group-cashflow"
            linkPrefix="cashflow"
          />
          <NavGroup
            label="IC Matrix"
            icon={Grid3X3}
            items={icMatrixItems}
            defaultOpen={isMatrixActive}
            location={location}
            testId="group-ic-matrix"
            linkPrefix="matrix"
          />
          <NavGroup
            label="IC Recon"
            icon={GitCompare}
            items={icReconItems}
            defaultOpen={isReconActive}
            location={location}
            testId="group-ic-recon"
            linkPrefix="recon"
          />
        </SidebarContent>
      </Sidebar>
    </>
  );
}
