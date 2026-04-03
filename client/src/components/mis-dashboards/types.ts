export interface DashboardRow {
  tbFileId: number;
  company: string;
  projectName: string | null;
  entityStatus: string | null;
  accountHead: string | null;
  cashflow: string | null;
  cfHead: string | null;
  activityType: string | null;
  cfStatementLine: string | null;
  plCategory: string | null;
  plSign: number | null;
  wipComponent: string | null;
  wcBucket: string | null;
  wcSign: number | null;
  debtBucket: string | null;
  kpiTag: string | null;
  openingDebit: number | null;
  openingCredit: number | null;
  periodDebit: number | null;
  periodCredit: number | null;
  closingDebit: number | null;
  closingCredit: number | null;
  netOpeningBalance: number | null;
  netClosingBalance: number | null;
  periodTag: string | null;
  enterprise: string | null;
  openingNet: number;
  periodNet: number;
  closingNet: number;
}

export interface DashboardDataResponse {
  rows: DashboardRow[];
  companies: string[];
  projects: string[];
  periods: string[];
}

export interface FilterState {
  companies: string[];
  projects: string[];
  period: string | null;
}

export function filterRows(rows: DashboardRow[], filters: FilterState): DashboardRow[] {
  return rows.filter(r => {
    if (filters.companies.length > 0 && !filters.companies.includes(r.company)) return false;
    if (filters.projects.length > 0 && !filters.projects.includes(r.projectName || "")) return false;
    if (filters.period && r.periodTag !== filters.period) return false;
    return true;
  });
}

export function fmt(value: number, decimals = 2): string {
  const lakhs = value / 100000;
  const abs = Math.abs(lakhs);
  const formatted = abs >= 100 ? abs.toFixed(0) : abs.toFixed(decimals);
  const sign = lakhs < 0 ? "-" : "";
  return `${sign}₹${formatted} L`;
}

export function fmtCr(value: number, decimals = 2): string {
  const cr = value / 10000000;
  const abs = Math.abs(cr);
  const formatted = abs >= 10 ? abs.toFixed(1) : abs.toFixed(decimals);
  const sign = cr < 0 ? "-" : "";
  return `${sign}₹${formatted} Cr`;
}

export function fmtPct(value: number): string {
  return `${value.toFixed(1)}%`;
}

export function colorForValue(value: number): string {
  if (value > 0) return "text-green-600 dark:text-green-400";
  if (value < 0) return "text-red-600 dark:text-red-400";
  return "text-muted-foreground";
}
