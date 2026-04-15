import { parentPort } from "worker_threads";
import * as XLSX from "xlsx";
import { parse } from "csv-parse/sync";
import fs from "fs";
import path from "path";
import os from "os";

const LARGE_FILE_MB = 10;

function resolveStreamingParser(): any {
  const dir = typeof __dirname !== "undefined" ? __dirname : path.dirname("");
  const candidates = [
    path.join(dir, "streaming-xlsx-parser.cjs"),
    path.resolve("server/streaming-xlsx-parser.cjs"),
    path.resolve("dist/streaming-xlsx-parser.cjs"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      try { return require(p); } catch {}
    }
  }
  return null;
}

function getFileSizeMB(filePath: string): number {
  try {
    return fs.statSync(filePath).size / (1024 * 1024);
  } catch {
    return 0;
  }
}

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

parentPort?.on("message", async (msg) => {
  try {
    const { action, buffer, filePath, filename, selectedSheet } = msg;
    const isLargeFile = filePath && getFileSizeMB(filePath) > LARGE_FILE_MB;
    const ext = (filename || "").toLowerCase().split(".").pop();
    const isExcel = ext === "xlsx" || ext === "xls";

    if (isLargeFile && isExcel) {
      const sax = resolveStreamingParser();
      if (sax) {
        try {
          let result: any;
          switch (action) {
            case "parse": {
              const saxResult = await sax.parseXlsxStreaming(filePath, { sheetName: selectedSheet, maxInMemoryRows: 500000 });
              let rawRows = saxResult.rows;
              if (saxResult.tmpFile) {
                rawRows = JSON.parse(fs.readFileSync(saxResult.tmpFile, "utf8"));
                try { fs.unlinkSync(saxResult.tmpFile); } catch {}
              }
              if (rawRows && rawRows.length > 0) {
                const headers = rawRows[0].map((h: any) => (h != null ? String(h) : ""));
                const records: Record<string, string>[] = [];
                for (let i = 1; i < rawRows.length; i++) {
                  const row = rawRows[i];
                  if (!row || row.length === 0) continue;
                  const record: Record<string, string> = {};
                  for (let j = 0; j < headers.length; j++) {
                    if (headers[j]) record[headers[j]] = row[j] != null ? String(row[j]) : "";
                  }
                  records.push(record);
                }
                result = records;
              } else {
                result = [];
              }
              break;
            }
            case "parseTbSheet": {
              const saxResult = await sax.parseXlsxStreaming(filePath, { maxInMemoryRows: 500000 });
              if (saxResult.tmpFile) {
                result = JSON.parse(fs.readFileSync(saxResult.tmpFile, "utf8"));
                try { fs.unlinkSync(saxResult.tmpFile); } catch {}
              } else {
                result = saxResult.rows;
              }
              break;
            }
            case "parseTbSheetToFile": {
              const saxResult = await sax.parseXlsxStreaming(filePath, { maxInMemoryRows: 0 });
              if (saxResult.tmpFile) {
                if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
                parentPort?.postMessage({ success: true, data: { tmpFile: saxResult.tmpFile, rowCount: saxResult.rowCount } });
                return;
              }
              const tmpFile = path.join(os.tmpdir(), `parsed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
              fs.writeFileSync(tmpFile, JSON.stringify(saxResult.rows));
              if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
              parentPort?.postMessage({ success: true, data: { tmpFile, rowCount: saxResult.rowCount } });
              return;
            }
            case "sheetNames": {
              result = await sax.getSheetNamesStreaming(filePath);
              break;
            }
            case "preview": {
              const previewRows = await sax.previewStreaming(filePath);
              if (previewRows.length > 0) {
                const headers = previewRows[0].map((h: any) => h != null ? String(h) : "");
                const sampleRows: Record<string, string>[] = [];
                for (let i = 1; i < Math.min(previewRows.length, 4); i++) {
                  const record: Record<string, string> = {};
                  for (let j = 0; j < headers.length; j++) {
                    if (headers[j]) record[headers[j]] = previewRows[i]?.[j] != null ? String(previewRows[i][j]) : "";
                  }
                  sampleRows.push(record);
                }
                result = { headers, sampleRows };
              } else {
                result = { headers: [], sampleRows: [] };
              }
              break;
            }
          }
          if (result !== undefined) {
            if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
            parentPort?.postMessage({ success: true, data: result });
            return;
          }
        } catch (saxErr: any) {
          console.error("SAX streaming failed, falling back to SheetJS:", saxErr.message);
        }
      }
    }

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
      case "parseTbSheetToFile": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });
        const tmpFile = path.join(os.tmpdir(), `parsed-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
        const writeStream = fs.createWriteStream(tmpFile);
        writeStream.write("[");
        for (let i = 0; i < rows.length; i++) {
          if (i > 0) writeStream.write(",");
          writeStream.write(JSON.stringify(rows[i]));
        }
        writeStream.write("]");
        writeStream.end();
        writeStream.on("finish", () => {
          if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
          parentPort?.postMessage({ success: true, data: { tmpFile, rowCount: rows.length } });
        });
        writeStream.on("error", (err: any) => {
          if (filePath) { try { fs.unlinkSync(filePath); } catch {} }
          parentPort?.postMessage({ success: false, error: err.message });
        });
        return;
      }
      case "parseMultiSheet": {
        const wb = XLSX.read(buf, { type: "buffer" });
        const sheets: Record<string, any[][]> = {};
        for (const name of wb.SheetNames) {
          sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, range: 0, defval: "" });
        }
        result = { sheetNames: wb.SheetNames, sheets };
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
