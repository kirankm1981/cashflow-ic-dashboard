import { parentPort } from "worker_threads";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import fs from "fs";

function parseFileToRecords(buffer: Buffer, filename: string, selectedSheet?: string): Record<string, string>[] {
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    return jsonRows.map(row => {
      const stringRow: Record<string, string> = {};
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val != null ? String(val) : "";
      }
      return stringRow;
    });
  }
  const content = buffer.toString("utf-8");
  return parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    relax_column_count: true,
    relax_quotes: true,
  });
}

function getSheetNames(buffer: Buffer): string[] {
  const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
  return workbook.SheetNames || [];
}

function previewHeaders(buffer: Buffer, filename: string, selectedSheet?: string): { headers: string[]; sampleRows: Record<string, string>[] } {
  const ext = (filename || "").toLowerCase().split(".").pop();
  let records: Record<string, string>[];
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: 5 });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "" });
    records = jsonRows.map(row => {
      const stringRow: Record<string, string> = {};
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val != null ? String(val) : "";
      }
      return stringRow;
    });
  } else {
    const content = buffer.toString("utf-8");
    records = parse(content, {
      columns: true, skip_empty_lines: true, trim: true,
      relax_column_count: true, relax_quotes: true, to: 5,
    });
  }
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, sampleRows: records.slice(0, 3) };
}

parentPort?.on("message", (msg) => {
  try {
    const { action, buffer, filePath, filename, selectedSheet } = msg;
    const buf = buffer ? Buffer.from(buffer) : fs.readFileSync(filePath);

    let result: any;
    switch (action) {
      case "parse":
        result = parseFileToRecords(buf, filename, selectedSheet);
        break;
      case "sheetNames":
        result = getSheetNames(buf);
        break;
      case "preview":
        result = previewHeaders(buf, filename, selectedSheet);
        break;
      case "parseTbSheet": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        result = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });
        break;
      }
      default:
        throw new Error(`Unknown action: ${action}`);
    }

    if (filePath) { try { fs.unlinkSync(filePath); } catch {} }

    parentPort?.postMessage({ success: true, data: result });
  } catch (error: any) {
    if (msg.filePath) { try { fs.unlinkSync(msg.filePath); } catch {} }
    parentPort?.postMessage({ success: false, error: error.message });
  }
});
