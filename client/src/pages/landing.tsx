import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { GitCompare, IndianRupee, Grid3X3, ArrowRight } from "lucide-react";

const modules = [
  {
    title: "Cashflow Dashboard",
    description: "Monitor and analyze intercompany cash flows, track inflows and outflows across all entities",
    icon: IndianRupee,
    href: "/cashflow",
    gradient: "from-emerald-500 to-teal-600",
    hoverBorder: "hover:border-emerald-400",
    iconBg: "bg-emerald-500/10",
    iconColor: "text-emerald-500",
    stats: [
      { label: "Module Status", value: "Ready" },
    ],
  },
  {
    title: "IC Matrix",
    description: "Intercompany balance matrix showing positions between entity pairs and net balances",
    icon: Grid3X3,
    href: "/ic-matrix",
    gradient: "from-purple-500 to-violet-600",
    hoverBorder: "hover:border-purple-400",
    iconBg: "bg-purple-500/10",
    iconColor: "text-purple-500",
    stats: [
      { label: "Module Status", value: "Ready" },
    ],
  },
  {
    title: "IC Recon",
    description: "Intercompany reconciliation with auto matching rules and exception management",
    icon: GitCompare,
    href: "/recon",
    gradient: "from-blue-500 to-indigo-600",
    hoverBorder: "hover:border-blue-400",
    iconBg: "bg-blue-500/10",
    iconColor: "text-blue-500",
    stats: [
      { label: "Module Status", value: "Ready" },
    ],
  },
];

export default function Landing() {
  const [, navigate] = useLocation();

  return (
    <div className="flex flex-col items-center justify-center min-h-full p-6 md:p-10" data-testid="page-landing">
      <div className="max-w-4xl w-full space-y-8">
        <div className="text-center space-y-2">
          <h1 className="text-3xl md:text-4xl font-bold tracking-tight" data-testid="text-landing-title">
            Cashflow & IC Dashboard
          </h1>
          <p className="text-muted-foreground text-sm md:text-base max-w-xl mx-auto">
            Intercompany reconciliation, cashflow reporting, IC Balance matrix and IC Net off
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {modules.map((mod) => (
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
                <p className="text-sm text-muted-foreground mb-4 flex-1">
                  {mod.description}
                </p>
                <div className="flex items-center justify-between pt-3 border-t">
                  <div className="flex gap-4">
                    {mod.stats.map((s) => (
                      <div key={s.label} className="text-xs">
                        <span className="text-muted-foreground">{s.label}: </span>
                        <span className="font-semibold">{s.value}</span>
                      </div>
                    ))}
                  </div>
                  <ArrowRight className="w-4 h-4 text-muted-foreground group-hover:translate-x-1 transition-transform" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </div>
  );
}
