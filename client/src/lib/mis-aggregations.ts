import type { DashboardRow } from "@/components/mis-dashboards/types";

export interface CfAccountHead { head: string; debit: number; credit: number; net: number; }
export interface CfLine { line: string; debit: number; credit: number; net: number; accountHeads: CfAccountHead[]; }
export interface CfSection { activity: string; lines: CfLine[]; }

export const CF_SECTION_ORDER = ["Operating", "Investing", "Financing", "Cash & Cash Equivalents"];

export function aggregateCfTable(rows: DashboardRow[]): CfSection[] {
  const cfRows = rows.filter(r => r.activityType);
  const structure: CfSection[] = [];
  for (const activity of CF_SECTION_ORDER) {
    const activityRows = cfRows.filter(r => r.activityType === activity);
    if (activityRows.length === 0) continue;
    const lineMap = new Map<string, { debit: number; credit: number; net: number; ahMap: Map<string, { debit: number; credit: number; net: number }> }>();
    for (const r of activityRows) {
      const lineName = r.cfStatementLine || "Other";
      if (!lineMap.has(lineName)) lineMap.set(lineName, { debit: 0, credit: 0, net: 0, ahMap: new Map() });
      const entry = lineMap.get(lineName)!;
      entry.debit += r.periodDebit || 0;
      entry.credit += r.periodCredit || 0;
      entry.net += r.periodNet;
      const ah = r.accountHead || "Unknown";
      if (!entry.ahMap.has(ah)) entry.ahMap.set(ah, { debit: 0, credit: 0, net: 0 });
      const ahEntry = entry.ahMap.get(ah)!;
      ahEntry.debit += r.periodDebit || 0;
      ahEntry.credit += r.periodCredit || 0;
      ahEntry.net += r.periodNet;
    }
    const lines = [...lineMap.entries()].map(([line, data]) => ({
      line, debit: data.debit, credit: data.credit, net: data.net,
      accountHeads: [...data.ahMap.entries()].map(([head, d]) => ({ head, ...d })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
    })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
    structure.push({ activity, lines });
  }
  return structure;
}

export const PL_ORDER = [
  "Revenue from Operations", "Other Income", "__TOTAL_INCOME__",
  "Cost of Construction", "__GROSS_PROFIT__",
  "Employee Expenses", "Sales & Marketing", "Admin & Other Expenses", "Facility Management", "__EBITDA__",
  "Depreciation & Amortization", "__EBIT__",
  "Finance Cost", "__EBT__",
  "Tax Expense", "__PAT__",
];

export const PL_SIGNS: Record<string, number> = {
  "Revenue from Operations": 1, "Other Income": 1,
  "Cost of Construction": -1, "Employee Expenses": -1, "Sales & Marketing": -1,
  "Admin & Other Expenses": -1, "Facility Management": -1,
  "Depreciation & Amortization": -1, "Finance Cost": -1, "Tax Expense": -1,
};

export const PL_LABELS: Record<string, string> = {
  "__TOTAL_INCOME__": "TOTAL INCOME",
  "__GROSS_PROFIT__": "GROSS PROFIT",
  "__EBITDA__": "EBITDA",
  "__EBIT__": "EBIT",
  "__EBT__": "EBT (Earnings Before Tax)",
  "__PAT__": "PAT (Profit After Tax)",
};

export interface PlAggregation {
  plSums: Record<string, { periodNet: number; items: { head: string; net: number }[] }>;
  calculatedRows: Record<string, number>;
}

export function aggregatePl(rows: DashboardRow[]): PlAggregation {
  const plRows = rows.filter(r => r.plCategory);
  const plSums: PlAggregation["plSums"] = {};
  const ahMap: Record<string, Record<string, number>> = {};
  for (const r of plRows) {
    const cat = r.plCategory!;
    const sign = r.plSign || PL_SIGNS[cat] || 0;
    const val = sign > 0 ? Math.abs(r.periodNet) : -Math.abs(r.periodNet);
    if (!plSums[cat]) plSums[cat] = { periodNet: 0, items: [] };
    plSums[cat].periodNet += val;
    if (!ahMap[cat]) ahMap[cat] = {};
    const ah = r.accountHead || "Other";
    ahMap[cat][ah] = (ahMap[cat][ah] || 0) + val;
  }
  for (const cat of Object.keys(ahMap)) {
    plSums[cat].items = Object.entries(ahMap[cat]).map(([head, net]) => ({ head, net })).sort((a, b) => Math.abs(b.net) - Math.abs(a.net));
  }
  const v = (k: string) => plSums[k]?.periodNet || 0;
  const totalIncome = v("Revenue from Operations") + v("Other Income");
  const grossProfit = totalIncome + v("Cost of Construction");
  const ebitda = grossProfit + v("Employee Expenses") + v("Sales & Marketing") + v("Admin & Other Expenses") + v("Facility Management");
  const ebit = ebitda + v("Depreciation & Amortization");
  const ebt = ebit + v("Finance Cost");
  const pat = ebt + v("Tax Expense");
  return {
    plSums,
    calculatedRows: {
      "__TOTAL_INCOME__": totalIncome,
      "__GROSS_PROFIT__": grossProfit,
      "__EBITDA__": ebitda,
      "__EBIT__": ebit,
      "__EBT__": ebt,
      "__PAT__": pat,
    },
  };
}

export interface WipDetailRow { project: string; component: string; opening: number; period: number; closing: number; }
export function aggregateWipDetail(rows: DashboardRow[]): WipDetailRow[] {
  const wipRows = rows.filter(r => r.wipComponent);
  return wipRows.reduce<WipDetailRow[]>((acc, r) => {
    const key = `${r.projectName || "Unassigned"}|${r.wipComponent}`;
    const existing = acc.find(a => `${a.project}|${a.component}` === key);
    if (existing) {
      existing.opening += r.openingNet;
      existing.period += r.periodNet;
      existing.closing += r.closingNet;
    } else {
      acc.push({ project: r.projectName || "Unassigned", component: r.wipComponent!, opening: r.openingNet, period: r.periodNet, closing: r.closingNet });
    }
    return acc;
  }, []).sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
}

export interface WcBucketItem { head: string; opening: number; closing: number; }
export interface WcBucketData { wcSign: number; openingNet: number; closingNet: number; wcMovement: number; items: WcBucketItem[]; }
export type WcBucketEntry = [string, WcBucketData];

export interface WcAggregation {
  bucketData: Record<string, WcBucketData>;
  assetBuckets: WcBucketEntry[];
  liabilityBuckets: WcBucketEntry[];
  currentAssets: number;
  currentLiabilities: number;
  nwc: number;
  wcChange: number;
}

export function aggregateWorkingCapital(rows: DashboardRow[]): WcAggregation {
  const wcRows = rows.filter(r => r.wcBucket);
  const bucketData: Record<string, WcBucketData> = {};
  const ahMap: Record<string, Record<string, { closing: number; opening: number }>> = {};
  for (const r of wcRows) {
    const bucket = r.wcBucket!;
    const sign = r.wcSign || 0;
    if (!bucketData[bucket]) bucketData[bucket] = { wcSign: sign, closingNet: 0, openingNet: 0, wcMovement: 0, items: [] };
    bucketData[bucket].closingNet += r.closingNet;
    bucketData[bucket].openingNet += r.openingNet;
    bucketData[bucket].wcMovement += (r.closingNet - r.openingNet) * sign;
    if (!ahMap[bucket]) ahMap[bucket] = {};
    const ah = r.accountHead || "Other";
    if (!ahMap[bucket][ah]) ahMap[bucket][ah] = { closing: 0, opening: 0 };
    ahMap[bucket][ah].closing += r.closingNet;
    ahMap[bucket][ah].opening += r.openingNet;
  }
  for (const bucket of Object.keys(ahMap)) {
    bucketData[bucket].items = Object.entries(ahMap[bucket]).map(([head, d]) => ({ head, ...d })).sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
  }
  const currentAssets = Object.entries(bucketData).filter(([, d]) => d.wcSign > 0).reduce((s, [, d]) => s + Math.abs(d.closingNet), 0);
  const currentLiabilities = Object.entries(bucketData).filter(([, d]) => d.wcSign < 0).reduce((s, [, d]) => s + Math.abs(d.closingNet), 0);
  const nwc = currentAssets - currentLiabilities;
  const wcChange = Object.values(bucketData).reduce((s, d) => s + d.wcMovement, 0);
  const assetBuckets = Object.entries(bucketData).filter(([, d]) => d.wcSign > 0).sort((a, b) => Math.abs(b[1].closingNet) - Math.abs(a[1].closingNet));
  const liabilityBuckets = Object.entries(bucketData).filter(([, d]) => d.wcSign < 0).sort((a, b) => Math.abs(b[1].closingNet) - Math.abs(a[1].closingNet));
  return { bucketData, assetBuckets, liabilityBuckets, currentAssets, currentLiabilities, nwc, wcChange };
}

export interface CfpInputRow { cashflow: string | null; cfHead: string | null; projectName: string | null; amount: number | null; }
export interface CfpPivotRow { cfType: string; cfHead: string; isParent: boolean; projects: Record<string, number>; total: number; }
export interface CfpAggregation { rows: CfpPivotRow[]; projectList: string[]; }

export function aggregateCashflowByProject(rows: CfpInputRow[]): CfpAggregation {
  const projects = new Set<string>();
  const structure = new Map<string, Map<string, Map<string, number>>>();
  for (const r of rows) {
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
  const built: CfpPivotRow[] = [];
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
      built.push({ cfType, cfHead: head, isParent: false, projects: rowProjects, total: rowTotal });
    }
    built.push({ cfType, cfHead: "", isParent: true, projects: parentProjects, total: parentTotal });
  }
  const sortedRows: CfpPivotRow[] = [];
  const cfTypes = Array.from(structure.keys()).sort();
  for (const cfType of cfTypes) {
    const parent = built.find(r => r.isParent && r.cfType === cfType)!;
    const children = built.filter(r => !r.isParent && r.cfType === cfType).sort((a, b) => a.cfHead.localeCompare(b.cfHead));
    sortedRows.push(parent);
    sortedRows.push(...children);
  }
  return { projectList, rows: sortedRows };
}
