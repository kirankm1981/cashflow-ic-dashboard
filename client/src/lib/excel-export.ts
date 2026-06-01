import * as XLSX from "xlsx";

type CellValue = string | number | null | undefined;

interface ExcelRow {
  values: CellValue[];
  isHeader?: boolean;
  isSummary?: boolean;
  isSubTotal?: boolean;
  indent?: number;
}

interface FormulaCell {
  f: string;
}

type ExcelCellValue = CellValue | FormulaCell;

interface ExcelSheetConfig {
  name: string;
  headers: string[];
  rows: Array<{
    values: ExcelCellValue[];
    isHeader?: boolean;
    isSummary?: boolean;
    isSubTotal?: boolean;
    indent?: number;
  }>;
  colWidths?: number[];
}

function colLetter(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

export function downloadExcel(sheets: ExcelSheetConfig[], fileName: string) {
  const wb = XLSX.utils.book_new();

  for (const sheet of sheets) {
    const wsData: any[][] = [];

    wsData.push(sheet.headers);

    for (const row of sheet.rows) {
      const r: any[] = [];
      for (let c = 0; c < row.values.length; c++) {
        const val = row.values[c];
        if (val && typeof val === "object" && "f" in val) {
          r.push(val);
        } else {
          if (c === 0 && row.indent) {
            r.push("  ".repeat(row.indent) + (val ?? ""));
          } else {
            r.push(val ?? "");
          }
        }
      }
      wsData.push(r);
    }

    const ws = XLSX.utils.aoa_to_sheet(wsData);

    if (sheet.colWidths) {
      ws["!cols"] = sheet.colWidths.map(w => ({ wch: w }));
    }

    for (let rowIdx = 0; rowIdx < wsData.length; rowIdx++) {
      for (let colIdx = 0; colIdx < wsData[rowIdx].length; colIdx++) {
        const cellRef = colLetter(colIdx) + (rowIdx + 1);
        const cell = ws[cellRef];
        if (!cell) continue;

        const val = wsData[rowIdx][colIdx];
        if (val && typeof val === "object" && "f" in val) {
          ws[cellRef] = { t: "n", f: val.f, v: 0, z: "#,##0.00" };
        }

        if (typeof cell.v === "number") {
          cell.t = "n";
          cell.z = "#,##0.00";
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, sheet.name.substring(0, 31));
  }

  XLSX.writeFile(wb, fileName);
}

export function buildCashflowStatementSheet(
  cfTable: { activity: string; lines: { line: string; debit: number; credit: number; net: number; accountHeads: { head: string; debit: number; credit: number; net: number }[] }[] }[]
): ExcelSheetConfig {
  const headers = ["Category", "Debit", "Credit", "Net Amount"];
  const rows: ExcelSheetConfig["rows"] = [];
  const dCol = colLetter(1);
  const cCol = colLetter(2);
  const nCol = colLetter(3);
  const excelRow = () => rows.length + 2;

  const activityTotalRows: number[] = [];

  for (const section of cfTable) {
    rows.push({ values: [section.activity.toUpperCase(), "", "", ""], isSummary: true });

    const lineRows: number[] = [];

    for (const line of section.lines) {
      const lineIdx = rows.length;
      const lineExcelRow = excelRow();
      rows.push({ values: [line.line, line.debit, line.credit, line.net], isSubTotal: true, indent: 1 });

      if (line.accountHeads.length > 0) {
        const ahStart = excelRow();
        for (const ah of line.accountHeads) {
          rows.push({ values: [ah.head, ah.debit, ah.credit, ah.net], indent: 2 });
        }
        const ahEnd = excelRow() - 1;
        rows[lineIdx].values = [
          line.line,
          { f: `SUM(${dCol}${ahStart}:${dCol}${ahEnd})` },
          { f: `SUM(${cCol}${ahStart}:${cCol}${ahEnd})` },
          { f: `SUM(${nCol}${ahStart}:${nCol}${ahEnd})` },
        ];
      }
      lineRows.push(lineExcelRow);
    }

    const totalExcelRow = excelRow();
    rows.push({
      values: [
        `Subtotal — ${section.activity}`,
        lineRows.length > 0 ? { f: `SUM(${lineRows.map(r => `${dCol}${r}`).join(",")})` } : "",
        lineRows.length > 0 ? { f: `SUM(${lineRows.map(r => `${cCol}${r}`).join(",")})` } : "",
        lineRows.length > 0 ? { f: `SUM(${lineRows.map(r => `${nCol}${r}`).join(",")})` } : "",
      ],
      isSummary: true,
    });
    activityTotalRows.push(totalExcelRow);

    rows.push({ values: ["", "", "", ""] });
  }

  if (activityTotalRows.length > 0) {
    rows.push({
      values: [
        "Grand Total — Net Change in Cash",
        { f: `SUM(${activityTotalRows.map(r => `${dCol}${r}`).join(",")})` },
        { f: `SUM(${activityTotalRows.map(r => `${cCol}${r}`).join(",")})` },
        { f: `SUM(${activityTotalRows.map(r => `${nCol}${r}`).join(",")})` },
      ],
      isSummary: true,
    });
  }

  return { name: "Indirect CF Statement", headers, rows, colWidths: [40, 18, 18, 18] };
}

export function buildPLSheet(
  plSums: Record<string, { periodNet: number; items: { head: string; net: number }[] }>,
  plOrder: string[],
  plSigns: Record<string, number>,
  calculatedLabels: Record<string, string>
): ExcelSheetConfig {
  const headers = ["P&L Category", "Amount"];
  const rows: ExcelSheetConfig["rows"] = [];

  const categoryRowMap: Record<string, number> = {};

  for (const item of plOrder) {
    if (item.startsWith("__")) {
      const excelRow = rows.length + 2;
      let formula = "";
      switch (item) {
        case "__TOTAL_INCOME__":
          formula = buildSumFormula(["Revenue from Operations", "Other Income"], categoryRowMap, 1);
          break;
        case "__GROSS_PROFIT__":
          formula = buildAddFormula(["__TOTAL_INCOME__", "Cost of Construction"], categoryRowMap, 1);
          break;
        case "__EBITDA__":
          formula = buildAddFormula(["__GROSS_PROFIT__", "Employee Expenses", "Sales & Marketing", "Admin & Other Expenses", "Facility Management"], categoryRowMap, 1);
          break;
        case "__EBIT__":
          formula = buildAddFormula(["__EBITDA__", "Depreciation & Amortization"], categoryRowMap, 1);
          break;
        case "__EBT__":
          formula = buildAddFormula(["__EBIT__", "Finance Cost"], categoryRowMap, 1);
          break;
        case "__PAT__":
          formula = buildAddFormula(["__EBT__", "Tax Expense"], categoryRowMap, 1);
          break;
      }
      categoryRowMap[item] = excelRow;
      rows.push({
        values: [calculatedLabels[item] || item, formula ? { f: formula } : ""],
        isSummary: true,
      });
      continue;
    }

    const data = plSums[item];
    if (!data) continue;

    const catExcelRow = rows.length + 2;
    categoryRowMap[item] = catExcelRow;

    rows.push({ values: [item, data.periodNet], isSubTotal: true });

    if (data.items.length > 0) {
      const ahStartExcelRow = rows.length + 2;
      for (const ah of data.items) {
        rows.push({ values: [ah.head, ah.net], indent: 1 });
      }
      const ahEndExcelRow = rows.length + 1;

      const bCol = colLetter(1);
      const catIdx = rows.length - data.items.length - 1;
      rows[catIdx].values = [item, { f: `SUM(${bCol}${ahStartExcelRow}:${bCol}${ahEndExcelRow})` }];
    }
  }

  return { name: "Profit & Loss", headers, rows, colWidths: [40, 20] };
}

function buildSumFormula(cats: string[], rowMap: Record<string, number>, col: number): string {
  const refs = cats.filter(c => rowMap[c]).map(c => `${colLetter(col)}${rowMap[c]}`);
  return refs.length > 0 ? `SUM(${refs.join(",")})` : "";
}

function buildAddFormula(cats: string[], rowMap: Record<string, number>, col: number): string {
  const refs = cats.filter(c => rowMap[c]).map(c => `${colLetter(col)}${rowMap[c]}`);
  return refs.length > 0 ? refs.join("+") : "";
}

export function buildWIPSheet(
  wipRows: { project: string; component: string; opening: number; period: number; closing: number }[]
): ExcelSheetConfig {
  const headers = ["Project", "WIP Component", "Opening", "Period Addition", "Closing"];
  const rows: ExcelSheetConfig["rows"] = [];
  const excelRow = () => rows.length + 2;
  const cCol = colLetter(2);
  const dCol = colLetter(3);
  const eCol = colLetter(4);

  const projects = [...new Set(wipRows.map(r => r.project))].sort();
  const projectTotalRows: number[] = [];

  for (const proj of projects) {
    const projItems = wipRows.filter(r => r.project === proj).sort((a, b) => Math.abs(b.closing) - Math.abs(a.closing));
    const startRow = excelRow();

    for (const item of projItems) {
      rows.push({ values: [proj, item.component, item.opening, item.period, item.closing] });
    }

    if (projItems.length > 1) {
      const endRow = excelRow() - 1;
      const totalRow = excelRow();
      rows.push({
        values: [
          `${proj} — Total`,
          "",
          { f: `SUM(${cCol}${startRow}:${cCol}${endRow})` },
          { f: `SUM(${dCol}${startRow}:${dCol}${endRow})` },
          { f: `SUM(${eCol}${startRow}:${eCol}${endRow})` },
        ],
        isSubTotal: true,
      });
      projectTotalRows.push(totalRow);
    } else {
      projectTotalRows.push(startRow);
    }
  }

  if (projectTotalRows.length > 0) {
    rows.push({
      values: [
        "GRAND TOTAL",
        "",
        { f: projectTotalRows.map(r => `${cCol}${r}`).join("+") },
        { f: projectTotalRows.map(r => `${dCol}${r}`).join("+") },
        { f: projectTotalRows.map(r => `${eCol}${r}`).join("+") },
      ],
      isSummary: true,
    });
  }

  return { name: "WIP Detail", headers, rows, colWidths: [30, 22, 18, 18, 18] };
}

export function buildWorkingCapitalSheet(
  assetBuckets: [string, { openingNet: number; closingNet: number; items: { head: string; opening: number; closing: number }[] }][],
  liabilityBuckets: [string, { openingNet: number; closingNet: number; items: { head: string; opening: number; closing: number }[] }][]
): ExcelSheetConfig {
  const headers = ["WC Bucket / Account Head", "Opening", "Closing", "Change", "Change %"];
  const rows: ExcelSheetConfig["rows"] = [];
  const excelRow = () => rows.length + 2;
  const bCol = colLetter(1);
  const cCol = colLetter(2);
  const dCol = colLetter(3);

  function buildBucketSection(
    buckets: [string, { openingNet: number; closingNet: number; items: { head: string; opening: number; closing: number }[] }][],
    absValues: boolean
  ): number[] {
    const bucketRows: number[] = [];
    for (const [bucket, data] of buckets) {
      const bucketIdx = rows.length;
      const bucketExcelRow = excelRow();
      rows.push({ values: [bucket, data.openingNet, data.closingNet, "", ""], isSubTotal: true });

      if (data.items.length > 0) {
        const ahStart = excelRow();
        for (const ah of data.items) {
          const op = absValues ? Math.abs(ah.opening) : ah.opening;
          const cl = absValues ? Math.abs(ah.closing) : ah.closing;
          const change = cl - op;
          rows.push({
            values: [ah.head, op, cl, change, op !== 0 ? ((change / Math.abs(op)) * 100) : 0],
            indent: 1,
          });
        }
        const ahEnd = excelRow() - 1;
        rows[bucketIdx].values = [
          bucket,
          { f: `SUM(${bCol}${ahStart}:${bCol}${ahEnd})` },
          { f: `SUM(${cCol}${ahStart}:${cCol}${ahEnd})` },
          { f: `${cCol}${bucketExcelRow}-${bCol}${bucketExcelRow}` },
          { f: `IF(${bCol}${bucketExcelRow}=0,0,(${dCol}${bucketExcelRow}/ABS(${bCol}${bucketExcelRow}))*100)` },
        ];
      } else {
        const op = absValues ? Math.abs(data.openingNet) : data.openingNet;
        const cl = absValues ? Math.abs(data.closingNet) : data.closingNet;
        const change = cl - op;
        rows[bucketIdx].values = [bucket, op, cl, change, op !== 0 ? ((change / Math.abs(op)) * 100) : 0];
      }
      bucketRows.push(bucketExcelRow);
    }
    return bucketRows;
  }

  rows.push({ values: ["CURRENT ASSETS", "", "", "", ""], isSummary: true });
  const assetBucketRows = buildBucketSection(assetBuckets, false);

  const assetTotalRow = excelRow();
  rows.push({
    values: [
      "Sub-Total Current Assets",
      assetBucketRows.length > 0 ? { f: assetBucketRows.map(r => `${bCol}${r}`).join("+") } : "",
      assetBucketRows.length > 0 ? { f: assetBucketRows.map(r => `${cCol}${r}`).join("+") } : "",
      assetBucketRows.length > 0 ? { f: `${cCol}${assetTotalRow}-${bCol}${assetTotalRow}` } : "",
      "",
    ],
    isSummary: true,
  });

  rows.push({ values: ["", "", "", "", ""] });

  rows.push({ values: ["CURRENT LIABILITIES", "", "", "", ""], isSummary: true });
  const liabBucketRows = buildBucketSection(liabilityBuckets, true);

  const liabTotalRow = excelRow();
  rows.push({
    values: [
      "Sub-Total Current Liabilities",
      liabBucketRows.length > 0 ? { f: liabBucketRows.map(r => `${bCol}${r}`).join("+") } : "",
      liabBucketRows.length > 0 ? { f: liabBucketRows.map(r => `${cCol}${r}`).join("+") } : "",
      liabBucketRows.length > 0 ? { f: `${cCol}${liabTotalRow}-${bCol}${liabTotalRow}` } : "",
      "",
    ],
    isSummary: true,
  });

  rows.push({ values: ["", "", "", "", ""] });

  rows.push({
    values: [
      "NET WORKING CAPITAL",
      { f: `${bCol}${assetTotalRow}-${bCol}${liabTotalRow}` },
      { f: `${cCol}${assetTotalRow}-${cCol}${liabTotalRow}` },
      "",
      "",
    ],
    isSummary: true,
  });

  return { name: "Working Capital", headers, rows, colWidths: [40, 18, 18, 18, 14] };
}

export function buildCashflowByProjectSheet(
  pivotRows: Array<{ cfType: string; cfHead: string; isParent: boolean; projects: Record<string, number>; total: number }>,
  projectList: string[]
): ExcelSheetConfig {
  const headers = ["Cashflow / CF Head", ...projectList, "Total"];
  const rows: ExcelSheetConfig["rows"] = [];
  const excelRow = () => rows.length + 2;

  const cfTypes = Array.from(new Set(pivotRows.map(r => r.cfType)));

  for (const cfType of cfTypes) {
    const parent = pivotRows.find(r => r.isParent && r.cfType === cfType);
    const children = pivotRows.filter(r => !r.isParent && r.cfType === cfType);
    if (!parent) continue;

    const parentIdx = rows.length;
    excelRow();
    const parentVals: ExcelCellValue[] = [cfType + " — Total"];
    for (const proj of projectList) {
      parentVals.push(parent.projects[proj] || 0);
    }
    parentVals.push(parent.total);
    rows.push({ values: parentVals, isSummary: true });

    if (children.length > 0) {
      const childStart = excelRow();
      for (const child of children) {
        const vals: ExcelCellValue[] = [child.cfHead];
        for (const proj of projectList) {
          vals.push(child.projects[proj] || 0);
        }
        vals.push(child.total);
        rows.push({ values: vals, indent: 1 });
      }
      const childEnd = excelRow() - 1;

      const formulaVals: ExcelCellValue[] = [cfType + " — Total"];
      for (let pi = 0; pi < projectList.length; pi++) {
        const col = colLetter(pi + 1);
        formulaVals.push({ f: `SUM(${col}${childStart}:${col}${childEnd})` });
      }
      const totalCol = colLetter(projectList.length + 1);
      formulaVals.push({ f: `SUM(${totalCol}${childStart}:${totalCol}${childEnd})` });
      rows[parentIdx].values = formulaVals;
    }

    rows.push({ values: Array(projectList.length + 2).fill("") });
  }

  return {
    name: "Cashflow by Project",
    headers,
    rows,
    colWidths: [35, ...projectList.map(() => 16), 18],
  };
}
