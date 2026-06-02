/**
 * MIS + RPT Excel export verification.
 *
 * For each downloadable sheet we:
 *   1. Build raw fixture data in the same shape the dashboards consume
 *      (DashboardRow[] for MIS, raw RPT API groups for RPT).
 *   2. Pipe the raw data through the SAME aggregation helpers the
 *      dashboards use to render their tables/KPIs:
 *        - client/src/lib/mis-aggregations.ts (aggregateCfTable,
 *          aggregatePl, aggregateWipDetail, aggregateWorkingCapital,
 *          aggregateCashflowByProject)
 *        - inline group/grand totals for RPT (computed identically
 *          to what the on-screen RPT tables render).
 *   3. Run the build* helper, then evaluate the SUM/IF/+-/ABS formulas
 *      it emitted against the workbook's persisted values.
 *   4. Assert that every parent total in the workbook equals the
 *      on-screen total derived from the SAME aggregation path. This
 *      catches drift between Excel formulas and the dashboard /
 *      RPT renderer.
 *
 * Run with:  npx tsx script/test-excel-exports.ts
 */

import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const XLSX = require("xlsx") as typeof import("xlsx");

import {
  downloadExcel,
  buildCashflowStatementSheet,
  buildPLSheet,
  buildWIPSheet,
  buildWorkingCapitalSheet,
  buildCashflowByProjectSheet,
} from "../client/src/lib/excel-export";
import {
  aggregateCfTable,
  aggregatePl,
  aggregateWipDetail,
  aggregateWorkingCapital,
  aggregateCashflowByProject,
  PL_ORDER,
  PL_SIGNS,
  PL_LABELS,
} from "../client/src/lib/mis-aggregations";
import type { DashboardRow } from "../client/src/components/mis-dashboards/types";
import {
  buildRptStatusWorksheet,
  buildRptInterGroupWorksheet,
} from "../client/src/lib/rpt-export";

import {
  buildIcReconExportSheet,
  buildIcReconTemplateSheet,
  buildEntityCpSummarySheet,
  buildIcDataSheet,
  buildIcBalanceMatrixSheet,
  buildIcNetoffMatrixSheets,
  buildIcNetoffDetailsSheet,
  buildEntityRptReportSheet,
} from "../shared/excel-builders";

// ------------------------------------------------------------------
// Formula evaluator — supports SUM(range/refs), ABS, IF (with =, >, <,
// >=, <=, <>), arithmetic +-*/, and string literals.
// ------------------------------------------------------------------

type Sheet = import("xlsx").WorkSheet;
type EvalResult = number | string;

function cellVal(ws: Sheet, ref: string, stack: Set<string> = new Set()): EvalResult {
  const c = ws[ref];
  if (!c) return 0;
  if (c.f && !stack.has(ref)) {
    stack.add(ref);
    const v = evalExpr(c.f as string, ws, stack);
    stack.delete(ref);
    return v;
  }
  if (typeof c.v === "number") return c.v;
  if (typeof c.v === "string") return c.v;
  return 0;
}

function asNum(v: EvalResult): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !isNaN(Number(v))) return Number(v);
  return 0;
}

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let inStr = false;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === sep && depth === 0) {
        parts.push(s.slice(last, i));
        last = i + 1;
      }
    }
  }
  parts.push(s.slice(last));
  return parts;
}

function findFn(s: string): { name: string; start: number; end: number; inner: string } | null {
  const m = s.match(/(SUM|ABS|IF)\(/);
  if (!m || m.index === undefined) return null;
  const start = m.index;
  let depth = 0;
  let inStr = false;
  let end = -1;
  for (let i = start + m[0].length - 1; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === "(") depth++;
      else if (ch === ")") {
        depth--;
        if (depth === 0) { end = i; break; }
      }
    }
  }
  if (end < 0) throw new Error("Unbalanced paren in formula: " + s);
  return { name: m[1], start, end, inner: s.slice(start + m[1].length + 1, end) };
}

function evalCondition(cond: string, ws: Sheet, stack: Set<string>): boolean {
  // Match comparison operators in priority order
  const ops = ["<>", "!=", ">=", "<=", "=", ">", "<"];
  for (const op of ops) {
    const idx = findTopOp(cond, op);
    if (idx >= 0) {
      const left = evalExpr(cond.slice(0, idx), ws, stack);
      const right = evalExpr(cond.slice(idx + op.length), ws, stack);
      const ln = asNum(left), rn = asNum(right);
      switch (op) {
        case "=": return ln === rn || left === right;
        case "<>":
        case "!=": return ln !== rn && left !== right;
        case ">": return ln > rn;
        case "<": return ln < rn;
        case ">=": return ln >= rn;
        case "<=": return ln <= rn;
      }
    }
  }
  return asNum(evalExpr(cond, ws, stack)) !== 0;
}

function findTopOp(s: string, op: string): number {
  let depth = 0, inStr = false;
  for (let i = 0; i <= s.length - op.length; i++) {
    const ch = s[i];
    if (ch === '"') inStr = !inStr;
    else if (!inStr) {
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (depth === 0 && s.slice(i, i + op.length) === op) {
        if (op === "=" && (s[i - 1] === "<" || s[i - 1] === ">" || s[i - 1] === "!")) continue;
        if ((op === ">" || op === "<") && (s[i + 1] === "=" || s[i + 1] === ">")) continue;
        return i;
      }
    }
  }
  return -1;
}

function evalExpr(expr: string, ws: Sheet, stack: Set<string> = new Set()): EvalResult {
  let s = expr.trim();
  // Replace function calls iteratively
  while (true) {
    const fn = findFn(s);
    if (!fn) break;
    let val: EvalResult = 0;
    if (fn.name === "SUM") {
      const parts = splitTop(fn.inner, ",");
      let total = 0;
      for (const part of parts) {
        const p = part.trim();
        const rm = p.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        if (rm) {
          const c1 = XLSX.utils.decode_col(rm[1]);
          const c2 = XLSX.utils.decode_col(rm[3]);
          const r1 = +rm[2];
          const r2 = +rm[4];
          for (let r = r1; r <= r2; r++) {
            for (let c = c1; c <= c2; c++) {
              total += asNum(cellVal(ws, XLSX.utils.encode_col(c) + r, stack));
            }
          }
        } else {
          total += asNum(evalExpr(p, ws, stack));
        }
      }
      val = total;
    } else if (fn.name === "ABS") {
      val = Math.abs(asNum(evalExpr(fn.inner, ws, stack)));
    } else if (fn.name === "IF") {
      const parts = splitTop(fn.inner, ",");
      const cond = parts[0];
      val = evalCondition(cond, ws, stack)
        ? evalExpr(parts[1], ws, stack)
        : evalExpr(parts[2], ws, stack);
    }
    const replacement = typeof val === "string" ? JSON.stringify(val) : "(" + val + ")";
    s = s.slice(0, fn.start) + replacement + s.slice(fn.end + 1);
  }
  // Handle pure string literal
  s = s.trim();
  if (/^"[^"]*"$/.test(s)) return s.slice(1, -1);
  // Replace cell refs
  s = s.replace(/[A-Z]+\d+/g, (ref) => {
    const v = cellVal(ws, ref, stack);
    return typeof v === "string" ? JSON.stringify(v) : "(" + v + ")";
  });
  // If still contains a string literal, return it raw
  if (/^"[^"]*"$/.test(s.trim())) return s.trim().slice(1, -1);
  // Numeric arithmetic only
  try {
    return Function('"use strict"; return (' + s + ");")();
  } catch {
    return s;
  }
}

// ------------------------------------------------------------------
// Test framework
// ------------------------------------------------------------------

let failures = 0;
let assertions = 0;
const APPROX = 1e-6;

function assert(cond: boolean, msg: string) {
  assertions++;
  if (!cond) {
    failures++;
    console.error("  ✗ " + msg);
  } else {
    console.log("  ✓ " + msg);
  }
}

function assertClose(actual: number, expected: number, msg: string) {
  assert(Math.abs(actual - expected) < APPROX, `${msg} (got ${actual}, expected ${expected})`);
}

function findRow(ws: Sheet, label: string): number | null {
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  const target = label.trim();
  for (let r = range.s.r; r <= range.e.r; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (c && typeof c.v === "string" && c.v.trim() === target) return r + 1;
  }
  return null;
}

function evalCellNum(ws: Sheet, addr: string): number {
  const c = ws[addr];
  if (!c) return 0;
  if (c.f) return asNum(evalExpr(c.f as string, ws));
  return asNum(c.v);
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mis-excel-"));
process.chdir(TMP);
console.log("Working dir:", TMP);

// ------------------------------------------------------------------
// Helpers to construct raw DashboardRow fixtures concisely
// ------------------------------------------------------------------
function mkRow(o: Partial<DashboardRow>): DashboardRow {
  return {
    tbFileId: 1, company: "ACME", projectName: null, entityStatus: null, accountHead: null,
    cashflow: null, cfHead: null, activityType: null, cfStatementLine: null,
    plCategory: null, plSign: null, wipComponent: null, wcBucket: null, wcSign: null,
    debtBucket: null, kpiTag: null,
    openingDebit: null, openingCredit: null, periodDebit: null, periodCredit: null,
    closingDebit: null, closingCredit: null, netOpeningBalance: null, netClosingBalance: null,
    periodTag: null, enterprise: null,
    openingNet: 0, periodNet: 0, closingNet: 0,
    ...o,
  };
}

// ==================================================================
// 1. D1 — Indirect Cashflow Statement (drives from raw rows through
//        aggregateCfTable, then asserts Excel parent SUMs == UI parents)
// ==================================================================
console.log("\n[1/7] D1 — Indirect CF Statement (raw rows -> aggregation -> excel)");
{
  const rows: DashboardRow[] = [
    // Operating: Receipts from customers
    mkRow({ activityType: "Operating", cfStatementLine: "Receipts from customers", accountHead: "Trade receivables", periodDebit: 1000, periodCredit: 0,    periodNet: 1000 }),
    mkRow({ activityType: "Operating", cfStatementLine: "Receipts from customers", accountHead: "Advances",          periodDebit: 200,  periodCredit: 50,   periodNet: 150 }),
    // Operating: Payments to suppliers
    mkRow({ activityType: "Operating", cfStatementLine: "Payments to suppliers",   accountHead: "Materials",         periodDebit: 0,    periodCredit: 600,  periodNet: -600 }),
    mkRow({ activityType: "Operating", cfStatementLine: "Payments to suppliers",   accountHead: "Services",          periodDebit: 0,    periodCredit: 100,  periodNet: -100 }),
    // Investing
    mkRow({ activityType: "Investing", cfStatementLine: "Capex",                   accountHead: "Equipment",         periodDebit: 0,    periodCredit: 300,  periodNet: -300 }),
  ];

  const cfTable = aggregateCfTable(rows);

  // On-screen totals come straight out of the aggregation
  const onScreenSectionNet: Record<string, number> = {};
  let onScreenNetChange = 0;
  for (const sec of cfTable) {
    const secNet = sec.lines.reduce((s, l) => s + l.net, 0);
    onScreenSectionNet[sec.activity] = secNet;
    onScreenNetChange += secNet;
  }

  const sheet = buildCashflowStatementSheet(cfTable);
  downloadExcel([sheet], "d1.xlsx");
  const wb = XLSX.readFile("d1.xlsx");
  const ws = wb.Sheets["Indirect CF Statement"];
  assert(!!ws, "Indirect CF Statement sheet present");

  for (const activity of Object.keys(onScreenSectionNet)) {
    const label = `Subtotal — ${activity}`;
    const r = findRow(ws, label);
    assert(r !== null, `${label} row found`);
    const cell = ws[`D${r}`];
    assert(!!cell?.f, `${label} net column has formula`);
    assertClose(evalCellNum(ws, `D${r}`), onScreenSectionNet[activity], `${label} net == aggregation`);
  }

  // Sub-line parents
  for (const sec of cfTable) {
    for (const line of sec.lines) {
      const r = findRow(ws, line.line);
      if (r === null) continue;
      const cell = ws[`D${r}`];
      if (!cell?.f) continue; // only check formula rows (parents)
      assertClose(evalCellNum(ws, `D${r}`), line.net, `line "${line.line}" net == aggregation`);
    }
  }

  const ncRow = findRow(ws, "Grand Total — Net Change in Cash");
  assert(ncRow !== null, "Grand Total — Net Change in Cash row found");
  assertClose(evalCellNum(ws, `D${ncRow}`), onScreenNetChange, "Grand Total — Net Change == Σ(section nets)");
}

// ==================================================================
// 2. D2 — Profit & Loss
// ==================================================================
console.log("\n[2/7] D2 — Profit & Loss");
{
  const rows: DashboardRow[] = [
    mkRow({ plCategory: "Revenue from Operations",   accountHead: "Sale of units", periodNet:  8000 }),
    mkRow({ plCategory: "Revenue from Operations",   accountHead: "Maintenance",   periodNet:  2000 }),
    mkRow({ plCategory: "Other Income",              accountHead: "Interest",      periodNet:   500 }),
    mkRow({ plCategory: "Cost of Construction",      accountHead: "Materials",     periodNet:  3000 }),
    mkRow({ plCategory: "Cost of Construction",      accountHead: "Labour",        periodNet:  1000 }),
    mkRow({ plCategory: "Employee Expenses",         accountHead: "Salaries",      periodNet:  1500 }),
    mkRow({ plCategory: "Sales & Marketing",         accountHead: "Ads",           periodNet:   300 }),
    mkRow({ plCategory: "Admin & Other Expenses",    accountHead: "Office",        periodNet:   200 }),
    mkRow({ plCategory: "Facility Management",       accountHead: "FM",            periodNet:   100 }),
    mkRow({ plCategory: "Depreciation & Amortization", accountHead: "Dep",         periodNet:   250 }),
    mkRow({ plCategory: "Finance Cost",              accountHead: "Interest exp",  periodNet:   400 }),
    mkRow({ plCategory: "Tax Expense",               accountHead: "Income tax",    periodNet:   800 }),
  ];

  const agg = aggregatePl(rows);

  const sheet = buildPLSheet(agg.plSums, PL_ORDER, PL_SIGNS, PL_LABELS);
  downloadExcel([sheet], "d2-pl.xlsx");
  const wb = XLSX.readFile("d2-pl.xlsx");
  const ws = wb.Sheets["Profit & Loss"];
  assert(!!ws, "Profit & Loss sheet present");

  // Category leaf totals: assert Excel == aggregation periodNet
  for (const cat of Object.keys(agg.plSums)) {
    const r = findRow(ws, cat);
    if (r === null) continue;
    assertClose(evalCellNum(ws, `B${r}`), agg.plSums[cat].periodNet, `${cat} net == aggregation`);
  }
  // Calculated sub-totals: assert Excel == aggregation calculatedRows
  const labelChecks: Array<[string, string]> = [
    [PL_LABELS.__TOTAL_INCOME__, "__TOTAL_INCOME__"],
    [PL_LABELS.__GROSS_PROFIT__, "__GROSS_PROFIT__"],
    [PL_LABELS.__EBITDA__, "__EBITDA__"],
    [PL_LABELS.__EBIT__, "__EBIT__"],
    [PL_LABELS.__EBT__, "__EBT__"],
    [PL_LABELS.__PAT__, "__PAT__"],
  ];
  for (const [label, key] of labelChecks) {
    const r = findRow(ws, label);
    assert(r !== null, `${label} row found`);
    assertClose(evalCellNum(ws, `B${r}`), agg.calculatedRows[key], `${label} == aggregation calculatedRows.${key}`);
  }
}

// ==================================================================
// 3. D2 — WIP Detail
// ==================================================================
console.log("\n[3/7] D2 — WIP Detail");
{
  const rows: DashboardRow[] = [
    mkRow({ projectName: "Alpha", wipComponent: "Land",         openingNet: 100, periodNet: 50, closingNet: 150 }),
    mkRow({ projectName: "Alpha", wipComponent: "Construction", openingNet: 200, periodNet: 80, closingNet: 280 }),
    mkRow({ projectName: "Beta",  wipComponent: "Land",         openingNet: 300, periodNet:  0, closingNet: 300 }),
  ];

  const wipData = aggregateWipDetail(rows);
  const onScreenGrand = wipData.reduce(
    (acc, r) => ({ opening: acc.opening + r.opening, period: acc.period + r.period, closing: acc.closing + r.closing }),
    { opening: 0, period: 0, closing: 0 },
  );
  const onScreenAlpha = wipData.filter(r => r.project === "Alpha");
  const alphaClosing = onScreenAlpha.reduce((s, r) => s + r.closing, 0);

  const sheet = buildWIPSheet(wipData);
  downloadExcel([sheet], "d2-wip.xlsx");
  const wb = XLSX.readFile("d2-wip.xlsx");
  const ws = wb.Sheets["WIP Detail"];
  assert(!!ws, "WIP Detail sheet present");

  const alphaRow = findRow(ws, "Alpha — Total");
  assert(alphaRow !== null, "Alpha — Total row");
  assertClose(evalCellNum(ws, `E${alphaRow}`), alphaClosing, "Alpha closing == aggregation");

  const grand = findRow(ws, "GRAND TOTAL");
  assert(grand !== null, "GRAND TOTAL row");
  assertClose(evalCellNum(ws, `C${grand}`), onScreenGrand.opening, "Grand opening == aggregation");
  assertClose(evalCellNum(ws, `D${grand}`), onScreenGrand.period,  "Grand period == aggregation");
  assertClose(evalCellNum(ws, `E${grand}`), onScreenGrand.closing, "Grand closing == aggregation");
}

// ==================================================================
// 4. D3 — Working Capital
// ==================================================================
console.log("\n[4/7] D3 — Working Capital");
{
  const rows: DashboardRow[] = [
    mkRow({ wcBucket: "Trade Receivables", wcSign:  1, accountHead: "Customer A", openingNet: 1000, closingNet: 1500 }),
    mkRow({ wcBucket: "Trade Receivables", wcSign:  1, accountHead: "Customer B", openingNet:  500, closingNet:  700 }),
    mkRow({ wcBucket: "Inventory",         wcSign:  1, accountHead: "Stock",      openingNet:  800, closingNet:  900 }),
    mkRow({ wcBucket: "Trade Payables",    wcSign: -1, accountHead: "Supplier X", openingNet: -400, closingNet: -600 }),
  ];

  const agg = aggregateWorkingCapital(rows);
  const totalAssetsOpen  = agg.assetBuckets.reduce((s, [, d]) => s + d.openingNet, 0);
  const totalAssetsClose = agg.assetBuckets.reduce((s, [, d]) => s + d.closingNet, 0);
  // Excel "Sub-Total Current Liabilities" sums liability bucket cells, which
  // for buckets with items use ABS values (absValues=true). Mirror that here:
  const totalLiabOpenAbs = agg.liabilityBuckets.reduce((s, [, d]) => {
    if (d.items.length > 0) return s + d.items.reduce((a, i) => a + Math.abs(i.opening), 0);
    return s + Math.abs(d.openingNet);
  }, 0);
  const totalLiabCloseAbs = agg.liabilityBuckets.reduce((s, [, d]) => {
    if (d.items.length > 0) return s + d.items.reduce((a, i) => a + Math.abs(i.closing), 0);
    return s + Math.abs(d.closingNet);
  }, 0);
  const nwcOpenExcel  = totalAssetsOpen  - totalLiabOpenAbs;
  const nwcCloseExcel = totalAssetsClose - totalLiabCloseAbs;

  const sheet = buildWorkingCapitalSheet(agg.assetBuckets, agg.liabilityBuckets);
  downloadExcel([sheet], "d3.xlsx");
  const wb = XLSX.readFile("d3.xlsx");
  const ws = wb.Sheets["Working Capital"];
  assert(!!ws, "Working Capital sheet present");

  const subA = findRow(ws, "Sub-Total Current Assets");
  assert(subA !== null, "Sub-Total Current Assets row");
  assertClose(evalCellNum(ws, `B${subA}`), totalAssetsOpen,  "Asset opening total == Σ buckets");
  assertClose(evalCellNum(ws, `C${subA}`), totalAssetsClose, "Asset closing total == Σ buckets");

  const subL = findRow(ws, "Sub-Total Current Liabilities");
  assert(subL !== null, "Sub-Total Current Liabilities row");
  assertClose(evalCellNum(ws, `B${subL}`), totalLiabOpenAbs,  "Liab opening total == Σ buckets (abs)");
  assertClose(evalCellNum(ws, `C${subL}`), totalLiabCloseAbs, "Liab closing total == Σ buckets (abs)");

  const nwc = findRow(ws, "NET WORKING CAPITAL");
  assert(nwc !== null, "NET WORKING CAPITAL row");
  assertClose(evalCellNum(ws, `B${nwc}`), nwcOpenExcel,  "NWC opening == Excel-side aggregation (abs liab)");
  assertClose(evalCellNum(ws, `C${nwc}`), nwcCloseExcel, "NWC closing == Excel-side aggregation (abs liab)");

  // Per-bucket SUM of items
  for (const [bucketName, data] of agg.assetBuckets) {
    const r = findRow(ws, bucketName);
    if (r === null) continue;
    if (data.items.length === 0) continue;
    assertClose(evalCellNum(ws, `B${r}`), data.openingNet, `${bucketName} opening == aggregation`);
    assertClose(evalCellNum(ws, `C${r}`), data.closingNet, `${bucketName} closing == aggregation`);
  }
}

// ==================================================================
// 5. Cashflow by Project (driven through aggregateCashflowByProject)
// ==================================================================
console.log("\n[5/7] Cashflow by Project");
{
  const raw = [
    { cashflow: "Operating", cfHead: "Receipts", projectName: "Alpha", amount: 1000 },
    { cashflow: "Operating", cfHead: "Receipts", projectName: "Beta",  amount:  500 },
    { cashflow: "Operating", cfHead: "Payments", projectName: "Alpha", amount: -400 },
    { cashflow: "Operating", cfHead: "Payments", projectName: "Beta",  amount: -200 },
    { cashflow: "Investing", cfHead: "Capex",    projectName: "Alpha", amount: -300 },
  ];
  const agg = aggregateCashflowByProject(raw);

  const sheet = buildCashflowByProjectSheet(agg.rows, agg.projectList);
  downloadExcel([sheet], "cf-by-proj.xlsx");
  const wb = XLSX.readFile("cf-by-proj.xlsx");
  const ws = wb.Sheets["Cashflow by Project"];
  assert(!!ws, "Cashflow by Project sheet present");

  for (const parent of agg.rows.filter(r => r.isParent)) {
    const r = findRow(ws, `${parent.cfType} — Total`);
    assert(r !== null, `${parent.cfType} — Total row found`);
    for (let pi = 0; pi < agg.projectList.length; pi++) {
      const proj = agg.projectList[pi];
      const col = String.fromCharCode("B".charCodeAt(0) + pi);
      const expected = parent.projects[proj] || 0;
      assertClose(evalCellNum(ws, `${col}${r}`), expected, `${parent.cfType} ${proj} == aggregation parent`);
    }
    const totalCol = String.fromCharCode("B".charCodeAt(0) + agg.projectList.length);
    assertClose(evalCellNum(ws, `${totalCol}${r}`), parent.total, `${parent.cfType} total == aggregation parent total`);
  }
}

// ==================================================================
// 6. RPT Status export — entity SUMs, group SUMs, and Status IF
// ==================================================================
console.log("\n[6/7] RPT — Entity Status Report");
{
  const dynCols = ["Loans Given", "Loans Taken", "Misc"];
  const groups = [
    {
      group: "Holding Co",
      entities: [
        { entityName: "Entity A", balances: { "Loans Given":  1000, "Loans Taken": -200, "Misc":  50 } },
        { entityName: "Entity B", balances: { "Loans Given":   500, "Loans Taken": -800, "Misc":  10 } },
      ],
    },
    {
      group: "Subsidiaries",
      entities: [
        { entityName: "Entity C", balances: { "Loans Given":  2000, "Loans Taken": -100, "Misc":   0 } },
        { entityName: "Entity D", balances: { "Loans Given":     0, "Loans Taken": -500, "Misc":  20 } },
      ],
    },
  ];

  // On-screen group totals (= what the React table renders)
  const onScreen = groups.map(g => {
    const entityNets = g.entities.map(e => dynCols.reduce((s, c) => s + (e.balances[c] || 0), 0));
    const colTotals: Record<string, number> = {};
    for (const c of dynCols) colTotals[c] = g.entities.reduce((s, e) => s + (e.balances[c] || 0), 0);
    const groupNet = entityNets.reduce((s, n) => s + n, 0);
    return { entityNets, colTotals, groupNet };
  });

  const ws = buildRptStatusWorksheet({ groups, dynCols, period: "FY2025-Q4" });
  // Round-trip to ensure the workbook serialises without error
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Status");
  const tmpPath = "rpt_status.xlsx";
  XLSX.writeFile(wb, tmpPath);
  assert(fs.existsSync(tmpPath), "RPT Status workbook serialised");
  // Evaluate the in-memory worksheet (formulas are preserved on `f`)
  const wsRead = ws;

  // Net column = dynCols.length + 1 (0-indexed) -> letter
  const netColLetter = String.fromCharCode("A".charCodeAt(0) + dynCols.length + 1);

  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const grpRow = findRow(wsRead, grp.group);
    assert(grpRow !== null, `Group "${grp.group}" row found`);

    // Each dynCol of group row = SUM of entity rows for that col
    for (let ci = 0; ci < dynCols.length; ci++) {
      const col = String.fromCharCode("A".charCodeAt(0) + 1 + ci);
      const expected = onScreen[gi].colTotals[dynCols[ci]];
      assertClose(evalCellNum(wsRead, `${col}${grpRow}`), expected, `Group "${grp.group}" col "${dynCols[ci]}" == on-screen total`);
    }
    // Group Net cell = SUM of dynCols on group row, which == Σ entity nets
    assertClose(evalCellNum(wsRead, `${netColLetter}${grpRow}`), onScreen[gi].groupNet, `Group "${grp.group}" Net == Σ entity nets`);

    // Each entity net row = SUM of its dynCols
    for (let ei = 0; ei < grp.entities.length; ei++) {
      const entRow = findRow(wsRead, grp.entities[ei].entityName);
      assert(entRow !== null, `Entity row "${grp.entities[ei].entityName}" found`);
      assertClose(evalCellNum(wsRead, `${netColLetter}${entRow}`), onScreen[gi].entityNets[ei], `Entity "${grp.entities[ei].entityName}" Net == Σ dynCols`);
    }
  }
}

// ==================================================================
// 7. RPT Inter-Group export — entity sub-totals, group sub-totals,
//    and Grand Total all match on-screen aggregation
// ==================================================================
console.log("\n[7/7] RPT — Inter Group");
{
  const dynCols = ["Loans Given", "Loans Taken"];
  const groups = [
    {
      group: "Holding Co",
      rptRows: [
        { rptGroup: "Subsidiaries", balances: { "Loans Given": 1500, "Loans Taken": -200 } },
        { rptGroup: "Associates",   balances: { "Loans Given":  300, "Loans Taken": -100 } },
      ],
    },
    {
      group: "Subsidiaries",
      rptRows: [
        { rptGroup: "Holding Co",   balances: { "Loans Given":  200, "Loans Taken": -1500 } },
        { rptGroup: "Associates",   balances: { "Loans Given":  400, "Loans Taken":  -50 } },
      ],
    },
  ];

  const onScreenGroups = groups.map(g => {
    const colTotals: Record<string, number> = {};
    for (const c of dynCols) colTotals[c] = g.rptRows.reduce((s, r) => s + (r.balances[c] || 0), 0);
    const grandTotal = Object.values(colTotals).reduce((s, v) => s + v, 0);
    const detailGrandTotals = g.rptRows.map(r => dynCols.reduce((s, c) => s + (r.balances[c] || 0), 0));
    return { colTotals, grandTotal, detailGrandTotals };
  });
  const onScreenColumnGrand: Record<string, number> = {};
  for (const c of dynCols) onScreenColumnGrand[c] = onScreenGroups.reduce((s, g) => s + g.colTotals[c], 0);
  const onScreenGrandGrand = Object.values(onScreenColumnGrand).reduce((s, v) => s + v, 0);

  const ws = buildRptInterGroupWorksheet({ groups, dynCols, period: "FY2025-Q4" });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Inter Group");
  const tmpPath = "rpt_inter_group.xlsx";
  XLSX.writeFile(wb, tmpPath);
  assert(fs.existsSync(tmpPath), "RPT Inter Group workbook serialised");
  const wsRead = ws;

  // Grand Total column = firstDynCol (2) + dynCols.length -> letter
  const gtColLetter = String.fromCharCode("A".charCodeAt(0) + 2 + dynCols.length);

  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const grpRow = findRow(wsRead, grp.group);
    assert(grpRow !== null, `Inter-group "${grp.group}" row found`);

    for (let ci = 0; ci < dynCols.length; ci++) {
      const col = String.fromCharCode("A".charCodeAt(0) + 2 + ci);
      assertClose(evalCellNum(wsRead, `${col}${grpRow}`), onScreenGroups[gi].colTotals[dynCols[ci]], `Group "${grp.group}" col "${dynCols[ci]}" == on-screen total`);
    }
    assertClose(evalCellNum(wsRead, `${gtColLetter}${grpRow}`), onScreenGroups[gi].grandTotal, `Group "${grp.group}" Grand Total == on-screen aggregation`);

    // Detail rows' Grand Total cell
    for (let di = 0; di < grp.rptRows.length; di++) {
      const detailRow = grpRow + 1 + di; // grpRow is 1-indexed row right above details
      assertClose(evalCellNum(wsRead, `${gtColLetter}${detailRow}`), onScreenGroups[gi].detailGrandTotals[di], `Detail "${grp.rptRows[di].rptGroup}" in "${grp.group}" Grand Total`);
    }
  }

  const ggRow = findRow(wsRead, "Grand Total");
  assert(ggRow !== null, "Grand Total row found");
  for (let ci = 0; ci < dynCols.length; ci++) {
    const col = String.fromCharCode("A".charCodeAt(0) + 2 + ci);
    assertClose(evalCellNum(wsRead, `${col}${ggRow}`), onScreenColumnGrand[dynCols[ci]], `Grand Total col "${dynCols[ci]}" == Σ groups`);
  }
  assertClose(evalCellNum(wsRead, `${gtColLetter}${ggRow}`), onScreenGrandGrand, "Grand Total grand cell == Σ all");
}

// ------------------------------------------------------------------
// Test 6 — IC Recon Export (`/api/export/excel`)
// ------------------------------------------------------------------
console.log("\n[6] IC Recon — Reconciliation Export");
{
  const lines = [
    { company: "ACo", counterParty: "BCo", documentNo: "INV-1", docDate: "2026-01-01", netAmount: 100, transactionCount: 1, icGl: "IC_AR", narration: "Inv 1", reconStatus: "matched", reconId: "R1", reconRule: "exact" },
    { company: "ACo", counterParty: "BCo", documentNo: "INV-2", docDate: "2026-01-02", netAmount: -75, transactionCount: 2, icGl: "IC_AR", narration: "Inv 2", reconStatus: "unmatched", reconId: null, reconRule: null },
    { company: "BCo", counterParty: "ACo", documentNo: "INV-3", docDate: "2026-01-03", netAmount: 50, transactionCount: 1, icGl: "IC_AP", narration: "Inv 3", reconStatus: "review_match", reconId: "R2", reconRule: "narration" },
  ];
  const built = buildIcReconExportSheet(lines as any);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "icrecon-export.xlsx");

  const wb2 = XLSX.readFile("icrecon-export.xlsx");
  assert(wb2.SheetNames.includes("Reconciliation"), "sheet name present");
  const ws = wb2.Sheets["Reconciliation"];
  const range = XLSX.utils.decode_range(ws["!ref"] as string);
  assert(range.e.r === lines.length, `row count = ${lines.length} data rows + header (got rows 0..${range.e.r})`);
  assert(ws["A1"]?.v === "Company", "first header is Company");
  assert(ws["E1"]?.v === "Net Amount", "Net Amount header");
  assertClose(Number(ws["E2"]?.v), 100, "first row net amount");
  assertClose(Number(ws["E3"]?.v), -75, "second row net amount");
  assertClose(Number(ws["F4"]?.v), 1, "third row txn count default");
}

// ------------------------------------------------------------------
// Test 7 — IC Recon Template (`/api/export/reconciliation-template`)
// ------------------------------------------------------------------
console.log("\n[7] IC Recon — Reconciliation Template");
{
  const lines = [
    { id: 11, company: "ACo", counterParty: "BCo", documentNo: "T-1", docDate: "2026-02-01", netAmount: 200, narration: "T1", reconStatus: "matched", reconId: "R10" },
    { id: 12, company: "ACo", counterParty: "BCo", documentNo: "T-2", docDate: "2026-02-02", netAmount: -150, narration: "T2", reconStatus: "unmatched", reconId: null },
  ];
  const built = buildIcReconTemplateSheet(lines as any);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "icrecon-template.xlsx");

  const wb2 = XLSX.readFile("icrecon-template.xlsx");
  assert(wb2.SheetNames.includes("Reconciliation Template"), "template sheet present");
  const ws = wb2.Sheets["Reconciliation Template"];
  assert(ws["A1"]?.v === "Line ID", "Line ID header");
  assert(ws["J1"]?.v === "User Rec ID", "User Rec ID header");
  assertClose(Number(ws["A2"]?.v), 11, "first row Line ID");
  assertClose(Number(ws["F3"]?.v), -150, "second row Net Amount");
  assert(ws["J2"]?.v === "" || ws["J2"]?.v === undefined, "User Rec ID is blank");
}

// ------------------------------------------------------------------
// Test 8 — Entity / Counter-Party Summary (reports.tsx)
// ------------------------------------------------------------------
console.log("\n[8] IC Recon — Entity Counter-Party Summary");
{
  const rows = [
    { entity: "ACo", counterParty: "BCo", total: 10, matched: 6, reversal: 1, review: 1, suggested: 1, unmatched: 1, rate: 90.0 },
    { entity: "ACo", counterParty: "CCo", total: 4, matched: 2, reversal: 0, review: 0, suggested: 0, unmatched: 2, rate: 50.0 },
  ];
  const totals = rows.reduce((a, r) => ({
    total: a.total + r.total, matched: a.matched + r.matched,
    reversal: a.reversal + (r.reversal || 0), review: a.review + r.review,
    suggested: a.suggested + r.suggested, unmatched: a.unmatched + r.unmatched,
  }), { total: 0, matched: 0, reversal: 0, review: 0, suggested: 0, unmatched: 0 });
  const reconciled = totals.matched + totals.reversal + totals.review + totals.suggested;
  const overallRate = totals.total > 0 ? Math.round((reconciled / totals.total) * 10000) / 100 : 0;

  const built = buildEntityCpSummarySheet(rows, totals, overallRate);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "entity-cp.xlsx");

  const wb2 = XLSX.readFile("entity-cp.xlsx");
  const ws = wb2.Sheets["Entity CP Summary"];
  assert(!!ws, "Entity CP Summary sheet present");
  // Last row is the TOTAL row.
  const totalRowNum = rows.length + 2; // 1 header + N rows + total
  assert(ws[`A${totalRowNum}`]?.v === "TOTAL", "TOTAL row label");
  assertClose(Number(ws[`C${totalRowNum}`]?.v), totals.total, "Total — total");
  assertClose(Number(ws[`D${totalRowNum}`]?.v), totals.matched, "Total — matched");
  assertClose(Number(ws[`H${totalRowNum}`]?.v), totals.unmatched, "Total — unmatched");
  assertClose(Number(ws[`I${totalRowNum}`]?.v), overallRate, "Total — rate");
}

// ------------------------------------------------------------------
// Test 9 — IC Matrix IC Data export
// ------------------------------------------------------------------
console.log("\n[9] IC Matrix — IC Data");
{
  const data = [
    { company: "ACo", companyCode: "A", accountHead: "Trade", subAccountHead: "BCo", closingDebit: 500, closingCredit: 0, netBalance: 500, newCoaGlName: "IC_AR", icCounterParty: "BCo", icCounterPartyCode: "B", icTxnType: "AR", rptTxnType: "Sale", tbSource: "Premium" },
    { company: "ACo", companyCode: "A", accountHead: "Trade", subAccountHead: "CCo", closingDebit: 0, closingCredit: 200, netBalance: -200, newCoaGlName: "IC_AP", icCounterParty: "CCo", icCounterPartyCode: "C", icTxnType: "AP", rptTxnType: "Purchase", tbSource: "Premium" },
  ];
  const built = buildIcDataSheet(data as any);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "ic-data.xlsx");

  const wb2 = XLSX.readFile("ic-data.xlsx");
  const ws = wb2.Sheets["IC Data"];
  assert(!!ws, "IC Data sheet present");
  assert(ws["A1"]?.v === "Company", "Company header");
  assert(ws["G1"]?.v === "Net Balance", "Net Balance header");
  assertClose(Number(ws["G2"]?.v), 500, "row 1 net balance");
  assertClose(Number(ws["G3"]?.v), -200, "row 2 net balance");
  // Sum of net balance column = on-screen grand total
  const sumNet = Number(ws["G2"].v) + Number(ws["G3"].v);
  assertClose(sumNet, 300, "sum of net balances");
}

// ------------------------------------------------------------------
// Test 10 — IC Matrix Balance Matrix
// ------------------------------------------------------------------
console.log("\n[10] IC Matrix — Balance Matrix");
{
  const companyCodes = ["A", "B", "C"];
  const cpCodes = ["A", "B", "C"];
  const codeToName: Record<string, string> = { A: "Alpha Co", B: "Beta Co", C: "Gamma Co" };
  // A->B 100, A->C 50, B->A -90, B->C 20, C->A 0, C->B -10
  const balanceMap = new Map<string, number>([
    ["A|B", 100], ["A|C", 50],
    ["B|A", -90], ["B|C", 20],
    ["C|B", -10],
  ]);
  const built = buildIcBalanceMatrixSheet(companyCodes, cpCodes, codeToName, balanceMap);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "ic-balance-matrix.xlsx");

  const wb2 = XLSX.readFile("ic-balance-matrix.xlsx");
  const ws = wb2.Sheets["IC Balance Matrix"];
  assert(!!ws, "IC Balance Matrix sheet present");
  assert(ws["A1"]?.v === "Company Code", "header A1");
  assert(ws["B1"]?.v === "Company Name", "header B1");
  assert(String(ws["C1"]?.v).startsWith("A - "), "first cp header is A");

  // Headline: grand total = sum of all balances
  const expectedGrand = 100 + 50 + (-90) + 20 + (-10);
  assertClose(built.grandTotal, expectedGrand, "in-memory grand total");

  // Read the persisted Column Total row — it lives at row companyCodes.length+2.
  const colTotalRowNum = companyCodes.length + 2;
  assert(ws[`B${colTotalRowNum}`]?.v === "Column Total", "Column Total label");
  // Total column index = 2 (A,B) + cpCodes.length = 5 → letter F
  const totalCol = String.fromCharCode(65 + 2 + cpCodes.length);
  assertClose(Number(ws[`${totalCol}${colTotalRowNum}`]?.v), expectedGrand, "persisted grand total");

  // Row total for company A = 100 + 50 = 150
  assertClose(Number(ws[`${totalCol}2`]?.v), 150, "company A row total");
  // Column total for cp B = 100 + 0 + (-10) = 90
  assertClose(Number(ws[`D${colTotalRowNum}`]?.v), 90, "cp B column total");
}

// ------------------------------------------------------------------
// Test 11 — IC Matrix Net-off Matrix (matrix + summary sheets)
// ------------------------------------------------------------------
console.log("\n[11] IC Matrix — Net-off Matrix");
{
  const companyCodes = ["A", "B", "C"];
  const cpCodes = ["A", "B", "C"];
  const codeToName: Record<string, string> = { A: "Alpha", B: "Beta", C: "Gamma" };
  // A<->B mismatched: A->B=100, B->A=-90 ⇒ net=10 (positive ⇒ on A|B side)
  // A<->C zero net: A->C=50, C->A=-50 ⇒ net=0 (no summary row)
  // B<->C mismatched: B->C=20, C->B=-30 ⇒ net=-10 (on C|B side after sort)
  const balanceMap = new Map<string, number>([
    ["A|B", 100], ["B|A", -90],
    ["A|C", 50], ["C|A", -50],
    ["B|C", 20], ["C|B", -30],
  ]);
  const built = buildIcNetoffMatrixSheets(companyCodes, cpCodes, codeToName, balanceMap);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.matrix.ws, built.matrix.name);
  XLSX.utils.book_append_sheet(wb, built.summary.ws, built.summary.name);
  XLSX.writeFile(wb, "ic-netoff-matrix.xlsx");

  const wb2 = XLSX.readFile("ic-netoff-matrix.xlsx");
  assert(wb2.SheetNames.includes("IC Net-off Matrix"), "matrix sheet present");
  assert(wb2.SheetNames.includes("Net-off Summary"), "summary sheet present");

  // After net-off: A|B=10, B|A=0, A|C=0, C|A=0, B|C=0, C|B=-10 (since net was -10)
  // ⇒ grand total = 10 + (-10) = 0
  assertClose(built.matrix.grandTotal, 0, "net-off grand total = 0");

  // Summary should have 2 rows (A↔B and B↔C, A↔C is zero).
  assert(built.summaryRows.length === 2, `summary has 2 mismatched pairs (got ${built.summaryRows.length})`);
  const summaryWs = wb2.Sheets["Net-off Summary"];
  assert(summaryWs["A1"]?.v === "Company Code", "summary header A1");
  assert(summaryWs["G1"]?.v === "Difference", "summary header G1");
  // Largest |diff| first ⇒ but |10| === |10|, sort is stable in this case.
  // Just assert both diffs are present.
  const diffs = [Number(summaryWs["G2"]?.v), Number(summaryWs["G3"]?.v)].sort((a,b)=>a-b);
  assertClose(diffs[0], -10, "summary diff #1");
  assertClose(diffs[1], 10, "summary diff #2");
}

// ------------------------------------------------------------------
// Test 12 — IC Matrix Net-off Details
// ------------------------------------------------------------------
console.log("\n[12] IC Matrix — Net-off Details");
{
  const companyCodes = ["A", "B"];
  const cpCodes = ["A", "B"];
  const codeToName: Record<string, string> = { A: "Alpha", B: "Beta" };
  const balanceMap = new Map<string, number>([["A|B", 100], ["B|A", -75]]);
  const built = buildIcNetoffDetailsSheet(companyCodes, cpCodes, codeToName, balanceMap);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "ic-netoff-details.xlsx");

  const wb2 = XLSX.readFile("ic-netoff-details.xlsx");
  const ws = wb2.Sheets["Net-off Details"];
  assert(!!ws, "Net-off Details sheet present");
  assert(ws["A1"]?.v === "Company Code", "Company Code header");
  assert(ws["G1"]?.v === "Difference", "Difference header");
  assertClose(Number(ws["E2"]?.v), 100, "company balance");
  assertClose(Number(ws["F2"]?.v), -75, "counter-party balance");
  assertClose(Number(ws["G2"]?.v), 25, "difference = 100 + (-75)");
}

// ------------------------------------------------------------------
// Test 13 — RPT Entity Working Report (rpt-reports.tsx)
// ------------------------------------------------------------------
console.log("\n[13] RPT — Entity Working Report");
{
  const movCols = [
    { key: "m1", label: "Apr-26" },
    { key: "m2", label: "May-26" },
  ];
  const reportRows = [
    { entityName: "ACo", accountHead: "Receivables", subAccountHead: "BCo", rptLedgerName: "BCo Ledger", counterPartyShort: "BCo", currentNonCurrent: "Current", fsGroup: "Trade Receivables", fsHeading: "Current Assets", netOpb: 1000, movements: { m1: 200, m2: -50 }, clbNet: 1150, clbTb: 1150, diff: 0 },
    { entityName: "ACo", accountHead: "Receivables", subAccountHead: "CCo", rptLedgerName: "CCo Ledger", counterPartyShort: "CCo", currentNonCurrent: "Non-Current", fsGroup: "Loans", fsHeading: "Non-Current Assets", netOpb: 500, movements: { m1: 100, m2: 0 }, clbNet: 600, clbTb: 595, diff: 5 },
  ];
  const totals = {
    netOpb: reportRows.reduce((a, r) => a + r.netOpb, 0),
    movements: {
      m1: reportRows.reduce((a, r) => a + r.movements.m1, 0),
      m2: reportRows.reduce((a, r) => a + r.movements.m2, 0),
    },
    clbNet: reportRows.reduce((a, r) => a + r.clbNet, 0),
    clbTb: reportRows.reduce((a, r) => a + r.clbTb, 0),
    diff: reportRows.reduce((a, r) => a + r.diff, 0),
  };

  const built = buildEntityRptReportSheet("Entity RPT Report: ACo (A)", "From 01-Apr-26 To 31-May-26", movCols, reportRows, totals);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, built.ws, built.name);
  XLSX.writeFile(wb, "rpt-entity.xlsx");

  const wb2 = XLSX.readFile("rpt-entity.xlsx");
  const ws = wb2.Sheets["Entity RPT Report"];
  assert(!!ws, "Entity RPT Report sheet present");
  assert(String(ws["A1"]?.v).startsWith("Entity RPT Report"), "title row");
  assert(String(ws["A2"]?.v).startsWith("Period:"), "period row");
  // Header row at idx 3 (1-based row 4)
  assert(ws["A4"]?.v === "Entity Name", "header Entity Name");
  assert(ws["I4"]?.v === "Net OPB", "header Net OPB");

  // Total row is at builds.totalRowIdx (0-based) → 1-based row = +1
  const totalRowExcel = built.totalRowIdx + 1;
  assert(ws[`H${totalRowExcel}`]?.v === "Total", "Total label");
  assertClose(Number(ws[`I${totalRowExcel}`]?.v), totals.netOpb, "Total Net OPB");
  // Net OPB is column I (idx 8); m1=J(9); m2=K(10); CLB Net=L(11); CLB-TB=M; Diff=N
  assertClose(Number(ws[`J${totalRowExcel}`]?.v), totals.movements.m1, "Total m1");
  assertClose(Number(ws[`K${totalRowExcel}`]?.v), totals.movements.m2, "Total m2");
  assertClose(Number(ws[`L${totalRowExcel}`]?.v), totals.clbNet, "Total CLB Net");
  assertClose(Number(ws[`M${totalRowExcel}`]?.v), totals.clbTb, "Total CLB-TB");
  assertClose(Number(ws[`N${totalRowExcel}`]?.v), totals.diff, "Total Diff");
}

// ------------------------------------------------------------------
console.log(`\n${assertions - failures}/${assertions} assertions passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
} else {
  console.log("All MIS + RPT exports match the on-screen totals derived from shared aggregation.");
}
