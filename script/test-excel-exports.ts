/**
 * Smoke test for MIS Excel exports.
 *
 * For each of the 5 sheets the dashboards can download we:
 *   1. Build fixture data
 *   2. Compute the expected totals the dashboard would show
 *   3. Run the corresponding builder + downloadExcel writer
 *   4. Re-read the produced .xlsx file (proves the file is well-formed
 *      and "opens" — XLSX.readFile parses identically to Excel)
 *   5. Verify the expected formula cells still contain formulas
 *   6. Evaluate the formulas against the persisted cell values and
 *      assert the result matches the expected dashboard total.
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

// ------------------------------------------------------------------
// Tiny formula evaluator — handles every pattern excel-export.ts emits:
//   SUM(A1:A5)   SUM(A1,A3,A5)   A1+A2+A3   C5-B5
//   IF(B5=0,0,(D5/ABS(B5))*100)
// ------------------------------------------------------------------

type Sheet = XLSX.WorkSheet;

function cellVal(ws: Sheet, ref: string, stack: Set<string> = new Set()): number {
  const c = ws[ref];
  if (!c) return 0;
  if (c.f && !stack.has(ref)) {
    stack.add(ref);
    const v = evalExpr(c.f as string, ws, stack);
    stack.delete(ref);
    return v;
  }
  if (typeof c.v === "number") return c.v;
  if (typeof c.v === "string" && c.v.trim() !== "" && !isNaN(Number(c.v))) {
    return Number(c.v);
  }
  return 0;
}

function splitTop(s: string, sep: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let last = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") depth--;
    else if (s[i] === sep && depth === 0) {
      parts.push(s.slice(last, i));
      last = i + 1;
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
  let end = -1;
  for (let i = start + m[0].length - 1; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) throw new Error("Unbalanced paren in formula: " + s);
  return { name: m[1], start, end, inner: s.slice(start + m[1].length + 1, end) };
}

function evalExpr(expr: string, ws: Sheet, stack: Set<string> = new Set()): number {
  let s = expr.trim();
  while (true) {
    const fn = findFn(s);
    if (!fn) break;
    let val = 0;
    if (fn.name === "SUM") {
      const parts = splitTop(fn.inner, ",");
      let total = 0;
      for (const part of parts) {
        const p = part.trim();
        const rm = p.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/);
        if (rm) {
          const col = rm[1];
          const r1 = +rm[2];
          const r2 = +rm[4];
          for (let r = r1; r <= r2; r++) total += cellVal(ws, col + r, stack);
        } else {
          total += evalExpr(p, ws, stack);
        }
      }
      val = total;
    } else if (fn.name === "ABS") {
      val = Math.abs(evalExpr(fn.inner, ws, stack));
    } else if (fn.name === "IF") {
      const parts = splitTop(fn.inner, ",");
      const cond = parts[0];
      const cm = cond.split("=");
      const left = evalExpr(cm[0], ws, stack);
      const right = evalExpr(cm[1], ws, stack);
      val = left === right ? evalExpr(parts[1], ws, stack) : evalExpr(parts[2], ws, stack);
    }
    s = s.slice(0, fn.start) + "(" + val + ")" + s.slice(fn.end + 1);
  }
  s = s.replace(/[A-Z]+\d+/g, (ref) => "(" + cellVal(ws, ref, stack) + ")");
  return Function('"use strict"; return (' + s + ");")();
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
  for (let r = range.s.r; r <= range.e.r; r++) {
    const c = ws[XLSX.utils.encode_cell({ r, c: 0 })];
    if (c && typeof c.v === "string" && c.v.trim() === label) return r + 1;
  }
  return null;
}

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mis-excel-"));
process.chdir(TMP);
console.log("Working dir:", TMP);

// ------------------------------------------------------------------
// Test 1 — D1 Cashflow Statement (Indirect)
// ------------------------------------------------------------------
console.log("\n[1/5] D1 — Indirect CF Statement");
{
  const cfTable = [
    {
      activity: "Operating",
      lines: [
        {
          line: "Receipts from customers",
          debit: 0, credit: 0, net: 0,
          accountHeads: [
            { head: "Trade receivables", debit: 1000, credit: 0, net: 1000 },
            { head: "Advances", debit: 200, credit: 50, net: 150 },
          ],
        },
        {
          line: "Payments to suppliers",
          debit: 0, credit: 0, net: 0,
          accountHeads: [
            { head: "Materials", debit: 0, credit: 600, net: -600 },
            { head: "Services", debit: 0, credit: 100, net: -100 },
          ],
        },
      ],
    },
    {
      activity: "Investing",
      lines: [
        {
          line: "Capex",
          debit: 0, credit: 0, net: 0,
          accountHeads: [{ head: "Equipment", debit: 0, credit: 300, net: -300 }],
        },
      ],
    },
  ];

  const expectedNetChange =
    1000 + 150 + (-600) + (-100) + (-300); // 150
  const expectedOperatingNet = 1000 + 150 - 600 - 100; // 450

  const sheet = buildCashflowStatementSheet(cfTable);
  downloadExcel([sheet], "d1.xlsx");

  const wb = XLSX.readFile("d1.xlsx");
  assert(wb.SheetNames.includes("Indirect CF Statement"), "sheet name present");
  const ws = wb.Sheets["Indirect CF Statement"];

  const totalOpRow = findRow(ws, "TOTAL OPERATING");
  assert(totalOpRow !== null, "TOTAL OPERATING row found");
  const totalOpCell = ws[`D${totalOpRow}`];
  assert(!!totalOpCell?.f, "TOTAL OPERATING net column has formula");
  assertClose(evalExpr(totalOpCell.f as string, ws), expectedOperatingNet, "TOTAL OPERATING net evaluates");

  const netChangeRow = findRow(ws, "NET CHANGE IN CASH");
  assert(netChangeRow !== null, "NET CHANGE IN CASH row found");
  const ncCell = ws[`D${netChangeRow}`];
  assert(!!ncCell?.f, "NET CHANGE has formula");
  assertClose(evalExpr(ncCell.f as string, ws), expectedNetChange, "NET CHANGE matches dashboard total");
}

// ------------------------------------------------------------------
// Test 2 — D2 P&L
// ------------------------------------------------------------------
console.log("\n[2/5] D2 — Profit & Loss");
{
  const PL_ORDER = [
    "Revenue from Operations", "Other Income", "__TOTAL_INCOME__",
    "Cost of Construction", "__GROSS_PROFIT__",
    "Employee Expenses", "Sales & Marketing", "Admin & Other Expenses", "Facility Management", "__EBITDA__",
    "Depreciation & Amortization", "__EBIT__",
    "Finance Cost", "__EBT__",
    "Tax Expense", "__PAT__",
  ];
  const PL_SIGNS: Record<string, number> = {
    "Revenue from Operations": 1, "Other Income": 1,
    "Cost of Construction": -1, "Employee Expenses": -1, "Sales & Marketing": -1,
    "Admin & Other Expenses": -1, "Facility Management": -1,
    "Depreciation & Amortization": -1, "Finance Cost": -1, "Tax Expense": -1,
  };
  const plSums: Record<string, { periodNet: number; items: { head: string; net: number }[] }> = {
    "Revenue from Operations": { periodNet: 10000, items: [
      { head: "Sale of units", net: 8000 }, { head: "Maintenance", net: 2000 },
    ]},
    "Other Income": { periodNet: 500, items: [{ head: "Interest", net: 500 }] },
    "Cost of Construction": { periodNet: -4000, items: [
      { head: "Materials", net: -3000 }, { head: "Labour", net: -1000 },
    ]},
    "Employee Expenses": { periodNet: -1500, items: [{ head: "Salaries", net: -1500 }] },
    "Sales & Marketing": { periodNet: -300, items: [{ head: "Ads", net: -300 }] },
    "Admin & Other Expenses": { periodNet: -200, items: [{ head: "Office", net: -200 }] },
    "Facility Management": { periodNet: -100, items: [{ head: "FM", net: -100 }] },
    "Depreciation & Amortization": { periodNet: -250, items: [{ head: "Dep", net: -250 }] },
    "Finance Cost": { periodNet: -400, items: [{ head: "Interest exp", net: -400 }] },
    "Tax Expense": { periodNet: -800, items: [{ head: "Income tax", net: -800 }] },
  };
  const totalIncome = 10000 + 500;
  const grossProfit = totalIncome + (-4000);
  const ebitda = grossProfit + (-1500) + (-300) + (-200) + (-100);
  const ebit = ebitda + (-250);
  const ebt = ebit + (-400);
  const pat = ebt + (-800);
  const labels = {
    __TOTAL_INCOME__: "Total Income",
    __GROSS_PROFIT__: "Gross Profit",
    __EBITDA__: "EBITDA",
    __EBIT__: "EBIT",
    __EBT__: "EBT",
    __PAT__: "PAT",
  };
  const sheet = buildPLSheet(plSums, PL_ORDER, PL_SIGNS, labels);
  downloadExcel([sheet], "d2-pl.xlsx");

  const wb = XLSX.readFile("d2-pl.xlsx");
  assert(wb.SheetNames.includes("Profit & Loss"), "sheet name present");
  const ws = wb.Sheets["Profit & Loss"];

  const checks: Array<[string, number]> = [
    ["Revenue from Operations", 10000],
    ["Cost of Construction", -4000],
    ["Total Income", totalIncome],
    ["Gross Profit", grossProfit],
    ["EBITDA", ebitda],
    ["EBIT", ebit],
    ["EBT", ebt],
    ["PAT", pat],
  ];
  for (const [label, expected] of checks) {
    const r = findRow(ws, label);
    assert(r !== null, `${label} row found`);
    const cell = ws[`B${r}`];
    const value = cell?.f ? evalExpr(cell.f as string, ws) : (typeof cell?.v === "number" ? cell.v : NaN);
    assertClose(value, expected, `${label} value`);
  }
}

// ------------------------------------------------------------------
// Test 3 — D2 WIP Detail
// ------------------------------------------------------------------
console.log("\n[3/5] D2 — WIP Detail");
{
  const wipRows = [
    { project: "Alpha", component: "Land", opening: 100, period: 50, closing: 150 },
    { project: "Alpha", component: "Construction", opening: 200, period: 80, closing: 280 },
    { project: "Beta", component: "Land", opening: 300, period: 0, closing: 300 },
  ];
  const grandOpening = 100 + 200 + 300;
  const grandPeriod = 50 + 80 + 0;
  const grandClosing = 150 + 280 + 300;

  const sheet = buildWIPSheet(wipRows);
  downloadExcel([sheet], "d2-wip.xlsx");

  const wb = XLSX.readFile("d2-wip.xlsx");
  assert(wb.SheetNames.includes("WIP Detail"), "sheet name present");
  const ws = wb.Sheets["WIP Detail"];

  const alphaTotal = findRow(ws, "Alpha — Total");
  assert(alphaTotal !== null, "Alpha — Total row");
  assertClose(evalExpr((ws[`E${alphaTotal}`].f) as string, ws), 150 + 280, "Alpha total closing");

  const grand = findRow(ws, "GRAND TOTAL");
  assert(grand !== null, "GRAND TOTAL row");
  assertClose(evalExpr((ws[`C${grand}`].f) as string, ws), grandOpening, "Grand opening");
  assertClose(evalExpr((ws[`D${grand}`].f) as string, ws), grandPeriod, "Grand period addition");
  assertClose(evalExpr((ws[`E${grand}`].f) as string, ws), grandClosing, "Grand closing");
}

// ------------------------------------------------------------------
// Test 4 — D3 Working Capital
// ------------------------------------------------------------------
console.log("\n[4/5] D3 — Working Capital");
{
  const assetBuckets: Parameters<typeof buildWorkingCapitalSheet>[0] = [
    ["Trade Receivables", { openingNet: 0, closingNet: 0, items: [
      { head: "Customer A", opening: 1000, closing: 1500 },
      { head: "Customer B", opening: 500, closing: 700 },
    ]}],
    ["Inventory", { openingNet: 0, closingNet: 0, items: [
      { head: "Stock", opening: 800, closing: 900 },
    ]}],
  ];
  const liabilityBuckets: Parameters<typeof buildWorkingCapitalSheet>[1] = [
    ["Trade Payables", { openingNet: 0, closingNet: 0, items: [
      { head: "Supplier X", opening: -400, closing: -600 }, // abs => 400/600
    ]}],
  ];
  const totalAssetsOpen = 1000 + 500 + 800;
  const totalAssetsClose = 1500 + 700 + 900;
  const totalLiabOpen = 400;
  const totalLiabClose = 600;
  const nwcOpen = totalAssetsOpen - totalLiabOpen;
  const nwcClose = totalAssetsClose - totalLiabClose;

  const sheet = buildWorkingCapitalSheet(assetBuckets, liabilityBuckets);
  downloadExcel([sheet], "d3.xlsx");

  const wb = XLSX.readFile("d3.xlsx");
  assert(wb.SheetNames.includes("Working Capital"), "sheet name present");
  const ws = wb.Sheets["Working Capital"];

  const subA = findRow(ws, "Sub-Total Current Assets");
  assert(subA !== null, "Sub-Total Current Assets row");
  assertClose(evalExpr((ws[`B${subA}`].f) as string, ws), totalAssetsOpen, "Asset opening total");
  assertClose(evalExpr((ws[`C${subA}`].f) as string, ws), totalAssetsClose, "Asset closing total");
  assertClose(evalExpr((ws[`D${subA}`].f) as string, ws), totalAssetsClose - totalAssetsOpen, "Asset change");

  const subL = findRow(ws, "Sub-Total Current Liabilities");
  assert(subL !== null, "Sub-Total Current Liabilities row");
  assertClose(evalExpr((ws[`B${subL}`].f) as string, ws), totalLiabOpen, "Liab opening total");
  assertClose(evalExpr((ws[`C${subL}`].f) as string, ws), totalLiabClose, "Liab closing total");

  const nwc = findRow(ws, "NET WORKING CAPITAL");
  assert(nwc !== null, "NET WORKING CAPITAL row");
  assertClose(evalExpr((ws[`B${nwc}`].f) as string, ws), nwcOpen, "NWC opening matches dashboard");
  assertClose(evalExpr((ws[`C${nwc}`].f) as string, ws), nwcClose, "NWC closing matches dashboard");

  // IF(...) on the bucket-row Change% — pick first bucket
  const trBucket = findRow(ws, "Trade Receivables");
  assert(trBucket !== null, "Trade Receivables bucket row");
  const pctCell = ws[`E${trBucket}`];
  assert(!!pctCell?.f, "Change % is a formula");
  const expectedPct = ((totalAssetsClose - totalAssetsOpen) / Math.abs(totalAssetsOpen)) * 100;
  // bucket pct is per-bucket: (1500+700) - (1000+500) = 700 over 1500
  const bucketChange = (1500 + 700) - (1000 + 500);
  const bucketPct = (bucketChange / Math.abs(1000 + 500)) * 100;
  void expectedPct;
  assertClose(evalExpr(pctCell.f as string, ws), bucketPct, "Trade Receivables Change %");
}

// ------------------------------------------------------------------
// Test 5 — Cashflow by Project
// ------------------------------------------------------------------
console.log("\n[5/5] Cashflow by Project");
{
  const projectList = ["Alpha", "Beta"];
  const pivotRows = [
    { cfType: "Operating", cfHead: "Operating", isParent: true, projects: { Alpha: 0, Beta: 0 }, total: 0 },
    { cfType: "Operating", cfHead: "Receipts", isParent: false, projects: { Alpha: 1000, Beta: 500 }, total: 1500 },
    { cfType: "Operating", cfHead: "Payments", isParent: false, projects: { Alpha: -400, Beta: -200 }, total: -600 },
    { cfType: "Investing", cfHead: "Investing", isParent: true, projects: { Alpha: 0, Beta: 0 }, total: 0 },
    { cfType: "Investing", cfHead: "Capex", isParent: false, projects: { Alpha: -300, Beta: 0 }, total: -300 },
  ];
  const expectedOperatingAlpha = 1000 + (-400);
  const expectedOperatingBeta = 500 + (-200);
  const expectedOperatingTotal = 1500 + (-600);
  const expectedInvestingAlpha = -300;
  const expectedInvestingTotal = -300;

  const sheet = buildCashflowByProjectSheet(pivotRows, projectList);
  downloadExcel([sheet], "cf-by-proj.xlsx");

  const wb = XLSX.readFile("cf-by-proj.xlsx");
  assert(wb.SheetNames.includes("Cashflow by Project"), "sheet name present");
  const ws = wb.Sheets["Cashflow by Project"];

  const opTotal = findRow(ws, "Operating — Total");
  assert(opTotal !== null, "Operating — Total row");
  assertClose(evalExpr((ws[`B${opTotal}`].f) as string, ws), expectedOperatingAlpha, "Operating Alpha");
  assertClose(evalExpr((ws[`C${opTotal}`].f) as string, ws), expectedOperatingBeta, "Operating Beta");
  assertClose(evalExpr((ws[`D${opTotal}`].f) as string, ws), expectedOperatingTotal, "Operating row total");

  const invTotal = findRow(ws, "Investing — Total");
  assert(invTotal !== null, "Investing — Total row");
  assertClose(evalExpr((ws[`B${invTotal}`].f) as string, ws), expectedInvestingAlpha, "Investing Alpha");
  assertClose(evalExpr((ws[`D${invTotal}`].f) as string, ws), expectedInvestingTotal, "Investing row total");
}

// ------------------------------------------------------------------
console.log(`\n${assertions - failures}/${assertions} assertions passed.`);
if (failures > 0) {
  console.error(`${failures} FAILED`);
  process.exit(1);
} else {
  console.log("All MIS Excel exports produce valid workbooks with intact formulas.");
}
