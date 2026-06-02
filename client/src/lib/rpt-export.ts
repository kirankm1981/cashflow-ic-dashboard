import XLSX from "xlsx-js-style";

type CellStyle = Record<string, unknown>;
type CellValue = string | number | null;
type RowArray = CellValue[];

const THIN_BORDER = { style: "thin", color: { rgb: "D0D0D0" } };
const CELL_BORDER = { top: THIN_BORDER, bottom: THIN_BORDER, left: THIN_BORDER, right: THIN_BORDER };
const FONT_DEFAULT = { name: "Calibri", sz: 10 };
const FONT_BOLD = { name: "Calibri", sz: 10, bold: true };
const FONT_TITLE = { name: "Calibri", sz: 14, bold: true, color: { rgb: "1E3A5F" } };
const FONT_META = { name: "Calibri", sz: 10, color: { rgb: "555555" } };
const FONT_META_BOLD = { name: "Calibri", sz: 10, bold: true, color: { rgb: "333333" } };
const FILL_HEADER = { patternType: "solid", fgColor: { rgb: "2D3748" } };
const FONT_HEADER = { name: "Calibri", sz: 10, bold: true, color: { rgb: "FFFFFF" } };
const FILL_GROUP = { patternType: "solid", fgColor: { rgb: "B45309" } };
const FONT_GROUP = { name: "Calibri", sz: 10, bold: true, color: { rgb: "FFFFFF" } };
const FILL_TOTAL_HDR = { patternType: "solid", fgColor: { rgb: "1E40AF" } };
const FONT_RED = { name: "Calibri", sz: 10, color: { rgb: "CC0000" } };
const FONT_GREEN = { name: "Calibri", sz: 10, color: { rgb: "15803D" } };
const FONT_GREEN_BOLD = { name: "Calibri", sz: 10, bold: true, color: { rgb: "15803D" } };
const FONT_RED_BOLD = { name: "Calibri", sz: 10, bold: true, color: { rgb: "CC0000" } };

function fontForValue(val: number | undefined, bold?: boolean): CellStyle {
  if (val === undefined || val === 0) return bold ? FONT_BOLD : FONT_DEFAULT;
  if (val < 0) return bold ? FONT_RED_BOLD : FONT_RED;
  return bold ? FONT_GREEN_BOLD : FONT_GREEN;
}

function styleCell(ws: XLSX.WorkSheet, r: number, c: number, style: CellStyle) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: "s", v: "" };
  const cell = ws[addr] as { s?: CellStyle };
  cell.s = { ...(cell.s || {}), ...style };
}

function addReportHeaders(ws: XLSX.WorkSheet, reportTitle: string, reportType: string, period: string, colCount: number, filterLabel?: string): number {
  const rows: RowArray[] = [
    ["Assetz Strata — RPT Reports"],
    [],
    ["Report:", reportTitle],
    ["Type:", reportType],
    ["Reporting Period:", period],
  ];
  if (filterLabel) rows.push(["Filter:", filterLabel]);
  rows.push([]);
  XLSX.utils.sheet_add_aoa(ws, rows, { origin: "A1" });
  styleCell(ws, 0, 0, { font: FONT_TITLE });
  for (let i = 2; i < rows.length - 1; i++) {
    styleCell(ws, i, 0, { font: FONT_META_BOLD });
    styleCell(ws, i, 1, { font: FONT_META });
  }
  if (colCount > 1) {
    ws["!merges"] = ws["!merges"] || [];
    ws["!merges"].push({ s: { r: 0, c: 0 }, e: { r: 0, c: Math.min(colCount - 1, 5) } });
  }
  return rows.length;
}

function styleColumnHeaders(ws: XLSX.WorkSheet, row: number, colCount: number) {
  for (let c = 0; c < colCount; c++) {
    styleCell(ws, row, c, { font: FONT_HEADER, fill: FILL_HEADER, border: CELL_BORDER, alignment: { horizontal: c === 0 ? "left" : "right", vertical: "center" } });
  }
}

export interface RptStatusEntity { entityName: string; balances?: Record<string, number>; }
export interface RptStatusGroup { group: string; entities: RptStatusEntity[]; }

export function buildRptStatusWorksheet(opts: {
  groups: RptStatusGroup[];
  dynCols: string[];
  period: string;
  filterLabel?: string;
}): XLSX.WorkSheet {
  const { groups, dynCols, period, filterLabel } = opts;
  const ws: XLSX.WorkSheet = {};
  const colHeader = ["Entity", ...dynCols, "Net", "Status"];
  const colCount = colHeader.length;
  const hdrOffset = addReportHeaders(ws, "Entity Status Report", "RPT Status — Net Lender / Net Borrower", period, colCount, filterLabel);
  const netColIdx = dynCols.length + 1;
  const statusColIdx = dynCols.length + 2;
  const netColLetter = XLSX.utils.encode_col(netColIdx);
  const dataRows: RowArray[] = [colHeader];
  let rowNum = hdrOffset + 1;
  const groupRowIndices: number[] = [];
  for (const grp of groups) {
    const grpExcelRow = rowNum + 1;
    const grpDataRow: RowArray = [grp.group];
    for (let ci = 0; ci < dynCols.length; ci++) grpDataRow.push(null);
    grpDataRow.push(null);
    grpDataRow.push("");
    dataRows.push(grpDataRow);
    groupRowIndices.push(rowNum);
    rowNum++;
    const entityStartRow = rowNum;
    for (const e of grp.entities) {
      const eRow: RowArray = ["  " + e.entityName];
      for (const col of dynCols) eRow.push(e.balances?.[col] || 0);
      eRow.push(null);
      eRow.push(null);
      dataRows.push(eRow);
      rowNum++;
    }
    const entityEndRow = rowNum - 1;
    for (let ei = entityStartRow; ei <= entityEndRow; ei++) {
      const excelR = ei + 1;
      const firstDataCol = XLSX.utils.encode_col(1);
      const lastDataCol = XLSX.utils.encode_col(dynCols.length);
      const netAddr = XLSX.utils.encode_cell({ r: ei, c: netColIdx });
      ws[netAddr] = { t: "n", f: `SUM(${firstDataCol}${excelR}:${lastDataCol}${excelR})`, z: "#,##0" };
      const statusAddr = XLSX.utils.encode_cell({ r: ei, c: statusColIdx });
      ws[statusAddr] = { t: "s", f: `IF(${netColLetter}${excelR}>0,"Net Lender",IF(${netColLetter}${excelR}<0,"Net Borrower",""))` };
    }
    for (let ci = 0; ci < dynCols.length; ci++) {
      const colLetter = XLSX.utils.encode_col(ci + 1);
      const addr = XLSX.utils.encode_cell({ r: grpExcelRow - 1, c: ci + 1 });
      ws[addr] = { t: "n", f: `SUM(${colLetter}${entityStartRow + 1}:${colLetter}${entityEndRow + 1})`, z: "#,##0" };
    }
    const grpNetAddr = XLSX.utils.encode_cell({ r: grpExcelRow - 1, c: netColIdx });
    const firstDataCol = XLSX.utils.encode_col(1);
    const lastDataCol = XLSX.utils.encode_col(dynCols.length);
    ws[grpNetAddr] = { t: "n", f: `SUM(${firstDataCol}${grpExcelRow}:${lastDataCol}${grpExcelRow})`, z: "#,##0" };
  }
  XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: XLSX.utils.encode_cell({ r: hdrOffset, c: 0 }) });
  const totalRows = hdrOffset + dataRows.length;
  styleColumnHeaders(ws, hdrOffset, colCount);
  for (let r = hdrOffset + 1; r < totalRows; r++) {
    const isGroupRow = groupRowIndices.includes(r);
    const srcRow = dataRows[r - hdrOffset];
    if (isGroupRow) {
      for (let c = 0; c < colCount; c++) {
        styleCell(ws, r, c, { font: FONT_GROUP, fill: FILL_GROUP, border: CELL_BORDER, alignment: { horizontal: c === 0 ? "left" : "right" }, numFmt: c > 0 && c <= netColIdx ? "#,##0" : undefined });
      }
    } else {
      for (let c = 0; c < colCount; c++) {
        const isNum = c >= 1 && c <= netColIdx;
        if (isNum) {
          const rawVal = srcRow ? srcRow[c] : undefined;
          const numVal = typeof rawVal === "number" ? rawVal : undefined;
          styleCell(ws, r, c, { font: fontForValue(numVal), border: CELL_BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0" });
        } else if (c === statusColIdx) {
          styleCell(ws, r, c, { font: FONT_BOLD, border: CELL_BORDER, alignment: { horizontal: "left" } });
        } else {
          styleCell(ws, r, c, { font: FONT_DEFAULT, border: CELL_BORDER, alignment: { horizontal: "left" } });
        }
      }
    }
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: colCount - 1 } });
  ws["!cols"] = [{ wch: 45 }, ...dynCols.map(() => ({ wch: 18 })), { wch: 18 }, { wch: 14 }];
  return ws;
}

export interface RptInterGroupDetail { rptGroup: string; balances?: Record<string, number>; }
export interface RptInterGroup { group: string; rptRows: RptInterGroupDetail[]; }

export function buildRptInterGroupWorksheet(opts: {
  groups: RptInterGroup[];
  dynCols: string[];
  period: string;
  filterLabel?: string;
}): XLSX.WorkSheet {
  const { groups, dynCols, period, filterLabel } = opts;
  const ws: XLSX.WorkSheet = {};
  const colHeader = ["Entity Group", "RPT Group", ...dynCols, "Grand Total"];
  const colCount = colHeader.length;
  const hdrOffset = addReportHeaders(ws, "RPT Reconciliation — Inter Group", "Sum of Adj Cl Bal — Entity Group wise, RPT Group wise", period, colCount, filterLabel);
  const gtColIdx = dynCols.length + 2;
  const firstDynCol = 2;
  const dataRows: RowArray[] = [colHeader];
  const groupRowIndices: number[] = [];
  const detailRanges: { grpRow: number; startRow: number; endRow: number }[] = [];
  let rowNum = hdrOffset + 1;
  for (const grp of groups) {
    const grpDataRow: RowArray = [grp.group, ""];
    for (let ci = 0; ci < dynCols.length; ci++) grpDataRow.push(null);
    grpDataRow.push(null);
    dataRows.push(grpDataRow);
    const grpRowIdx = rowNum;
    groupRowIndices.push(rowNum);
    rowNum++;
    const detailStart = rowNum;
    for (const rr of grp.rptRows) {
      const eRow: RowArray = ["", rr.rptGroup];
      for (const col of dynCols) eRow.push(rr.balances?.[col] || 0);
      eRow.push(null);
      dataRows.push(eRow);
      rowNum++;
    }
    const detailEnd = rowNum - 1;
    detailRanges.push({ grpRow: grpRowIdx, startRow: detailStart, endRow: detailEnd });
  }
  const gtRow: RowArray = ["Grand Total", ""];
  for (let ci = 0; ci < dynCols.length; ci++) gtRow.push(null);
  gtRow.push(null);
  dataRows.push(gtRow);
  const grandTotalRowIdx = rowNum;
  rowNum++;
  XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: XLSX.utils.encode_cell({ r: hdrOffset, c: 0 }) });
  for (const { grpRow, startRow, endRow } of detailRanges) {
    for (let dr = startRow; dr <= endRow; dr++) {
      const exR = dr + 1;
      const firstL = XLSX.utils.encode_col(firstDynCol);
      const lastL = XLSX.utils.encode_col(firstDynCol + dynCols.length - 1);
      const addr = XLSX.utils.encode_cell({ r: dr, c: gtColIdx });
      ws[addr] = { t: "n", f: `SUM(${firstL}${exR}:${lastL}${exR})`, z: "#,##0" };
    }
    for (let ci = 0; ci < dynCols.length; ci++) {
      const colL = XLSX.utils.encode_col(firstDynCol + ci);
      const addr = XLSX.utils.encode_cell({ r: grpRow, c: firstDynCol + ci });
      ws[addr] = { t: "n", f: `SUM(${colL}${startRow + 1}:${colL}${endRow + 1})`, z: "#,##0" };
    }
    const grpGtAddr = XLSX.utils.encode_cell({ r: grpRow, c: gtColIdx });
    const firstL = XLSX.utils.encode_col(firstDynCol);
    const lastL = XLSX.utils.encode_col(firstDynCol + dynCols.length - 1);
    ws[grpGtAddr] = { t: "n", f: `SUM(${firstL}${grpRow + 1}:${lastL}${grpRow + 1})`, z: "#,##0" };
  }
  for (let ci = 0; ci < dynCols.length; ci++) {
    const colL = XLSX.utils.encode_col(firstDynCol + ci);
    const refs = groupRowIndices.map(gr => `${colL}${gr + 1}`).join(",");
    const addr = XLSX.utils.encode_cell({ r: grandTotalRowIdx, c: firstDynCol + ci });
    ws[addr] = { t: "n", f: `SUM(${refs})`, z: "#,##0" };
  }
  const gtGtAddr = XLSX.utils.encode_cell({ r: grandTotalRowIdx, c: gtColIdx });
  const firstL = XLSX.utils.encode_col(firstDynCol);
  const lastL = XLSX.utils.encode_col(firstDynCol + dynCols.length - 1);
  ws[gtGtAddr] = { t: "n", f: `SUM(${firstL}${grandTotalRowIdx + 1}:${lastL}${grandTotalRowIdx + 1})`, z: "#,##0" };
  const totalRows = hdrOffset + dataRows.length;
  styleColumnHeaders(ws, hdrOffset, colCount);
  for (let r = hdrOffset + 1; r < totalRows; r++) {
    const isGroupRow = groupRowIndices.includes(r);
    const isGrandTotalRow = r === grandTotalRowIdx;
    const srcRow = dataRows[r - hdrOffset];
    for (let c = 0; c < colCount; c++) {
      const isNum = c >= 2;
      if (isGrandTotalRow) {
        styleCell(ws, r, c, { font: c === 0 ? { ...FONT_GROUP, color: { rgb: "FFFFFF" } } : FONT_GROUP, fill: FILL_TOTAL_HDR, border: CELL_BORDER, alignment: { horizontal: c < 2 ? "left" : "right" }, numFmt: isNum ? "#,##0" : undefined });
      } else if (isGroupRow) {
        styleCell(ws, r, c, { font: FONT_GROUP, fill: FILL_GROUP, border: CELL_BORDER, alignment: { horizontal: c < 2 ? "left" : "right" }, numFmt: isNum ? "#,##0" : undefined });
      } else if (isNum) {
        const cellRaw = srcRow?.[c];
        const numVal = typeof cellRaw === "number" ? cellRaw : undefined;
        styleCell(ws, r, c, { font: fontForValue(numVal), border: CELL_BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0" });
      } else {
        styleCell(ws, r, c, { font: FONT_DEFAULT, border: CELL_BORDER, alignment: { horizontal: "left" } });
      }
    }
  }
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: colCount - 1 } });
  ws["!cols"] = [{ wch: 16 }, { wch: 14 }, ...dynCols.map(() => ({ wch: 20 })), { wch: 18 }];
  return ws;
}
