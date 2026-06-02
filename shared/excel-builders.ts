import * as XLSX from "xlsx";

export interface BuiltSheet {
  name: string;
  ws: XLSX.WorkSheet;
}

// ----------------------------------------------------------------------------
// IC Recon — full export (`/api/export/excel`)
// ----------------------------------------------------------------------------
export interface IcReconExportLine {
  company: string;
  counterParty: string;
  documentNo?: string | null;
  docDate?: string | null;
  netAmount?: number | null;
  transactionCount?: number | null;
  icGl?: string | null;
  narration?: string | null;
  reconStatus: string | null;
  reconId?: string | null;
  reconRule?: string | null;
}

export function buildIcReconExportSheet(lines: IcReconExportLine[]): BuiltSheet {
  const rows = lines.map(l => ({
    "Company": l.company,
    "Counter Party": l.counterParty,
    "Document No": l.documentNo || "",
    "Doc Date": l.docDate || "",
    "Net Amount": l.netAmount || 0,
    "Txn Count": l.transactionCount || 1,
    "IC GL": l.icGl || "",
    "Narration": l.narration || "",
    "Status": l.reconStatus || "",
    "Recon ID": l.reconId || "",
    "Rule": l.reconRule || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 25 }, { wch: 25 }, { wch: 18 }, { wch: 12 },
    { wch: 16 }, { wch: 8 }, { wch: 20 }, { wch: 40 },
    { wch: 12 }, { wch: 12 }, { wch: 20 },
  ];
  return { name: "Reconciliation", ws };
}

// ----------------------------------------------------------------------------
// IC Recon — reconciliation template (`/api/export/reconciliation-template`)
// ----------------------------------------------------------------------------
export interface IcReconTemplateLine {
  id: number;
  company: string;
  counterParty: string;
  documentNo?: string | null;
  docDate?: string | null;
  netAmount?: number | null;
  narration?: string | null;
  reconStatus: string | null;
  reconId?: string | null;
}

export function buildIcReconTemplateSheet(lines: IcReconTemplateLine[]): BuiltSheet {
  const rows = lines.map(l => ({
    "Line ID": l.id,
    "Company": l.company,
    "Counter Party": l.counterParty,
    "Document No": l.documentNo || "",
    "Doc Date": l.docDate || "",
    "Net Amount": l.netAmount || 0,
    "Narration": l.narration || "",
    "Status": l.reconStatus || "",
    "Current Rec ID": l.reconId || "",
    "User Rec ID": "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 8 }, { wch: 25 }, { wch: 25 }, { wch: 18 }, { wch: 12 },
    { wch: 16 }, { wch: 40 }, { wch: 14 }, { wch: 14 }, { wch: 16 },
  ];
  return { name: "Reconciliation Template", ws };
}

// ----------------------------------------------------------------------------
// IC Recon — Entity / Counter-Party summary (reports.tsx)
// ----------------------------------------------------------------------------
export interface EntityCpRow {
  entity: string;
  counterParty: string;
  total: number;
  matched: number;
  reversal?: number;
  review: number;
  suggested: number;
  unmatched: number;
  rate: number;
}

export interface EntityCpTotals {
  total: number;
  matched: number;
  reversal: number;
  review: number;
  suggested: number;
  unmatched: number;
}

export function buildEntityCpSummarySheet(
  rowsIn: EntityCpRow[],
  totals: EntityCpTotals,
  overallRate: number,
  displayName: (s: string) => string = (s) => s,
): BuiltSheet {
  const exportRows = rowsIn.map(r => ({
    "Entity": displayName(r.entity),
    "Counter Party": displayName(r.counterParty),
    "Total": r.total,
    "Matched": r.matched,
    "Reversals": r.reversal || 0,
    "Review": r.review,
    "Suggested": r.suggested,
    "Unmatched": r.unmatched,
    "Rate (%)": r.rate,
  }));
  exportRows.push({
    "Entity": "TOTAL",
    "Counter Party": "",
    "Total": totals.total,
    "Matched": totals.matched,
    "Reversals": totals.reversal,
    "Review": totals.review,
    "Suggested": totals.suggested,
    "Unmatched": totals.unmatched,
    "Rate (%)": overallRate,
  });
  const ws = XLSX.utils.json_to_sheet(exportRows);
  ws["!cols"] = [
    { wch: 30 }, { wch: 30 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 10 },
  ];
  return { name: "Entity CP Summary", ws };
}

// ----------------------------------------------------------------------------
// IC Matrix — IC Data export (`/api/ic-matrix/download-ic-data`)
// ----------------------------------------------------------------------------
export interface IcDataRow {
  company?: string | null;
  companyCode?: string | null;
  accountHead?: string | null;
  subAccountHead?: string | null;
  closingDebit?: number | null;
  closingCredit?: number | null;
  netBalance?: number | null;
  newCoaGlName?: string | null;
  icCounterParty?: string | null;
  icCounterPartyCode?: string | null;
  icTxnType?: string | null;
  rptTxnType?: string | null;
  tbSource?: string | null;
}

export function buildIcDataSheet(data: IcDataRow[]): BuiltSheet {
  const rows = data.map(r => ({
    "Company": r.company || "",
    "Company Code": r.companyCode || "",
    "Account Head": r.accountHead || "",
    "Sub Account Head": r.subAccountHead || "",
    "Closing Debit": r.closingDebit || 0,
    "Closing Credit": r.closingCredit || 0,
    "Net Balance": r.netBalance || 0,
    "New COA GL Name": r.newCoaGlName || "",
    "IC Counter Party": r.icCounterParty || "",
    "IC CP Code": r.icCounterPartyCode || "",
    "IC Txn Type": r.icTxnType || "",
    "RPT Txn Type": r.rptTxnType || "",
    "TB Source": r.tbSource || "",
  }));
  const ws = XLSX.utils.json_to_sheet(rows);
  ws["!cols"] = [
    { wch: 30 }, { wch: 15 }, { wch: 25 }, { wch: 25 },
    { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 25 },
    { wch: 25 }, { wch: 15 }, { wch: 15 }, { wch: 25 },
  ];
  return { name: "IC Data", ws };
}

// ----------------------------------------------------------------------------
// IC Matrix — Balance Matrix (`/api/ic-matrix/download-balance-matrix`)
// Pure builder: caller pre-aggregates `balanceMap` keyed by `${cc}|${cp}`.
// Returns the worksheet plus computed grand total / column totals so callers
// (and tests) can verify the figures match the on-screen totals.
// ----------------------------------------------------------------------------
export interface MatrixBuildResult extends BuiltSheet {
  rowTotals: number[];
  columnTotals: number[];
  grandTotal: number;
}

export function buildIcBalanceMatrixSheet(
  companyCodes: string[],
  counterPartyCodes: string[],
  codeToName: Record<string, string>,
  balanceMap: Map<string, number>,
): MatrixBuildResult {
  const cpHeaders = counterPartyCodes.map(cp => `${cp} - ${codeToName[cp] || cp}`);
  const sheetRows: any[][] = [];
  sheetRows.push(["Company Code", "Company Name", ...cpHeaders, "Total"]);

  let grandTotal = 0;
  const rowTotals: number[] = [];
  const columnTotals: number[] = counterPartyCodes.map(() => 0);
  for (const cc of companyCodes) {
    let total = 0;
    const vals = counterPartyCodes.map((cp, i) => {
      const val = balanceMap.get(`${cc}|${cp}`) || 0;
      columnTotals[i] += val;
      total += val;
      return val || "";
    });
    grandTotal += total;
    rowTotals.push(total);
    sheetRows.push([cc, codeToName[cc] || cc, ...vals, total]);
  }
  sheetRows.push(["", "Column Total", ...columnTotals.map(v => v || ""), grandTotal]);

  const ws = XLSX.utils.aoa_to_sheet(sheetRows);
  ws["!cols"] = [{ wch: 15 }, { wch: 30 }, ...counterPartyCodes.map(() => ({ wch: 18 })), { wch: 18 }];
  return { name: "IC Balance Matrix", ws, rowTotals, columnTotals, grandTotal };
}

// ----------------------------------------------------------------------------
// IC Matrix — Net-off Matrix (`/api/ic-matrix/download-netoff-matrix`)
// Returns 2 sheets: the matrix + a per-pair summary sheet.
// ----------------------------------------------------------------------------
export interface NetoffSummaryRow {
  companyCode: string;
  counterPartyCode: string;
  companyBalance: number;
  counterPartyBalance: number;
  difference: number;
}

export interface NetoffMatrixResult {
  matrix: MatrixBuildResult;
  summary: BuiltSheet;
  netOffBalanceMap: Map<string, number>;
  summaryRows: NetoffSummaryRow[];
}

export function buildIcNetoffMatrixSheets(
  companyCodes: string[],
  counterPartyCodes: string[],
  codeToName: Record<string, string>,
  balanceMap: Map<string, number>,
): NetoffMatrixResult {
  const netOffBalanceMap = new Map<string, number>();
  const netOffProcessed = new Set<string>();
  const allCodesUnion = new Set([...companyCodes, ...counterPartyCodes]);
  for (const a of allCodesUnion) {
    for (const b of allCodesUnion) {
      if (a === b) continue;
      const pairKey = [a, b].sort().join("|");
      if (netOffProcessed.has(pairKey)) continue;
      netOffProcessed.add(pairKey);
      const aToB = balanceMap.get(`${a}|${b}`) || 0;
      const bToA = balanceMap.get(`${b}|${a}`) || 0;
      const net = aToB + bToA;
      if (net >= 0) {
        netOffBalanceMap.set(`${a}|${b}`, net);
        netOffBalanceMap.set(`${b}|${a}`, 0);
      } else {
        netOffBalanceMap.set(`${a}|${b}`, 0);
        netOffBalanceMap.set(`${b}|${a}`, net);
      }
    }
  }

  const matrix = buildIcBalanceMatrixSheet(companyCodes, counterPartyCodes, codeToName, netOffBalanceMap);
  matrix.name = "IC Net-off Matrix";

  const summaryRows: NetoffSummaryRow[] = [];
  const summaryProcessed = new Set<string>();
  for (const cc of companyCodes) {
    for (const cp of counterPartyCodes) {
      if (cc === cp) continue;
      const pairKey = [cc, cp].sort().join("|");
      if (summaryProcessed.has(pairKey)) continue;
      summaryProcessed.add(pairKey);
      const ccToCp = balanceMap.get(`${cc}|${cp}`) || 0;
      const cpToCc = balanceMap.get(`${cp}|${cc}`) || 0;
      const diff = ccToCp + cpToCc;
      if (Math.abs(diff) > 0.01) {
        summaryRows.push({ companyCode: cc, counterPartyCode: cp, companyBalance: ccToCp, counterPartyBalance: cpToCc, difference: diff });
      }
    }
  }
  summaryRows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  const summarySheet = XLSX.utils.json_to_sheet(summaryRows.map(r => ({
    "Company Code": r.companyCode,
    "Company Name": codeToName[r.companyCode] || r.companyCode,
    "Counter Party Code": r.counterPartyCode,
    "Counter Party Name": codeToName[r.counterPartyCode] || r.counterPartyCode,
    "Company Balance": r.companyBalance,
    "Counter Party Balance": r.counterPartyBalance,
    "Difference": r.difference,
  })));
  summarySheet["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 20 }, { wch: 15 }];

  return {
    matrix,
    summary: { name: "Net-off Summary", ws: summarySheet },
    netOffBalanceMap,
    summaryRows,
  };
}

// ----------------------------------------------------------------------------
// IC Matrix — Net-off Details (`/api/ic-matrix/download-netoff-details`)
// ----------------------------------------------------------------------------
export interface NetoffDetailsResult extends BuiltSheet {
  detailRows: NetoffSummaryRow[];
}

export function buildIcNetoffDetailsSheet(
  companyCodes: string[],
  counterPartyCodes: string[],
  codeToName: Record<string, string>,
  balanceMap: Map<string, number>,
): NetoffDetailsResult {
  const detailRows: NetoffSummaryRow[] = [];
  const processed = new Set<string>();
  for (const cc of companyCodes) {
    for (const cp of counterPartyCodes) {
      if (cc === cp) continue;
      const pairKey = [cc, cp].sort().join("|");
      if (processed.has(pairKey)) continue;
      processed.add(pairKey);
      const ccToCp = balanceMap.get(`${cc}|${cp}`) || 0;
      const cpToCc = balanceMap.get(`${cp}|${cc}`) || 0;
      const diff = ccToCp + cpToCc;
      if (Math.abs(diff) > 0.01) {
        detailRows.push({ companyCode: cc, counterPartyCode: cp, companyBalance: ccToCp, counterPartyBalance: cpToCc, difference: diff });
      }
    }
  }
  detailRows.sort((a, b) => Math.abs(b.difference) - Math.abs(a.difference));

  const ws = XLSX.utils.json_to_sheet(detailRows.map(r => ({
    "Company Code": r.companyCode,
    "Company Name": codeToName[r.companyCode] || r.companyCode,
    "Counter Party Code": r.counterPartyCode,
    "Counter Party Name": codeToName[r.counterPartyCode] || r.counterPartyCode,
    "Company Balance": r.companyBalance,
    "Counter Party Balance": r.counterPartyBalance,
    "Difference": r.difference,
  })));
  ws["!cols"] = [{ wch: 15 }, { wch: 30 }, { wch: 18 }, { wch: 30 }, { wch: 18 }, { wch: 20 }, { wch: 15 }];
  return { name: "Net-off Details", ws, detailRows };
}

// ----------------------------------------------------------------------------
// RPT — Entity working report (rpt-reports.tsx EntityWorkingTab)
// Pure builder produces the aoa + total row; styling is layered on by the
// call site.  Returns the row indexes the call site needs for styling.
// ----------------------------------------------------------------------------
export interface EntityWorkingRowLite {
  entityName?: string | null;
  accountHead?: string | null;
  subAccountHead?: string | null;
  rptLedgerName?: string | null;
  counterPartyShort: string;
  currentNonCurrent: string;
  fsGroup: string;
  fsHeading: string;
  netOpb: number;
  movements: Record<string, number>;
  clbNet: number;
  clbTb: number;
  diff: number;
}

export interface EntityWorkingTotalsLite {
  netOpb: number;
  movements: Record<string, number>;
  clbNet: number;
  clbTb: number;
  diff: number;
}

export interface EntityRptReportBuild extends BuiltSheet {
  headerRow: any[];
  dataRows: any[][];
  totalRow: any[];
  headerRowIdx: number;
  totalRowIdx: number;
  numStartCol: number;
  movColCount: number;
}

export function buildEntityRptReportSheet(
  reportTitle: string,
  reportPeriod: string,
  movCols: { key: string; label: string }[],
  rowsIn: EntityWorkingRowLite[],
  totals: EntityWorkingTotalsLite | undefined,
): EntityRptReportBuild {
  const headerRow = [
    "Entity Name",
    "Account Head", "Sub Account Head", "RPT Ledger Name", "Counter Party",
    "C/NC", "FS Group", "FS Heading",
    "Net OPB",
    ...movCols.map(c => c.label),
    "CLB Net", "CLB-TB", "Diff",
  ];
  const dataRows = rowsIn.map(r => [
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
    [reportTitle],
    [`Period: ${reportPeriod}`],
    [],
    headerRow,
    ...dataRows,
    totalRow,
  ];
  const ws = XLSX.utils.aoa_to_sheet(allRows);
  const headerRowIdx = 3;
  const totalRowIdx = headerRowIdx + 1 + dataRows.length;
  return {
    name: "Entity RPT Report",
    ws,
    headerRow,
    dataRows,
    totalRow,
    headerRowIdx,
    totalRowIdx,
    numStartCol: 6,
    movColCount: movCols.length,
  };
}
