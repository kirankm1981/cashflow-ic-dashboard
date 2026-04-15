import { useState, useMemo, useEffect, useRef, Fragment } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Loader2, Download, Plus, Trash2, Pencil, X, Save, Upload, FileDown } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MultiSelectFilter } from "@/components/ui/multi-select-filter";
import * as XLSX from "xlsx-js-style";

function formatNum(val: number | null | undefined): string {
  if (val === null || val === undefined || val === 0) return "-";
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(val);
}

function cellColor(val: number): string {
  if (val > 0) return "text-green-700 dark:text-green-400";
  if (val < 0) return "text-red-700 dark:text-red-400";
  return "text-muted-foreground";
}

interface AeEntry {
  id: number;
  entityCompanyCode: string;
  entityName: string | null;
  rptLedger: string;
  rptCounterPartyCode: string | null;
  rptCounterPartyName: string | null;
  amount: number;
  natureOfBalance: string | null;
  narration: string | null;
  icTxnType: string | null;
  rptTxnType: string | null;
  icType: string | null;
  createdAt: string | null;
  createdBy: string | null;
}

function formatIndian(val: number | null | undefined): string {
  if (val === null || val === undefined || val === 0) return "-";
  const abs = Math.abs(val);
  const formatted = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 0 }).format(abs);
  return val < 0 ? `(${formatted})` : formatted;
}

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
const FILL_TOTAL_COL = { patternType: "solid", fgColor: { rgb: "EBF5FF" } };
const FILL_TOTAL_HDR = { patternType: "solid", fgColor: { rgb: "1E40AF" } };
const FONT_RED = { name: "Calibri", sz: 10, color: { rgb: "CC0000" } };
const FONT_GREEN = { name: "Calibri", sz: 10, color: { rgb: "15803D" } };
const FONT_GREEN_BOLD = { name: "Calibri", sz: 10, bold: true, color: { rgb: "15803D" } };
const FONT_RED_BOLD = { name: "Calibri", sz: 10, bold: true, color: { rgb: "CC0000" } };

function fontForValue(val: number | undefined, bold?: boolean): any {
  if (val === undefined || val === 0) return bold ? FONT_BOLD : FONT_DEFAULT;
  if (val < 0) return bold ? FONT_RED_BOLD : FONT_RED;
  return bold ? FONT_GREEN_BOLD : FONT_GREEN;
}

function downloadXlsx(ws: XLSX.WorkSheet, fileName: string, sheetName?: string) {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName || "Sheet1");
  XLSX.writeFile(wb, fileName);
}

function styleCell(ws: XLSX.WorkSheet, r: number, c: number, style: any) {
  const addr = XLSX.utils.encode_cell({ r, c });
  if (!ws[addr]) ws[addr] = { t: "s", v: "" };
  ws[addr].s = { ...(ws[addr].s || {}), ...style };
}

function addReportHeaders(ws: XLSX.WorkSheet, reportTitle: string, reportType: string, period: string, colCount: number, filterLabel?: string): number {
  const rows: any[][] = [
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


const IC_TYPE_OPTIONS = [
  { value: "IC", label: "IC" },
  { value: "RPT", label: "RPT" },
];

function buildFilterUrl(base: string, filters: Record<string, string | string[]>): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (Array.isArray(v)) {
      if (v.length) params.set(k, v.join(","));
    } else if (v) {
      params.set(k, v);
    }
  }
  const qs = params.toString();
  return qs ? `${base}?${qs}` : base;
}

function StatusTab({ period }: { period: string }) {
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const { data, isLoading } = useQuery<{ data: any[]; dynamicColumns: string[]; icTxnTypes: string[] }>({
    queryKey: ["/api/recon/rpt-report/status", icTxnType, icType],
    queryFn: async () => {
      const url = buildFilterUrl("/api/recon/rpt-report/status", { icTxnType, icType });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const icTxnTypes = data?.icTxnTypes || [];
  const groups = data?.data || [];
  const dynCols = data?.dynamicColumns || [];

  return (
    <Card data-testid="card-rpt-status">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm">Entity Status Report</CardTitle>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
            <MultiSelectFilter
              options={icTxnTypes.map(t => ({ value: t, label: t }))}
              selected={icTxnType}
              onChange={setIcTxnType}
              placeholder="All Types"
              className="w-[180px]"
              data-testid="select-ic-txn-type"
            />
            <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
            <MultiSelectFilter
              options={IC_TYPE_OPTIONS}
              selected={icType}
              onChange={setIcType}
              placeholder="All"
              className="w-[120px]"
              data-testid="select-ic-type"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!groups.length}
              data-testid="btn-download-status"
              onClick={() => {
                const ws: XLSX.WorkSheet = {};
                const colHeader = ["Entity", ...dynCols, "Net", "Status"];
                const colCount = colHeader.length;
                const filterParts: string[] = [];
                if (icTxnType.length) filterParts.push(`IC Txn Type: ${icTxnType.join(", ")}`);
                if (icType.length) filterParts.push(`RPT Type: ${icType.join(", ")}`);
                const filterLabel = filterParts.length ? filterParts.join(" | ") : undefined;
                const hdrOffset = addReportHeaders(ws, "Entity Status Report", "RPT Status — Net Lender / Net Borrower", period, colCount, filterLabel);
                const netColIdx = dynCols.length + 1;
                const statusColIdx = dynCols.length + 2;
                const netColLetter = XLSX.utils.encode_col(netColIdx);
                const dataRows: any[][] = [colHeader];
                let rowNum = hdrOffset + 1;
                const groupRowIndices: number[] = [];
                for (const grp of groups) {
                  const grpExcelRow = rowNum + 1;
                  const grpDataRow: any[] = [grp.group];
                  for (let ci = 0; ci < dynCols.length; ci++) grpDataRow.push(null);
                  grpDataRow.push(null);
                  grpDataRow.push("");
                  dataRows.push(grpDataRow);
                  groupRowIndices.push(rowNum);
                  rowNum++;
                  const entityStartRow = rowNum;
                  for (const e of grp.entities) {
                    const eRow: any[] = ["  " + e.entityName];
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
                let dataIdx = 0;
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
                const suffix = icTxnType.length ? `_${icTxnType.join("_")}` : "";
                downloadXlsx(ws, `RPT_Status${suffix}.xlsx`, "Status");
              }}
            >
              <Download className="w-3 h-3 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">No RPT data available. Upload and process GL files first.</p>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-xs" data-testid="table-rpt-status">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Entity</th>
                  {dynCols.map(col => (
                    <th key={col} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{col}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Net</th>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Status</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((grp: any) => (
                  <Fragment key={`grp-${grp.group}`}>
                    <tr className="bg-amber-700/90 dark:bg-amber-800/80 text-white font-bold" data-testid={`row-group-${grp.group}`}>
                      <td className="px-3 py-1.5 font-bold">{grp.group}</td>
                      {dynCols.map(col => (
                        <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(grp.totals?.[col])}</td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${grp.totalNet < 0 ? "text-red-200" : ""}`}>{formatIndian(grp.totalNet)}</td>
                      <td className="px-3 py-1.5"></td>
                    </tr>
                    {grp.entities.map((e: any, i: number) => (
                      <tr key={`${grp.group}-${i}`} className="border-b hover:bg-muted/30" data-testid={`row-entity-${grp.group}-${i}`}>
                        <td className="px-3 py-1 pl-6 whitespace-nowrap">{e.entityName}</td>
                        {dynCols.map(col => {
                          const v = e.balances?.[col] || 0;
                          return (
                            <td key={col} className={`px-3 py-1 text-right tabular-nums ${v !== 0 ? "text-foreground" : "text-muted-foreground"}`}>
                              {formatIndian(v)}
                            </td>
                          );
                        })}
                        <td className={`px-3 py-1 text-right tabular-nums font-medium ${e.net < 0 ? "text-red-600 dark:text-red-400" : e.net > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                          {formatIndian(e.net)}
                        </td>
                        <td className="px-3 py-1 whitespace-nowrap">
                          {e.status === "Net Lender" && <span className="text-green-700 dark:text-green-400 font-semibold">Net Lender</span>}
                          {e.status === "Net Borrower" && <span className="text-red-700 dark:text-red-400 font-semibold">Net Borrower</span>}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function InterGroupTab({ period }: { period: string }) {
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { data, isLoading } = useQuery<{ data: any[]; dynamicColumns: string[]; icTxnTypes: string[]; overallTotals: Record<string, number>; overallGrandTotal: number }>({
    queryKey: ["/api/recon/rpt-report/inter-group", icTxnType, icType],
    queryFn: async () => {
      const url = buildFilterUrl("/api/recon/rpt-report/inter-group", { icTxnType, icType });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const icTxnTypes = data?.icTxnTypes || [];
  const groups = data?.data || [];
  const dynCols = data?.dynamicColumns || [];
  const overallTotals = data?.overallTotals || {};
  const overallGrandTotal = data?.overallGrandTotal || 0;

  const toggleGroup = (group: string) => setCollapsed(prev => ({ ...prev, [group]: !prev[group] }));

  return (
    <Card data-testid="card-rpt-intergroup">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm">RPT Reconciliation — Inter Group</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Sum of Adj Cl Bal — Entity Group wise, RPT Group wise</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
            <MultiSelectFilter
              options={icTxnTypes.map(t => ({ value: t, label: t }))}
              selected={icTxnType}
              onChange={setIcTxnType}
              placeholder="All Types"
              className="w-[180px]"
              data-testid="select-intergroup-ic-txn-type"
            />
            <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
            <MultiSelectFilter
              options={IC_TYPE_OPTIONS}
              selected={icType}
              onChange={setIcType}
              placeholder="All"
              className="w-[120px]"
              data-testid="select-intergroup-ic-type"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!groups.length}
              data-testid="btn-download-intergroup"
              onClick={() => {
                const ws: XLSX.WorkSheet = {};
                const colHeader = ["Entity Group", "RPT Group", ...dynCols, "Grand Total"];
                const colCount = colHeader.length;
                const filterParts: string[] = [];
                if (icTxnType.length) filterParts.push(`IC Txn Type: ${icTxnType.join(", ")}`);
                if (icType.length) filterParts.push(`RPT Type: ${icType.join(", ")}`);
                const filterLabel = filterParts.length ? filterParts.join(" | ") : undefined;
                const hdrOffset = addReportHeaders(ws, "RPT Reconciliation — Inter Group", "Sum of Adj Cl Bal — Entity Group wise, RPT Group wise", period, colCount, filterLabel);
                const gtColIdx = dynCols.length + 2;
                const firstDynCol = 2;
                const dataRows: any[][] = [colHeader];
                const groupRowIndices: number[] = [];
                const detailRanges: { grpRow: number; startRow: number; endRow: number }[] = [];
                let rowNum = hdrOffset + 1;
                for (const grp of groups) {
                  const grpDataRow: any[] = [grp.group, ""];
                  for (let ci = 0; ci < dynCols.length; ci++) grpDataRow.push(null);
                  grpDataRow.push(null);
                  dataRows.push(grpDataRow);
                  const grpRowIdx = rowNum;
                  groupRowIndices.push(rowNum);
                  rowNum++;
                  const detailStart = rowNum;
                  for (const rr of grp.rptRows) {
                    const eRow: any[] = ["", rr.rptGroup];
                    for (const col of dynCols) eRow.push(rr.balances?.[col] || 0);
                    eRow.push(null);
                    dataRows.push(eRow);
                    rowNum++;
                  }
                  const detailEnd = rowNum - 1;
                  detailRanges.push({ grpRow: grpRowIdx, startRow: detailStart, endRow: detailEnd });
                }
                const gtRow: any[] = ["Grand Total", ""];
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
                      const numVal = typeof srcRow?.[c] === "number" ? srcRow[c] : undefined;
                      styleCell(ws, r, c, { font: fontForValue(numVal), border: CELL_BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0" });
                    } else {
                      styleCell(ws, r, c, { font: FONT_DEFAULT, border: CELL_BORDER, alignment: { horizontal: "left" } });
                    }
                  }
                }
                ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: colCount - 1 } });
                ws["!cols"] = [{ wch: 16 }, { wch: 14 }, ...dynCols.map(() => ({ wch: 20 })), { wch: 18 }];
                const suffix = icTxnType.length ? `_${icTxnType.join("_")}` : "";
                downloadXlsx(ws, `RPT_Inter_Group${suffix}.xlsx`, "Inter Group");
              }}
            >
              <Download className="w-3 h-3 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">No inter-group data available.</p>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-xs" data-testid="table-rpt-intergroup">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Entity Group</th>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">RPT Group</th>
                  {dynCols.map(col => (
                    <th key={col} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{col}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Grand Total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((grp: any) => (
                  <Fragment key={`grp-${grp.group}`}>
                    <tr
                      className="bg-amber-700/90 dark:bg-amber-800/80 text-white font-bold cursor-pointer"
                      data-testid={`row-intergroup-group-${grp.group}`}
                      onClick={() => toggleGroup(grp.group)}
                    >
                      <td className="px-3 py-1.5 font-bold">
                        <span className="mr-1">{collapsed[grp.group] ? "▸" : "▾"}</span>
                        {grp.group}
                      </td>
                      <td className="px-3 py-1.5"></td>
                      {dynCols.map(col => (
                        <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(grp.totals?.[col])}</td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${grp.grandTotal < 0 ? "text-red-200" : ""}`}>{formatIndian(grp.grandTotal)}</td>
                    </tr>
                    {!collapsed[grp.group] && grp.rptRows.map((rr: any, i: number) => (
                      <tr key={`${grp.group}-${rr.rptGroup}-${i}`} className="border-b hover:bg-muted/30" data-testid={`row-intergroup-${grp.group}-${rr.rptGroup}`}>
                        <td className="px-3 py-1 pl-6"></td>
                        <td className="px-3 py-1 whitespace-nowrap">{rr.rptGroup}</td>
                        {dynCols.map(col => {
                          const v = rr.balances?.[col] || 0;
                          return (
                            <td key={col} className={`px-3 py-1 text-right tabular-nums ${v !== 0 ? "text-foreground" : "text-muted-foreground"}`}>
                              {formatIndian(v)}
                            </td>
                          );
                        })}
                        <td className={`px-3 py-1 text-right tabular-nums font-medium ${rr.grandTotal < 0 ? "text-red-600 dark:text-red-400" : rr.grandTotal > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                          {formatIndian(rr.grandTotal)}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="bg-slate-800 dark:bg-slate-700 text-white font-bold" data-testid="row-intergroup-grand-total">
                  <td className="px-3 py-1.5 font-bold">Grand Total</td>
                  <td className="px-3 py-1.5"></td>
                  {dynCols.map(col => (
                    <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(overallTotals[col])}</td>
                  ))}
                  <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${overallGrandTotal < 0 ? "text-red-200" : ""}`}>{formatIndian(overallGrandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PivotGroupwiseTab({ period }: { period: string }) {
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { data, isLoading } = useQuery<{ data: any[]; dynamicColumns: string[]; icTxnTypes: string[]; overallTotals: Record<string, number>; overallGrandTotal: number }>({
    queryKey: ["/api/recon/rpt-report/pivot-groupwise", icTxnType, icType],
    queryFn: async () => {
      const url = buildFilterUrl("/api/recon/rpt-report/pivot-groupwise", { icTxnType, icType });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const icTxnTypes = data?.icTxnTypes || [];
  const groups = data?.data || [];
  const dynCols = data?.dynamicColumns || [];
  const overallTotals = data?.overallTotals || {};
  const overallGrandTotal = data?.overallGrandTotal || 0;

  const toggleGroup = (group: string) => setCollapsed(prev => ({ ...prev, [group]: !prev[group] }));

  return (
    <Card data-testid="card-rpt-pivot-group">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm">RPT Reconciliation — Pivot Groupwise</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Sum of Adj Cl Bal — Entity Group wise, Entity wise</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
            <MultiSelectFilter
              options={icTxnTypes.map(t => ({ value: t, label: t }))}
              selected={icTxnType}
              onChange={setIcTxnType}
              placeholder="All Types"
              className="w-[180px]"
              data-testid="select-pivot-ic-txn-type"
            />
            <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
            <MultiSelectFilter
              options={IC_TYPE_OPTIONS}
              selected={icType}
              onChange={setIcType}
              placeholder="All"
              className="w-[120px]"
              data-testid="select-pivot-ic-type"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!groups.length}
              data-testid="btn-download-pivot-group"
              onClick={() => {
                const ws: XLSX.WorkSheet = {};
                const colHeader = ["Entity Group", "Entity", ...dynCols, "Grand Total"];
                const colCount = colHeader.length;
                const filterParts: string[] = [];
                if (icTxnType.length) filterParts.push(`IC Txn Type: ${icTxnType.join(", ")}`);
                if (icType.length) filterParts.push(`RPT Type: ${icType.join(", ")}`);
                const filterLabel = filterParts.length ? filterParts.join(" | ") : undefined;
                const hdrOffset = addReportHeaders(ws, "RPT Reconciliation — Pivot Groupwise", "Sum of Adj Cl Bal — Entity Group wise, Entity wise", period, colCount, filterLabel);
                const gtColIdx = dynCols.length + 2;
                const firstDynCol = 2;
                const dataRows: any[][] = [colHeader];
                const groupRowIndices: number[] = [];
                const detailRanges: { grpRow: number; startRow: number; endRow: number }[] = [];
                let rowNum = hdrOffset + 1;
                for (const grp of groups) {
                  const grpDataRow: any[] = [grp.group, ""];
                  for (let ci = 0; ci < dynCols.length; ci++) grpDataRow.push(null);
                  grpDataRow.push(null);
                  dataRows.push(grpDataRow);
                  const grpRowIdx = rowNum;
                  groupRowIndices.push(rowNum);
                  rowNum++;
                  const detailStart = rowNum;
                  for (const e of grp.entities) {
                    const eRow: any[] = ["", e.entityName];
                    for (const col of dynCols) eRow.push(e.balances?.[col] || 0);
                    eRow.push(null);
                    dataRows.push(eRow);
                    rowNum++;
                  }
                  const detailEnd = rowNum - 1;
                  detailRanges.push({ grpRow: grpRowIdx, startRow: detailStart, endRow: detailEnd });
                }
                const gtRow: any[] = ["Grand Total", ""];
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
                      const numVal = typeof srcRow?.[c] === "number" ? srcRow[c] : undefined;
                      styleCell(ws, r, c, { font: fontForValue(numVal), border: CELL_BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0" });
                    } else {
                      styleCell(ws, r, c, { font: FONT_DEFAULT, border: CELL_BORDER, alignment: { horizontal: "left" } });
                    }
                  }
                }
                ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: colCount - 1 } });
                ws["!cols"] = [{ wch: 16 }, { wch: 40 }, ...dynCols.map(() => ({ wch: 20 })), { wch: 18 }];
                const suffix = icTxnType.length ? `_${icTxnType.join("_")}` : "";
                downloadXlsx(ws, `RPT_Pivot_Groupwise${suffix}.xlsx`, "Pivot Groupwise");
              }}
            >
              <Download className="w-3 h-3 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {groups.length === 0 ? (
          <p className="text-muted-foreground text-sm py-8 text-center">No pivot data available.</p>
        ) : (
          <div className="overflow-auto max-h-[70vh]">
            <table className="w-full text-xs" data-testid="table-rpt-pivot-group">
              <thead className="bg-muted/50 sticky top-0 z-10">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Entity Group</th>
                  <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Entity</th>
                  {dynCols.map(col => (
                    <th key={col} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{col}</th>
                  ))}
                  <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Grand Total</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((grp: any) => (
                  <Fragment key={`grp-${grp.group}`}>
                    <tr
                      className="bg-amber-700/90 dark:bg-amber-800/80 text-white font-bold cursor-pointer"
                      data-testid={`row-pivot-group-${grp.group}`}
                      onClick={() => toggleGroup(grp.group)}
                    >
                      <td className="px-3 py-1.5 font-bold">
                        <span className="mr-1">{collapsed[grp.group] ? "▸" : "▾"}</span>
                        {grp.group}
                      </td>
                      <td className="px-3 py-1.5"></td>
                      {dynCols.map(col => (
                        <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(grp.totals?.[col])}</td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${grp.grandTotal < 0 ? "text-red-200" : ""}`}>{formatIndian(grp.grandTotal)}</td>
                    </tr>
                    {!collapsed[grp.group] && grp.entities.map((e: any, i: number) => (
                      <tr key={`${grp.group}-${i}`} className="border-b hover:bg-muted/30" data-testid={`row-pivot-entity-${grp.group}-${i}`}>
                        <td className="px-3 py-1 pl-6"></td>
                        <td className="px-3 py-1 whitespace-nowrap">{e.entityName}</td>
                        {dynCols.map(col => {
                          const v = e.balances?.[col] || 0;
                          return (
                            <td key={col} className={`px-3 py-1 text-right tabular-nums ${v !== 0 ? "text-foreground" : "text-muted-foreground"}`}>
                              {formatIndian(v)}
                            </td>
                          );
                        })}
                        <td className={`px-3 py-1 text-right tabular-nums font-medium ${e.grandTotal < 0 ? "text-red-600 dark:text-red-400" : e.grandTotal > 0 ? "text-foreground" : "text-muted-foreground"}`}>
                          {formatIndian(e.grandTotal)}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                ))}
                <tr className="bg-slate-800 dark:bg-slate-700 text-white font-bold" data-testid="row-pivot-grand-total">
                  <td className="px-3 py-1.5 font-bold">Grand Total</td>
                  <td className="px-3 py-1.5"></td>
                  {dynCols.map(col => (
                    <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(overallTotals[col])}</td>
                  ))}
                  <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${overallGrandTotal < 0 ? "text-red-200" : ""}`}>{formatIndian(overallGrandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function SummaryPivotTab({ period }: { period: string }) {
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const { data, isLoading } = useQuery<{ data: any[]; dynamicColumns: string[]; icTxnTypes: string[]; overallTotals: Record<string, number>; overallGrandTotal: number }>({
    queryKey: ["/api/recon/rpt-report/summary-pivot", icTxnType, icType],
    queryFn: async () => {
      const url = buildFilterUrl("/api/recon/rpt-report/summary-pivot", { icTxnType, icType });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const icTxnTypes = data?.icTxnTypes || [];
  const groups = data?.data || [];
  const dynCols = data?.dynamicColumns || [];
  const overallTotals = data?.overallTotals || {};
  const overallGrandTotal = data?.overallGrandTotal || 0;
  const hasData = groups.length > 0;

  const toggleCollapse = (key: string) => setCollapsed(prev => ({ ...prev, [key]: !prev[key] }));

  return (
    <Card data-testid="card-rpt-summary-pivot">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-sm">Summary Pivot</CardTitle>
            <p className="text-xs text-muted-foreground mt-0.5">Sum of Adj Cl Bal — Entity Group wise, Entity wise, RPT Group wise</p>
          </div>
          <div className="flex items-center gap-2">
            <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
            <MultiSelectFilter
              options={icTxnTypes.map(t => ({ value: t, label: t }))}
              selected={icTxnType}
              onChange={setIcTxnType}
              placeholder="All Types"
              className="w-[180px]"
              data-testid="select-ic-txn-type-summary"
            />
            <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
            <MultiSelectFilter
              options={IC_TYPE_OPTIONS}
              selected={icType}
              onChange={setIcType}
              placeholder="All"
              className="w-[120px]"
              data-testid="select-ic-type-summary"
            />
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              disabled={!hasData}
              data-testid="btn-download-summary-pivot"
              onClick={() => {
                const ws: XLSX.WorkSheet = {};
                const colHeader = ["Entity Group", "Entity Books", "RPT Group", "RPT Full Name", ...dynCols, "Grand Total"];
                const colCount = colHeader.length;
                const filterParts: string[] = [];
                if (icTxnType.length) filterParts.push(`IC Txn Type: ${icTxnType.join(", ")}`);
                if (icType.length) filterParts.push(`RPT Type: ${icType.join(", ")}`);
                const filterLabel = filterParts.length ? filterParts.join(" | ") : undefined;
                const hdrOffset = addReportHeaders(ws, "Summary Pivot", "Sum of Adj Cl Bal — Entity Group wise, Entity wise, RPT Group wise", period, colCount, filterLabel);
                const gtColIdx = dynCols.length + 4;
                const firstDynCol = 4;
                const dataRows: any[][] = [colHeader];
                const groupRowIndices: number[] = [];
                const entityTotalIndices: number[] = [];
                type CpRange = { startRow: number; endRow: number };
                type EntRange = { entTotalRow: number; cpRanges: CpRange[] };
                type GrpRange = { grpRow: number; entTotalRows: number[] };
                const entRanges: EntRange[] = [];
                const grpRanges: GrpRange[] = [];
                const allCpRows: number[] = [];
                let rowNum = hdrOffset + 1;
                for (const grp of groups) {
                  const grpRowIdx = rowNum;
                  groupRowIndices.push(rowNum);
                  const grpRow: any[] = [grp.entityGroup, "", "", ""];
                  for (let ci = 0; ci < dynCols.length; ci++) grpRow.push(null);
                  grpRow.push(null);
                  dataRows.push(grpRow);
                  rowNum++;
                  const grpEntTotalRows: number[] = [];
                  for (const ent of grp.entities) {
                    const entCpRanges: CpRange[] = [];
                    for (const rg of ent.rptGroups) {
                      const cpStart = rowNum;
                      for (const cp of rg.counterParties) {
                        const cpRow: any[] = ["", ent.entityBooks, rg.rptGroup, cp.cpName];
                        for (const col of dynCols) cpRow.push(cp.balances?.[col] || 0);
                        cpRow.push(null);
                        dataRows.push(cpRow);
                        allCpRows.push(rowNum);
                        rowNum++;
                      }
                      const cpEnd = rowNum - 1;
                      entCpRanges.push({ startRow: cpStart, endRow: cpEnd });
                    }
                    const entTotalRow: any[] = ["", ent.entityBooks + " Total", "", ""];
                    for (let ci = 0; ci < dynCols.length; ci++) entTotalRow.push(null);
                    entTotalRow.push(null);
                    dataRows.push(entTotalRow);
                    entityTotalIndices.push(rowNum);
                    entRanges.push({ entTotalRow: rowNum, cpRanges: entCpRanges });
                    grpEntTotalRows.push(rowNum);
                    rowNum++;
                  }
                  grpRanges.push({ grpRow: grpRowIdx, entTotalRows: grpEntTotalRows });
                }
                const gtRow: any[] = ["Grand Total", "", "", ""];
                for (let ci = 0; ci < dynCols.length; ci++) gtRow.push(null);
                gtRow.push(null);
                dataRows.push(gtRow);
                const grandTotalRowIdx = rowNum;
                XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: XLSX.utils.encode_cell({ r: hdrOffset, c: 0 }) });
                const fL = XLSX.utils.encode_col(firstDynCol);
                const lL = XLSX.utils.encode_col(firstDynCol + dynCols.length - 1);
                for (const cpRow of allCpRows) {
                  const addr = XLSX.utils.encode_cell({ r: cpRow, c: gtColIdx });
                  ws[addr] = { t: "n", f: `SUM(${fL}${cpRow + 1}:${lL}${cpRow + 1})`, z: "#,##0" };
                }
                for (const ent of entRanges) {
                  for (let ci = 0; ci < dynCols.length; ci++) {
                    const cL = XLSX.utils.encode_col(firstDynCol + ci);
                    const rangeParts = ent.cpRanges.map(r => `${cL}${r.startRow + 1}:${cL}${r.endRow + 1}`);
                    const addr = XLSX.utils.encode_cell({ r: ent.entTotalRow, c: firstDynCol + ci });
                    ws[addr] = { t: "n", f: `SUM(${rangeParts.join(",")})`, z: "#,##0" };
                  }
                  const entGtAddr = XLSX.utils.encode_cell({ r: ent.entTotalRow, c: gtColIdx });
                  ws[entGtAddr] = { t: "n", f: `SUM(${fL}${ent.entTotalRow + 1}:${lL}${ent.entTotalRow + 1})`, z: "#,##0" };
                }
                for (const grpR of grpRanges) {
                  for (let ci = 0; ci < dynCols.length; ci++) {
                    const cL = XLSX.utils.encode_col(firstDynCol + ci);
                    const refs = grpR.entTotalRows.map(r => `${cL}${r + 1}`).join(",");
                    const addr = XLSX.utils.encode_cell({ r: grpR.grpRow, c: firstDynCol + ci });
                    ws[addr] = { t: "n", f: `SUM(${refs})`, z: "#,##0" };
                  }
                  const grpGtAddr = XLSX.utils.encode_cell({ r: grpR.grpRow, c: gtColIdx });
                  ws[grpGtAddr] = { t: "n", f: `SUM(${fL}${grpR.grpRow + 1}:${lL}${grpR.grpRow + 1})`, z: "#,##0" };
                }
                for (let ci = 0; ci < dynCols.length; ci++) {
                  const cL = XLSX.utils.encode_col(firstDynCol + ci);
                  const refs = groupRowIndices.map(r => `${cL}${r + 1}`).join(",");
                  const addr = XLSX.utils.encode_cell({ r: grandTotalRowIdx, c: firstDynCol + ci });
                  ws[addr] = { t: "n", f: `SUM(${refs})`, z: "#,##0" };
                }
                const gtGtAddr = XLSX.utils.encode_cell({ r: grandTotalRowIdx, c: gtColIdx });
                ws[gtGtAddr] = { t: "n", f: `SUM(${fL}${grandTotalRowIdx + 1}:${lL}${grandTotalRowIdx + 1})`, z: "#,##0" };
                const totalRows = hdrOffset + dataRows.length;
                styleColumnHeaders(ws, hdrOffset, colCount);
                const FILL_ENTITY_TOTAL = { patternType: "solid", fgColor: { rgb: "E8E8E8" } };
                for (let r = hdrOffset + 1; r < totalRows; r++) {
                  const isGroupRow = groupRowIndices.includes(r);
                  const isEntityTotal = entityTotalIndices.includes(r);
                  const isGrandTotalRow = r === grandTotalRowIdx;
                  const srcRow = dataRows[r - hdrOffset];
                  for (let c = 0; c < colCount; c++) {
                    const isNum = c >= 4;
                    if (isGrandTotalRow) {
                      styleCell(ws, r, c, { font: c === 0 ? { ...FONT_GROUP, color: { rgb: "FFFFFF" } } : FONT_GROUP, fill: FILL_TOTAL_HDR, border: CELL_BORDER, alignment: { horizontal: c < 4 ? "left" : "right" }, numFmt: isNum ? "#,##0" : undefined });
                    } else if (isGroupRow) {
                      styleCell(ws, r, c, { font: FONT_GROUP, fill: FILL_GROUP, border: CELL_BORDER, alignment: { horizontal: c < 4 ? "left" : "right" }, numFmt: isNum ? "#,##0" : undefined });
                    } else if (isEntityTotal) {
                      styleCell(ws, r, c, { font: FONT_GROUP, fill: FILL_ENTITY_TOTAL, border: CELL_BORDER, alignment: { horizontal: c < 4 ? "left" : "right" }, numFmt: isNum ? "#,##0" : undefined });
                    } else if (isNum) {
                      const numVal = typeof srcRow?.[c] === "number" ? srcRow[c] : undefined;
                      styleCell(ws, r, c, { font: fontForValue(numVal), border: CELL_BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0" });
                    } else {
                      styleCell(ws, r, c, { font: FONT_DEFAULT, border: CELL_BORDER, alignment: { horizontal: "left" } });
                    }
                  }
                }
                ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: colCount - 1 } });
                ws["!cols"] = [{ wch: 14 }, { wch: 40 }, { wch: 14 }, { wch: 40 }, ...dynCols.map(() => ({ wch: 20 })), { wch: 18 }];
                const suffix = icTxnType.length ? `_${icTxnType.join("_")}` : "";
                downloadXlsx(ws, `RPT_Summary_Pivot${suffix}.xlsx`, "Summary Pivot");
              }}
            >
              <Download className="w-3 h-3 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!hasData ? (
          <p className="text-muted-foreground text-sm py-8 text-center">No pivot data available.</p>
        ) : (
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs" data-testid="table-rpt-summary-pivot">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Entity Group</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">Entity Books</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">RPT Group</th>
                <th className="px-3 py-2 text-left font-semibold whitespace-nowrap">RPT Full Name</th>
                {dynCols.map(col => (
                  <th key={col} className="px-3 py-2 text-right font-semibold whitespace-nowrap">{col}</th>
                ))}
                <th className="px-3 py-2 text-right font-semibold whitespace-nowrap">Grand Total</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((grp: any) => {
                const gKey = `g-${grp.entityGroup}`;
                return (
                  <Fragment key={gKey}>
                    <tr
                      className="bg-amber-700/90 dark:bg-amber-800/80 text-white font-bold cursor-pointer"
                      data-testid={`row-sp-group-${grp.entityGroup}`}
                      onClick={() => toggleCollapse(gKey)}
                    >
                      <td className="px-3 py-1.5 font-bold">
                        <span className="mr-1">{collapsed[gKey] ? "▸" : "▾"}</span>
                        {grp.entityGroup}
                      </td>
                      <td className="px-3 py-1.5"></td>
                      <td className="px-3 py-1.5"></td>
                      <td className="px-3 py-1.5"></td>
                      {dynCols.map(col => (
                        <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(grp.totals?.[col])}</td>
                      ))}
                      <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${grp.grandTotal < 0 ? "text-red-200" : ""}`}>{formatIndian(grp.grandTotal)}</td>
                    </tr>
                    {!collapsed[gKey] && grp.entities.map((ent: any, ei: number) => {
                      const eKey = `e-${grp.entityGroup}-${ei}`;
                      return (
                        <Fragment key={eKey}>
                          {ent.rptGroups.map((rg: any, ri: number) => {
                            const rgKey = `rg-${grp.entityGroup}-${ei}-${ri}`;
                            return (
                              <Fragment key={rgKey}>
                                {rg.counterParties.map((cp: any, ci: number) => (
                                  <tr key={`${rgKey}-${ci}`} className="border-b hover:bg-muted/30" data-testid={`row-sp-cp-${grp.entityGroup}-${ei}-${ri}-${ci}`}>
                                    <td className="px-3 py-1 pl-6"></td>
                                    <td className="px-3 py-1 whitespace-nowrap max-w-[250px] truncate" title={ent.entityBooks}>{ent.entityBooks}</td>
                                    <td className="px-3 py-1 whitespace-nowrap">{rg.rptGroup}</td>
                                    <td className="px-3 py-1 whitespace-nowrap max-w-[250px] truncate" title={cp.cpName}>{cp.cpName}</td>
                                    {dynCols.map(col => {
                                      const v = cp.balances?.[col] || 0;
                                      return (
                                        <td key={col} className={`px-3 py-1 text-right tabular-nums ${v !== 0 ? "text-foreground" : "text-muted-foreground"}`}>
                                          {formatIndian(v)}
                                        </td>
                                      );
                                    })}
                                    <td className={`px-3 py-1 text-right tabular-nums font-medium ${cellColor(cp.grandTotal)}`}>{formatIndian(cp.grandTotal)}</td>
                                  </tr>
                                ))}
                              </Fragment>
                            );
                          })}
                          <tr className="bg-muted/60 dark:bg-muted/30 font-semibold border-b" data-testid={`row-sp-entity-total-${grp.entityGroup}-${ei}`}>
                            <td className="px-3 py-1"></td>
                            <td className="px-3 py-1 font-semibold whitespace-nowrap max-w-[250px] truncate" title={ent.entityBooks + " Total"}>{ent.entityBooks} Total</td>
                            <td className="px-3 py-1"></td>
                            <td className="px-3 py-1"></td>
                            {dynCols.map(col => (
                              <td key={col} className={`px-3 py-1 text-right tabular-nums font-semibold ${cellColor(ent.totals?.[col] || 0)}`}>{formatIndian(ent.totals?.[col])}</td>
                            ))}
                            <td className={`px-3 py-1 text-right tabular-nums font-bold ${cellColor(ent.grandTotal)}`}>{formatIndian(ent.grandTotal)}</td>
                          </tr>
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
              <tr className="bg-slate-800 dark:bg-slate-700 text-white font-bold" data-testid="row-sp-grand-total">
                <td className="px-3 py-1.5 font-bold">Grand Total</td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
                <td className="px-3 py-1.5"></td>
                {dynCols.map(col => (
                  <td key={col} className="px-3 py-1.5 text-right tabular-nums font-bold">{formatIndian(overallTotals[col])}</td>
                ))}
                <td className={`px-3 py-1.5 text-right tabular-nums font-bold ${overallGrandTotal < 0 ? "text-red-200" : ""}`}>{formatIndian(overallGrandTotal)}</td>
              </tr>
            </tbody>
          </table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function DetailedReportTab({ period }: { period: string }) {
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const [entityFilter, setEntityFilter] = useState<string[]>([]);
  const { data, isLoading } = useQuery<{ data: any[]; total: number; icTxnTypes: string[]; entityNames: string[] }>({
    queryKey: ["/api/recon/rpt-report/detailed", icTxnType, icType, entityFilter],
    queryFn: async () => {
      const url = buildFilterUrl("/api/recon/rpt-report/detailed", { icTxnType, icType, entity: entityFilter });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const rows = data?.data || [];
  const icTxnTypes = data?.icTxnTypes || [];
  const entityNames = data?.entityNames || [];
  const hasData = rows.length > 0;

  const balDateLabel = period ? `Bal as on ${period}` : "Net Balance";

  return (
    <Card data-testid="card-rpt-detailed">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="text-sm">Detailed RPT Report</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Label className="text-xs whitespace-nowrap">Entity:</Label>
            <MultiSelectFilter
              options={entityNames.map(e => ({ value: e, label: e }))}
              selected={entityFilter}
              onChange={setEntityFilter}
              placeholder="All Entities"
              className="w-[220px]"
              data-testid="select-entity-detailed"
            />
            <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
            <MultiSelectFilter
              options={icTxnTypes.map(t => ({ value: t, label: t }))}
              selected={icTxnType}
              onChange={setIcTxnType}
              placeholder="All"
              className="w-[180px]"
              data-testid="select-ic-txn-type-detailed"
            />
            <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
            <MultiSelectFilter
              options={IC_TYPE_OPTIONS}
              selected={icType}
              onChange={setIcType}
              placeholder="All"
              className="w-[120px]"
              data-testid="select-ic-type-detailed"
            />
            <span className="text-xs text-muted-foreground">{(data?.total || rows.length).toLocaleString()} rows</span>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              data-testid="btn-download-detailed"
              onClick={() => {
                const ws: XLSX.WorkSheet = {};
                const header = [
                  "Entity Short", "Entity Books", "Entity Group",
                  "RPT Ledger", balDateLabel, "AE", "Adj Cl Bal",
                  "RPT Short", "RPT Group", "Nature of Balance", "RPT Full Name",
                ];
                const colCount = header.length;
                const filterParts: string[] = [];
                if (entityFilter.length) filterParts.push(`Entity: ${entityFilter.join(", ")}`);
                if (icTxnType.length) filterParts.push(`IC Txn Type: ${icTxnType.join(", ")}`);
                if (icType.length) filterParts.push(`RPT Type: ${icType.join(", ")}`);
                const filterLabel = filterParts.length ? filterParts.join(" | ") : undefined;
                const hdrOffset = addReportHeaders(ws, "Detailed Report", "RPT Detailed — IC/RPT transactions with adjustment entries", period, colCount, filterLabel);
                const dataRows: any[][] = [header];
                rows.forEach((r: any) => {
                  dataRows.push([
                    r.entityShort, r.entityName, r.entityGroup,
                    r.newCoaGlName, r.netBalance, r.aeAmount || 0, r.adjClBal,
                    r.cpShort, r.rptGroup || "", r.rptTxnType, r.cpName,
                  ]);
                });
                XLSX.utils.sheet_add_aoa(ws, dataRows, { origin: XLSX.utils.encode_cell({ r: hdrOffset, c: 0 }) });
                const totalRows = hdrOffset + dataRows.length;
                styleColumnHeaders(ws, hdrOffset, colCount);
                const numCols = [4, 5, 6];
                for (let r = hdrOffset + 1; r < totalRows; r++) {
                  const srcRow = dataRows[r - hdrOffset];
                  for (let c = 0; c < colCount; c++) {
                    if (numCols.includes(c)) {
                      const val = typeof srcRow?.[c] === "number" ? srcRow[c] : undefined;
                      styleCell(ws, r, c, { font: fontForValue(val, c === 6), border: CELL_BORDER, alignment: { horizontal: "right" }, numFmt: "#,##0" });
                    } else {
                      styleCell(ws, r, c, { font: FONT_DEFAULT, border: CELL_BORDER, alignment: { horizontal: "left" } });
                    }
                  }
                }
                ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows - 1, c: colCount - 1 } });
                ws["!cols"] = [
                  { wch: 16 }, { wch: 35 }, { wch: 10 },
                  { wch: 40 }, { wch: 18 }, { wch: 14 }, { wch: 18 },
                  { wch: 16 }, { wch: 10 }, { wch: 22 }, { wch: 40 },
                ];
                downloadXlsx(ws, "RPT_Detailed_Report.xlsx", "Detailed");
              }}
            >
              <Download className="w-3 h-3 mr-1" />
              Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="p-0">
        {!hasData ? (
          <p className="text-muted-foreground text-sm py-8 text-center">No IC/RPT transaction data available.</p>
        ) : (
        <div className="overflow-auto max-h-[70vh]">
          <table className="w-full text-xs" data-testid="table-rpt-detailed">
            <thead className="bg-muted/50 sticky top-0 z-10">
              <tr>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entity Short</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entity Books</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entity Group</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT Ledger</th>
                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">{balDateLabel}</th>
                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">AE</th>
                <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap bg-blue-50 dark:bg-blue-950">Adj Cl Bal</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT Short</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT Group</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Nature of Balance</th>
                <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT Full Name</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r: any, i: number) => (
                <tr key={i} className="border-b hover:bg-muted/30" data-testid={`row-detailed-${i}`}>
                  <td className="px-2 py-1 whitespace-nowrap">{r.entityShort}</td>
                  <td className="px-2 py-1 whitespace-nowrap max-w-[250px] truncate" title={r.entityName}>{r.entityName}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.entityGroup}</td>
                  <td className="px-2 py-1 whitespace-nowrap max-w-[280px] truncate" title={r.newCoaGlName}>{r.newCoaGlName}</td>
                  <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${cellColor(r.netBalance)}`}>{formatNum(r.netBalance)}</td>
                  <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${r.aeAmount ? cellColor(r.aeAmount) : "text-muted-foreground"}`}>{r.aeAmount ? formatNum(r.aeAmount) : "-"}</td>
                  <td className={`px-2 py-1 text-right tabular-nums font-semibold whitespace-nowrap bg-blue-50/50 dark:bg-blue-950/50 ${cellColor(r.adjClBal)}`}>{formatNum(r.adjClBal)}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.cpShort}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.rptGroup || "-"}</td>
                  <td className="px-2 py-1 whitespace-nowrap">{r.rptTxnType}</td>
                  <td className="px-2 py-1 whitespace-nowrap max-w-[250px] truncate" title={r.cpName}>{r.cpName}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}

function AdjustmentEntriesTab() {
  const { toast } = useToast();
  const [showDialog, setShowDialog] = useState(false);
  const [editEntry, setEditEntry] = useState<AeEntry | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadErrors, setUploadErrors] = useState<string[]>([]);
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const [rptTxnType, setRptTxnType] = useState<string[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [clearConfirmText, setClearConfirmText] = useState("");
  const [showBatchDeleteConfirm, setShowBatchDeleteConfirm] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState<number | null>(null);

  const { data: refData } = useQuery<{
    entityCodes: string[];
    entityNames: string[];
    icTxnTypes: string[];
    rptTxnTypes: string[];
    companies: { companyCode: string; companyName: string | null; companyNameErp: string }[];
  }>({ queryKey: ["/api/recon/rpt-audit-entries/ref-data"] });

  const refCompanies = refData?.companies || [];
  const refIcTxnTypes = refData?.icTxnTypes || [];
  const refRptTxnTypes = refData?.rptTxnTypes || [];
  const [form, setForm] = useState({
    entityCompanyCode: "",
    entityName: "",
    rptLedger: "",
    rptCounterPartyCode: "",
    rptCounterPartyName: "",
    amount: "",
    natureOfBalance: "Debit",
    narration: "",
    aeIcTxnType: "",
    aeRptTxnType: "",
    aeIcType: "",
  });

  const { data, isLoading } = useQuery<{ data: AeEntry[]; icTxnTypes: string[]; rptTxnTypes: string[] }>({
    queryKey: ["/api/recon/rpt-audit-entries", icTxnType, icType, rptTxnType],
    queryFn: async () => {
      const url = buildFilterUrl("/api/recon/rpt-audit-entries", { icTxnType, icType, rptTxnType });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
  });

  const downloadTemplate = async () => {
    try {
      const res = await fetch("/api/recon/rpt-audit-entries/template", { credentials: "include" });
      if (!res.ok) throw new Error("Failed to download template");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "AE_Upload_Template.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setUploading(true);
    setUploadErrors([]);
    try {
      const formData = new FormData();
      formData.append("file", file);
      const res = await fetch("/api/recon/rpt-audit-entries/upload", {
        method: "POST",
        body: formData,
        credentials: "include",
      });
      const json = await res.json();
      if (!res.ok) {
        if (json.errors) {
          setUploadErrors(json.errors);
          toast({ title: "Validation Errors", description: `${json.errors.length} error(s) found. Please fix and re-upload.`, variant: "destructive" });
        } else {
          toast({ title: "Upload Failed", description: json.message, variant: "destructive" });
        }
      } else {
        toast({ title: "Upload Successful", description: `${json.count} adjustment entries imported.` });
        queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-audit-entries"] });
        queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/status"] });
        queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/inter-group"] });
        queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/pivot-groupwise"] });
        queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/summary-pivot"] });
      }
    } catch (err: any) {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  const createMutation = useMutation({
    mutationFn: async (body: any) => {
      const res = await apiRequest("POST", "/api/recon/rpt-audit-entries", body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-audit-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/inter-group"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/pivot-groupwise"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/summary-pivot"] });
      setShowDialog(false);
      toast({ title: "Adjustment entry created" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: any }) => {
      const res = await apiRequest("PUT", `/api/recon/rpt-audit-entries/${id}`, body);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-audit-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/inter-group"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/pivot-groupwise"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/summary-pivot"] });
      setShowDialog(false);
      setEditEntry(null);
      toast({ title: "Adjustment entry updated" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/recon/rpt-audit-entries/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-audit-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/inter-group"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/pivot-groupwise"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/summary-pivot"] });
      toast({ title: "Entry deleted" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const clearMutation = useMutation({
    mutationFn: async () => {
      await apiRequest("DELETE", "/api/recon/rpt-audit-entries-clear");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-audit-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/inter-group"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/pivot-groupwise"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/summary-pivot"] });
      setSelectedIds(new Set());
      setShowClearConfirm(false);
      setClearConfirmText("");
      toast({ title: "All entries cleared" });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const batchDeleteMutation = useMutation({
    mutationFn: async (ids: number[]) => {
      await apiRequest("POST", "/api/recon/rpt-audit-entries-batch-delete", { ids });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-audit-entries"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/status"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/inter-group"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/pivot-groupwise"] });
      queryClient.invalidateQueries({ queryKey: ["/api/recon/rpt-report/summary-pivot"] });
      setSelectedIds(new Set());
      toast({ title: `${selectedIds.size} entries deleted` });
    },
    onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
  });

  const toggleSelect = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedIds.size === entries.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(entries.map(e => e.id)));
    }
  };

  const openNew = () => {
    setEditEntry(null);
    setForm({ entityCompanyCode: "", entityName: "", rptLedger: "", rptCounterPartyCode: "", rptCounterPartyName: "", amount: "", natureOfBalance: "Debit", narration: "", aeIcTxnType: "", aeRptTxnType: "", aeIcType: "" });
    setShowDialog(true);
  };

  const openEdit = (entry: AeEntry) => {
    setEditEntry(entry);
    setForm({
      entityCompanyCode: entry.entityCompanyCode,
      entityName: entry.entityName || "",
      rptLedger: entry.rptLedger,
      rptCounterPartyCode: entry.rptCounterPartyCode || "",
      rptCounterPartyName: entry.rptCounterPartyName || "",
      amount: String(entry.amount),
      natureOfBalance: entry.natureOfBalance || "Debit",
      narration: entry.narration || "",
      aeIcTxnType: entry.icTxnType || "",
      aeRptTxnType: entry.rptTxnType || "",
      aeIcType: entry.icType || "",
    });
    setShowDialog(true);
  };

  const handleSubmit = () => {
    const body = {
      entityCompanyCode: form.entityCompanyCode,
      entityName: form.entityName || null,
      rptLedger: form.rptLedger,
      rptCounterPartyCode: form.rptCounterPartyCode || null,
      rptCounterPartyName: form.rptCounterPartyName || null,
      amount: Number(form.amount),
      natureOfBalance: form.natureOfBalance || null,
      narration: form.narration || null,
      icTxnType: form.aeIcTxnType || null,
      rptTxnType: form.aeRptTxnType || null,
      icType: form.aeIcType || null,
    };
    if (editEntry) {
      updateMutation.mutate({ id: editEntry.id, body });
    } else {
      createMutation.mutate(body);
    }
  };

  if (isLoading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin" /></div>;

  const entries = data?.data || [];

  return (
    <>
      <Card data-testid="card-ae-entries">
        <CardHeader className="pb-2">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <CardTitle className="text-sm">Adjustment Entries</CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
              <MultiSelectFilter
                options={(data?.icTxnTypes || []).map(t => ({ value: t, label: t }))}
                selected={icTxnType}
                onChange={setIcTxnType}
                placeholder="All Types"
                className="w-[180px]"
                data-testid="select-ae-ic-txn-type"
              />
              <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
              <MultiSelectFilter
                options={IC_TYPE_OPTIONS}
                selected={icType}
                onChange={setIcType}
                placeholder="All"
                className="w-[120px]"
                data-testid="select-ae-ic-type"
              />
              <Label className="text-xs whitespace-nowrap">RPT Txn Type:</Label>
              <MultiSelectFilter
                options={(data?.rptTxnTypes || []).map(t => ({ value: t, label: t }))}
                selected={rptTxnType}
                onChange={setRptTxnType}
                placeholder="All Types"
                className="w-[180px]"
                data-testid="select-ae-rpt-txn-type"
              />
              <Button size="sm" variant="outline" onClick={downloadTemplate} data-testid="button-download-ae-template">
                <FileDown className="w-4 h-4 mr-1" />
                Download Template
              </Button>
              <label>
                <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleFileUpload} disabled={uploading} data-testid="input-upload-ae" />
                <Button size="sm" variant="outline" asChild disabled={uploading}>
                  <span>
                    {uploading ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Upload className="w-4 h-4 mr-1" />}
                    Upload
                  </span>
                </Button>
              </label>
              <Button size="sm" onClick={openNew} data-testid="button-add-ae">
                <Plus className="w-4 h-4 mr-1" />
                Add Entry
              </Button>
              {selectedIds.size > 0 && (
                <Button size="sm" variant="destructive" onClick={() => setShowBatchDeleteConfirm(true)} disabled={batchDeleteMutation.isPending} data-testid="button-delete-selected-ae">
                  <Trash2 className="w-4 h-4 mr-1" />
                  Delete Selected ({selectedIds.size})
                </Button>
              )}
              {entries.length > 0 && (
                <Button size="sm" variant="destructive" onClick={() => { setShowClearConfirm(true); setClearConfirmText(""); }} disabled={clearMutation.isPending} data-testid="button-clear-ae">
                  <Trash2 className="w-4 h-4 mr-1" />
                  Clear All
                </Button>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {uploadErrors.length > 0 && (
            <div className="mx-4 mt-2 mb-2 p-3 bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded text-xs" data-testid="upload-errors">
              <div className="flex items-center justify-between mb-1">
                <span className="font-semibold text-red-700 dark:text-red-300">Upload Validation Errors</span>
                <Button size="sm" variant="ghost" className="h-5 w-5 p-0" onClick={() => setUploadErrors([])}><X className="w-3 h-3" /></Button>
              </div>
              <ul className="list-disc pl-4 space-y-0.5 text-red-600 dark:text-red-400 max-h-40 overflow-auto">
                {uploadErrors.map((err, i) => <li key={i}>{err}</li>)}
              </ul>
            </div>
          )}
          {entries.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No adjustment entries. Click "Add Entry" or upload a template to add entries.</p>
          ) : (
            <div className="overflow-auto max-h-[70vh]">
              <table className="w-full text-xs" data-testid="table-ae-entries">
                <thead className="bg-muted/50 sticky top-0 z-10">
                  <tr>
                    <th className="px-2 py-1.5 text-center w-8">
                      <input type="checkbox" checked={entries.length > 0 && selectedIds.size === entries.length} onChange={toggleSelectAll} className="rounded" data-testid="checkbox-ae-select-all" />
                    </th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entity Code</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entity Name</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT Ledger</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT CP Code</th>
                    <th className="px-2 py-1.5 text-right font-medium whitespace-nowrap">Amount</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Nature of Balance</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Narration</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">IC Txn Type</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">RPT Txn Type</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">IC/RPT Type</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entered By</th>
                    <th className="px-2 py-1.5 text-left font-medium whitespace-nowrap">Entered Date</th>
                    <th className="px-2 py-1.5 text-center font-medium whitespace-nowrap">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id} className={`border-b hover:bg-muted/30 ${selectedIds.has(e.id) ? "bg-blue-50 dark:bg-blue-950" : ""}`} data-testid={`row-ae-${e.id}`}>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={selectedIds.has(e.id)} onChange={() => toggleSelect(e.id)} className="rounded" data-testid={`checkbox-ae-${e.id}`} />
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.entityCompanyCode}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.entityName}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.rptLedger}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.rptCounterPartyCode}</td>
                      <td className={`px-2 py-1 text-right tabular-nums whitespace-nowrap ${cellColor(e.amount)}`}>{formatNum(e.amount)}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.natureOfBalance}</td>
                      <td className="px-2 py-1 max-w-[200px] truncate">{e.narration}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.icTxnType || "-"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.rptTxnType || "-"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.icType || "-"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.createdBy || "-"}</td>
                      <td className="px-2 py-1 whitespace-nowrap">{e.createdAt ? new Date(e.createdAt).toLocaleDateString("en-IN") : "-"}</td>
                      <td className="px-2 py-1 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => openEdit(e)} data-testid={`button-edit-ae-${e.id}`}>
                            <Pencil className="w-3 h-3" />
                          </Button>
                          <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500" onClick={() => setShowDeleteConfirm(e.id)} data-testid={`button-delete-ae-${e.id}`}>
                            <Trash2 className="w-3 h-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent data-testid="dialog-ae-form">
          <DialogHeader>
            <DialogTitle>{editEntry ? "Edit Adjustment Entry" : "Add Adjustment Entry"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Entity Company Code *</Label>
                <Select value={form.entityCompanyCode || "_none"} onValueChange={v => {
                  const code = v === "_none" ? "" : v;
                  const comp = refCompanies.find(c => c.companyCode === code);
                  setForm(f => ({ ...f, entityCompanyCode: code, entityName: comp?.companyNameErp || "" }));
                }}>
                  <SelectTrigger className="h-8 text-xs" data-testid="input-ae-entity-code">
                    <SelectValue placeholder="Select entity code" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">-- Select --</SelectItem>
                    {refCompanies.map(c => (
                      <SelectItem key={c.companyCode} value={c.companyCode}>{c.companyCode}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Entity Name *</Label>
                <Select value={form.entityName || "_none"} onValueChange={v => {
                  const name = v === "_none" ? "" : v;
                  const comp = refCompanies.find(c => c.companyNameErp === name);
                  setForm(f => ({ ...f, entityName: name, entityCompanyCode: comp?.companyCode || "" }));
                }}>
                  <SelectTrigger className="h-8 text-xs" data-testid="input-ae-entity-name">
                    <SelectValue placeholder="Select entity name" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">-- Select --</SelectItem>
                    {refCompanies.map(c => (
                      <SelectItem key={c.companyNameErp} value={c.companyNameErp}>{c.companyNameErp}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">RPT Ledger *</Label>
              <Input value={form.rptLedger} onChange={e => setForm(f => ({ ...f, rptLedger: e.target.value }))} className="h-8 text-xs" data-testid="input-ae-rpt-ledger" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">RPT Counter Party Code</Label>
                <Input value={form.rptCounterPartyCode} onChange={e => setForm(f => ({ ...f, rptCounterPartyCode: e.target.value }))} className="h-8 text-xs" data-testid="input-ae-rpt-cp-code" />
              </div>
              <div>
                <Label className="text-xs">RPT Counter Party Name</Label>
                <Input value={form.rptCounterPartyName} onChange={e => setForm(f => ({ ...f, rptCounterPartyName: e.target.value }))} className="h-8 text-xs" data-testid="input-ae-rpt-cp-name" />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Amount *</Label>
                <Input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} className="h-8 text-xs" data-testid="input-ae-amount" />
              </div>
              <div>
                <Label className="text-xs">Nature of Balance</Label>
                <Select value={form.natureOfBalance} onValueChange={v => setForm(f => ({ ...f, natureOfBalance: v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-ae-nature">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Debit">Debit</SelectItem>
                    <SelectItem value="Credit">Credit</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label className="text-xs">Narration</Label>
              <Input value={form.narration} onChange={e => setForm(f => ({ ...f, narration: e.target.value }))} className="h-8 text-xs" data-testid="input-ae-narration" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <Label className="text-xs">IC Txn Type</Label>
                <Select value={form.aeIcTxnType || "_none"} onValueChange={v => setForm(f => ({ ...f, aeIcTxnType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="input-ae-ic-txn-type">
                    <SelectValue placeholder="Select IC Txn Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">-- Select --</SelectItem>
                    {refIcTxnTypes.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">RPT Type</Label>
                <Select value={form.aeIcType || "_none"} onValueChange={v => setForm(f => ({ ...f, aeIcType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="select-ae-form-ic-type">
                    <SelectValue placeholder="Auto" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">Auto (from ledger)</SelectItem>
                    <SelectItem value="IC">IC</SelectItem>
                    <SelectItem value="RPT">RPT</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">RPT Txn Type</Label>
                <Select value={form.aeRptTxnType || "_none"} onValueChange={v => setForm(f => ({ ...f, aeRptTxnType: v === "_none" ? "" : v }))}>
                  <SelectTrigger className="h-8 text-xs" data-testid="input-ae-rpt-txn-type">
                    <SelectValue placeholder="Select RPT Txn Type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none">-- Select --</SelectItem>
                    {refRptTxnTypes.map(t => (
                      <SelectItem key={t} value={t}>{t}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDialog(false)} data-testid="button-ae-cancel">Cancel</Button>
            <Button
              size="sm"
              onClick={handleSubmit}
              disabled={!form.entityCompanyCode || !form.rptLedger || !form.amount || createMutation.isPending || updateMutation.isPending}
              data-testid="button-ae-save"
            >
              <Save className="w-4 h-4 mr-1" />
              {editEntry ? "Update" : "Create"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showClearConfirm} onOpenChange={(open) => { setShowClearConfirm(open); if (!open) setClearConfirmText(""); }}>
        <DialogContent data-testid="dialog-clear-confirm">
          <DialogHeader>
            <DialogTitle>Confirm Clear All Entries</DialogTitle>
          </DialogHeader>
          <div className="py-2 space-y-3">
            <p className="text-sm text-muted-foreground">
              This will permanently delete <span className="font-bold text-foreground">{entries.length}</span> adjustment {entries.length === 1 ? "entry" : "entries"}. This action cannot be undone.
            </p>
            <div>
              <Label className="text-xs font-medium">Type <span className="font-bold text-red-600">DELETE</span> to confirm:</Label>
              <Input
                value={clearConfirmText}
                onChange={e => setClearConfirmText(e.target.value)}
                placeholder="Type DELETE"
                className="h-8 text-xs mt-1"
                autoFocus
                data-testid="input-clear-confirm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowClearConfirm(false)} data-testid="button-clear-cancel">Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => clearMutation.mutate()}
              disabled={clearConfirmText !== "DELETE" || clearMutation.isPending}
              data-testid="button-clear-confirm"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              {clearMutation.isPending ? "Clearing..." : "Clear All Entries"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showBatchDeleteConfirm} onOpenChange={setShowBatchDeleteConfirm}>
        <DialogContent data-testid="dialog-batch-delete-confirm">
          <DialogHeader>
            <DialogTitle>Confirm Delete Selected</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete <span className="font-bold text-foreground">{selectedIds.size}</span> selected {selectedIds.size === 1 ? "entry" : "entries"}? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowBatchDeleteConfirm(false)} data-testid="button-batch-delete-cancel">Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => { batchDeleteMutation.mutate(Array.from(selectedIds)); setShowBatchDeleteConfirm(false); }}
              disabled={batchDeleteMutation.isPending}
              data-testid="button-batch-delete-confirm"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete {selectedIds.size} {selectedIds.size === 1 ? "Entry" : "Entries"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDeleteConfirm !== null} onOpenChange={(open) => { if (!open) setShowDeleteConfirm(null); }}>
        <DialogContent data-testid="dialog-delete-single-confirm">
          <DialogHeader>
            <DialogTitle>Confirm Delete Entry</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-2">
            Are you sure you want to delete this adjustment entry? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowDeleteConfirm(null)} data-testid="button-delete-single-cancel">Cancel</Button>
            <Button
              size="sm"
              variant="destructive"
              onClick={() => { if (showDeleteConfirm !== null) { deleteMutation.mutate(showDeleteConfirm); setShowDeleteConfirm(null); } }}
              disabled={deleteMutation.isPending}
              data-testid="button-delete-single-confirm"
            >
              <Trash2 className="w-4 h-4 mr-1" />
              Delete Entry
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

interface EntityWorkingRow {
  entityName: string;
  accountHead: string;
  subAccountHead: string;
  rptLedgerName: string;
  counterPartyShort: string;
  counterPartyFull: string;
  currentNonCurrent: string;
  fsGroup: string;
  fsHeading: string;
  netOpb: number;
  movements: Record<string, number>;
  clbNet: number;
  clbTb: number;
  diff: number;
}

interface MovementCol {
  key: string;
  label: string;
  group: string;
}

interface EntityOption {
  code: string;
  name: string;
  shortName: string;
  group: string;
}

function EntityWorkingTab({ period }: { period: string }) {
  const [selectedEntities, setSelectedEntities] = useState<string[]>([]);
  const [search, setSearch] = useState("");
  const [icTxnType, setIcTxnType] = useState<string[]>([]);
  const [icType, setIcType] = useState<string[]>(["IC"]);
  const [rptTxnType, setRptTxnType] = useState<string[]>([]);

  const { data: entitiesData, isLoading: loadingEntities } = useQuery<{ entities: EntityOption[] }>({
    queryKey: ["/api/recon/rpt-report/entities"],
  });

  const entities = entitiesData?.entities || [];
  const initializedRef = useRef(false);

  useEffect(() => {
    if (!initializedRef.current && entities.length > 0) {
      initializedRef.current = true;
      setSelectedEntities(entities.map(e => e.code));
    }
  }, [entities]);

  const entityParam = selectedEntities.join(",");

  const { data: reportData, isLoading: loadingReport } = useQuery<{
    entity: EntityOption;
    period: string;
    movementColumns: MovementCol[];
    rows: EntityWorkingRow[];
    totals: { netOpb: number; movements: Record<string, number>; clbNet: number; clbTb: number; diff: number };
    icTxnTypes: string[];
    rptTxnTypes: string[];
  }>({
    queryKey: ["/api/recon/rpt-report/entity-working", entityParam, icTxnType, icType, rptTxnType],
    queryFn: async () => {
      const url = buildFilterUrl(`/api/recon/rpt-report/entity-working`, {
        entityCode: entityParam,
        icTxnType,
        icType,
        rptTxnType,
      });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch");
      return res.json();
    },
    enabled: selectedEntities.length > 0,
  });

  const movCols = reportData?.movementColumns || [];
  const rows = reportData?.rows || [];
  const totals = reportData?.totals;

  const filteredRows = useMemo(() => {
    if (!search.trim()) return rows;
    const s = search.toLowerCase();
    return rows.filter(r =>
      (r.entityName || "").toLowerCase().includes(s) ||
      r.accountHead.toLowerCase().includes(s) ||
      (r.subAccountHead || "").toLowerCase().includes(s) ||
      (r.rptLedgerName || "").toLowerCase().includes(s) ||
      r.counterPartyShort.toLowerCase().includes(s) ||
      r.counterPartyFull.toLowerCase().includes(s) ||
      r.currentNonCurrent.toLowerCase().includes(s) ||
      r.fsGroup.toLowerCase().includes(s) ||
      r.fsHeading.toLowerCase().includes(s)
    );
  }, [rows, search]);


  function handleDownload() {
    if (!reportData || rows.length === 0) return;
    const wb = XLSX.utils.book_new();
    const headerRow = [
      "Entity Name",
      "Account Head", "Sub Account Head", "RPT Ledger Name", "Counter Party",
      "C/NC", "FS Group", "FS Heading",
      "Net OPB",
      ...movCols.map(c => c.label),
      "CLB Net", "CLB-TB", "Diff",
    ];
    const dataRows = rows.map(r => [
      r.entityName || "",
      r.accountHead || "",
      r.subAccountHead || "",
      r.rptLedgerName || "",
      r.counterPartyShort,
      r.currentNonCurrent,
      r.fsGroup,
      r.fsHeading,
      r.netOpb || 0,
      ...movCols.map(c => r.movements[c.key] || 0),
      r.clbNet || 0,
      r.clbTb || 0,
      r.diff || 0,
    ]);

    const totalRow = [
      "", "", "", "", "", "", "", "Total",
      totals?.netOpb || 0,
      ...movCols.map(c => totals?.movements[c.key] || 0),
      totals?.clbNet || 0,
      totals?.clbTb || 0,
      totals?.diff || 0,
    ];

    const allRows = [
      [`Entity RPT Report: ${reportData.entity.name} (${reportData.entity.code})`],
      [`Period: ${reportData.period || period}`],
      [],
      headerRow,
      ...dataRows,
      totalRow,
    ];
    const ws = XLSX.utils.aoa_to_sheet(allRows);

    const headerRowIdx = 3;
    for (let c = 0; c < headerRow.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: headerRowIdx, c });
      if (ws[cellRef]) {
        ws[cellRef].s = { font: FONT_HEADER, fill: FILL_HEADER, border: CELL_BORDER, alignment: { horizontal: "center" } };
      }
    }

    ws[XLSX.utils.encode_cell({ r: 0, c: 0 })].s = { font: FONT_TITLE };
    ws[XLSX.utils.encode_cell({ r: 1, c: 0 })].s = { font: FONT_META };

    const numStart = 6;
    for (let ri = 0; ri < dataRows.length; ri++) {
      for (let ci = numStart; ci < headerRow.length; ci++) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRowIdx + 1 + ri, c: ci });
        if (ws[cellRef]) {
          const val = dataRows[ri][ci] as number;
          ws[cellRef].s = { font: fontForValue(val), border: CELL_BORDER, numFmt: "#,##0" };
        }
      }
    }

    const totalRowIdx = headerRowIdx + 1 + dataRows.length;
    for (let c = 0; c < headerRow.length; c++) {
      const cellRef = XLSX.utils.encode_cell({ r: totalRowIdx, c });
      if (ws[cellRef]) {
        const val = typeof totalRow[c] === "number" ? totalRow[c] as number : 0;
        ws[cellRef].s = { font: fontForValue(val, true), fill: FILL_TOTAL_COL, border: CELL_BORDER, numFmt: "#,##0" };
      }
    }

    ws["!cols"] = [
      { wch: 30 },
      { wch: 40 }, { wch: 15 },
      { wch: 18 }, { wch: 22 }, { wch: 30 },
      { wch: 15 },
      ...movCols.map(() => ({ wch: 15 })),
      { wch: 15 }, { wch: 15 }, { wch: 15 },
    ];

    XLSX.utils.book_append_sheet(wb, ws, "Entity RPT Report");
    const entityShort = reportData.entity.shortName || reportData.entity.code;
    XLSX.writeFile(wb, `Entity_RPT_Report_${entityShort}.xlsx`);
  }

  return (
    <Card data-testid="card-entity-working">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <CardTitle className="text-lg">Entity RPT Report</CardTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <MultiSelectFilter
              options={entities.map(e => ({ value: e.code, label: `${e.name} (${e.code})` }))}
              selected={selectedEntities}
              onChange={setSelectedEntities}
              placeholder="Select Entities..."
              className="w-[320px]"
              data-testid="select-entity"
            />
            <Label className="text-xs whitespace-nowrap">IC Txn Type:</Label>
            <MultiSelectFilter
              options={(reportData?.icTxnTypes || []).map(t => ({ value: t, label: t }))}
              selected={icTxnType}
              onChange={setIcTxnType}
              placeholder="All Types"
              className="w-[180px]"
              data-testid="select-entity-ic-txn-type"
            />
            <Label className="text-xs whitespace-nowrap">RPT Type:</Label>
            <MultiSelectFilter
              options={IC_TYPE_OPTIONS}
              selected={icType}
              onChange={setIcType}
              placeholder="All"
              className="w-[120px]"
              data-testid="select-entity-ic-type"
            />
            <Label className="text-xs whitespace-nowrap">RPT Txn Type:</Label>
            <MultiSelectFilter
              options={(reportData?.rptTxnTypes || []).map(t => ({ value: t, label: t }))}
              selected={rptTxnType}
              onChange={setRptTxnType}
              placeholder="All Types"
              className="w-[180px]"
              data-testid="select-entity-rpt-txn-type"
            />
            <Input
              placeholder="Search..."
              className="w-48"
              value={search}
              onChange={e => setSearch(e.target.value)}
              data-testid="input-entity-search"
            />
            <Button size="sm" variant="outline" onClick={handleDownload} disabled={rows.length === 0} data-testid="btn-entity-download">
              <Download className="w-4 h-4 mr-1" /> Download
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {loadingEntities && (
          <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin h-6 w-6" /></div>
        )}
        {selectedEntities.length === 0 && !loadingEntities && (
          <p className="text-muted-foreground text-center py-8" data-testid="text-entity-prompt">Select one or more entities to view the working report</p>
        )}
        {selectedEntities.length > 0 && loadingReport && (
          <div className="flex items-center justify-center py-8"><Loader2 className="animate-spin h-6 w-6" /></div>
        )}
        {selectedEntities.length > 0 && !loadingReport && rows.length === 0 && (
          <p className="text-muted-foreground text-center py-8" data-testid="text-no-data">No data found for the selected entities</p>
        )}
        {selectedEntities.length > 0 && !loadingReport && rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-xs border-collapse" data-testid="table-entity-working">
              <thead>
                <tr className="bg-slate-800 text-white">
                  <th className="px-2 py-1.5 text-left border border-slate-600 sticky left-0 bg-slate-800 z-10">Entity Name</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">Account Head</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">Sub Account Head</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">RPT Ledger Name</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">Counter Party</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">C/NC</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">FS Group</th>
                  <th className="px-2 py-1.5 text-left border border-slate-600">FS Heading</th>
                  <th className="px-2 py-1.5 text-right border border-slate-600 bg-emerald-900">Net OPB</th>
                  {movCols.map(c => (
                    <th key={c.key} className="px-2 py-1.5 text-right border border-slate-600">{c.label}</th>
                  ))}
                  <th className="px-2 py-1.5 text-right border border-slate-600 bg-blue-900">CLB Net</th>
                  <th className="px-2 py-1.5 text-right border border-slate-600 bg-indigo-900">CLB-TB</th>
                  <th className="px-2 py-1.5 text-right border border-slate-600 bg-amber-900">Diff</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map((row, ri) => (
                  <tr key={ri} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700 sticky left-0 bg-white dark:bg-slate-900 z-10 max-w-[200px] truncate" title={row.entityName || ""}>{row.entityName || ""}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700 max-w-[200px] truncate" title={row.accountHead}>{row.accountHead}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700 max-w-[200px] truncate" title={row.subAccountHead || ""}>{row.subAccountHead || ""}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700 max-w-[200px] truncate" title={row.rptLedgerName || ""}>{row.rptLedgerName || ""}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700" title={row.counterPartyFull}>{row.counterPartyShort}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700">{row.currentNonCurrent}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700">{row.fsGroup}</td>
                    <td className="px-2 py-1 border border-slate-200 dark:border-slate-700">{row.fsHeading}</td>
                    <td className={`px-2 py-1 text-right border border-slate-200 dark:border-slate-700 bg-emerald-50 dark:bg-emerald-900/20 ${cellColor(row.netOpb)}`}>{formatIndian(row.netOpb)}</td>
                    {movCols.map(c => {
                      const val = row.movements[c.key] || 0;
                      return (
                        <td key={c.key} className={`px-2 py-1 text-right border border-slate-200 dark:border-slate-700 ${cellColor(val)}`}>{formatIndian(val)}</td>
                      );
                    })}
                    <td className={`px-2 py-1 text-right border border-slate-200 dark:border-slate-700 font-semibold bg-blue-50 dark:bg-blue-900/20 ${cellColor(row.clbNet)}`}>{formatIndian(row.clbNet)}</td>
                    <td className={`px-2 py-1 text-right border border-slate-200 dark:border-slate-700 bg-indigo-50 dark:bg-indigo-900/20 ${cellColor(row.clbTb)}`}>{formatIndian(row.clbTb)}</td>
                    <td className={`px-2 py-1 text-right border border-slate-200 dark:border-slate-700 font-semibold ${row.diff !== 0 ? 'bg-red-50 dark:bg-red-900/20 text-red-600 dark:text-red-400' : ''} ${cellColor(row.diff)}`}>{formatIndian(row.diff)}</td>
                  </tr>
                ))}
                {totals && (
                  <tr className="bg-blue-50 dark:bg-blue-900/30 font-bold">
                    <td colSpan={8} className="px-2 py-1.5 text-right border border-slate-300 dark:border-slate-600">Total</td>
                    <td className={`px-2 py-1.5 text-right border border-slate-300 dark:border-slate-600 bg-emerald-100 dark:bg-emerald-900/40 ${cellColor(totals.netOpb)}`}>{formatIndian(totals.netOpb)}</td>
                    {movCols.map(c => {
                      const val = totals.movements[c.key] || 0;
                      return (
                        <td key={c.key} className={`px-2 py-1.5 text-right border border-slate-300 dark:border-slate-600 ${cellColor(val)}`}>{formatIndian(val)}</td>
                      );
                    })}
                    <td className={`px-2 py-1.5 text-right border border-slate-300 dark:border-slate-600 bg-blue-100 dark:bg-blue-900/40 ${cellColor(totals.clbNet)}`}>{formatIndian(totals.clbNet)}</td>
                    <td className={`px-2 py-1.5 text-right border border-slate-300 dark:border-slate-600 bg-indigo-100 dark:bg-indigo-900/40 ${cellColor(totals.clbTb)}`}>{formatIndian(totals.clbTb)}</td>
                    <td className={`px-2 py-1.5 text-right border border-slate-300 dark:border-slate-600 ${totals.diff !== 0 ? 'bg-red-100 dark:bg-red-900/40 text-red-600' : ''} ${cellColor(totals.diff)}`}>{formatIndian(totals.diff)}</td>
                  </tr>
                )}
              </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2" data-testid="text-row-count">{filteredRows.length} of {rows.length} rows</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RptReportsPage() {
  const [activeTab, setActiveTab] = useState("status");
  const { data: summaryData } = useQuery<{ period?: string }>({
    queryKey: ["/api/ic-matrix/summary"],
  });
  const rawPeriod = summaryData?.period || "";
  const period = useMemo(() => {
    if (!rawPeriod) return "";
    const toMatch = rawPeriod.match(/To\s+(.+)$/i);
    if (toMatch) return `As on ${toMatch[1].trim()}`;
    return rawPeriod;
  }, [rawPeriod]);

  return (
    <div className="p-6 space-y-4" data-testid="page-rpt-reports">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight" data-testid="text-page-title">
            RPT Reports
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Related Party Transaction reports with adjustment entries
          </p>
        </div>
        {period && (
          <div className="text-right" data-testid="text-report-period">
            <span className="text-xs text-muted-foreground">Reporting Date</span>
            <p className="text-sm font-semibold">{period}</p>
          </div>
        )}
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList data-testid="tabs-rpt-reports">
          <TabsTrigger value="status" data-testid="tab-rpt-status">Status</TabsTrigger>
          <TabsTrigger value="inter-group" data-testid="tab-rpt-intergroup">Inter Group</TabsTrigger>
          <TabsTrigger value="pivot-groupwise" data-testid="tab-rpt-pivot-group">Pivot Groupwise</TabsTrigger>
          <TabsTrigger value="summary-pivot" data-testid="tab-rpt-summary-pivot">Summary Pivot</TabsTrigger>
          <TabsTrigger value="detailed" data-testid="tab-rpt-detailed">Detailed Report</TabsTrigger>
          <TabsTrigger value="audit-entries" data-testid="tab-rpt-ae">Adjustment Entries</TabsTrigger>
          <TabsTrigger value="entity-working" data-testid="tab-rpt-entity-working">Entity RPT Report</TabsTrigger>
        </TabsList>

        <TabsContent value="status"><StatusTab period={period} /></TabsContent>
        <TabsContent value="inter-group"><InterGroupTab period={period} /></TabsContent>
        <TabsContent value="pivot-groupwise"><PivotGroupwiseTab period={period} /></TabsContent>
        <TabsContent value="summary-pivot"><SummaryPivotTab period={period} /></TabsContent>
        <TabsContent value="detailed"><DetailedReportTab period={period} /></TabsContent>
        <TabsContent value="audit-entries"><AdjustmentEntriesTab /></TabsContent>
        <TabsContent value="entity-working"><EntityWorkingTab period={period} /></TabsContent>
      </Tabs>
    </div>
  );
}