import { Worker } from "worker_threads";
import path from "path";
import { fileURLToPath } from "url";

function getWorkerPath(): string {
  try {
    const dir = path.dirname(fileURLToPath(import.meta.url));
    return path.join(dir, "file-worker.ts");
  } catch {
    return path.join(__dirname, "file-worker.ts");
  }
}

function runWorker(workerData: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const workerPath = getWorkerPath();
    const worker = new Worker(workerPath, {
      workerData,
      execArgv: ["--loader", "tsx/esm"],
    });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("File processing timed out (10 min)"));
    }, 600000);

    worker.on("message", (msg) => {
      clearTimeout(timeout);
      if (msg.success) {
        resolve(msg.data);
      } else {
        reject(new Error(msg.error));
      }
    });

    worker.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });

    worker.on("exit", (code) => {
      clearTimeout(timeout);
      if (code !== 0) {
        reject(new Error(`Worker exited with code ${code}`));
      }
    });
  });
}

export async function parseFileInWorker(buffer: Buffer, filename: string, selectedSheet?: string): Promise<Record<string, string>[]> {
  try {
    return await runWorker({
      action: "parse",
      buffer: buffer,
      filename,
      selectedSheet,
    });
  } catch (err: any) {
    console.warn("Worker parsing failed, falling back to main thread:", err.message);
    return parseFileMainThread(buffer, filename, selectedSheet);
  }
}

export async function getSheetNamesInWorker(buffer: Buffer): Promise<string[]> {
  try {
    return await runWorker({
      action: "sheetNames",
      buffer: buffer,
    });
  } catch (err: any) {
    console.warn("Worker sheet names failed, falling back to main thread:", err.message);
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
    return workbook.SheetNames || [];
  }
}

export async function previewHeadersInWorker(buffer: Buffer, filename: string, selectedSheet?: string): Promise<{ headers: string[]; sampleRows: Record<string, string>[] }> {
  try {
    return await runWorker({
      action: "preview",
      buffer: buffer,
      filename,
      selectedSheet,
    });
  } catch (err: any) {
    console.warn("Worker preview failed, falling back to main thread:", err.message);
    return previewMainThread(buffer, filename, selectedSheet);
  }
}

function parseFileMainThread(buffer: Buffer, filename: string, selectedSheet?: string): Record<string, string>[] {
  const XLSX = require("xlsx");
  const { parse } = require("csv-parse/sync");
  const ext = (filename || "").toLowerCase().split(".").pop();
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    return jsonRows.map((row: any) => {
      const stringRow: Record<string, string> = {};
      for (const [key, val] of Object.entries(row)) {
        stringRow[key] = val != null ? String(val) : "";
      }
      return stringRow;
    });
  }
  const content = buffer.toString("utf-8");
  return parse(content, {
    columns: true, skip_empty_lines: true, trim: true,
    relax_column_count: true, relax_quotes: true,
  });
}

function previewMainThread(buffer: Buffer, filename: string, selectedSheet?: string): { headers: string[]; sampleRows: Record<string, string>[] } {
  const XLSX = require("xlsx");
  const { parse } = require("csv-parse/sync");
  const ext = (filename || "").toLowerCase().split(".").pop();
  let records: Record<string, string>[];
  if (ext === "xlsx" || ext === "xls") {
    const workbook = XLSX.read(buffer, { type: "buffer", sheetRows: 5 });
    const sheetName = selectedSheet && workbook.SheetNames.includes(selectedSheet)
      ? selectedSheet
      : workbook.SheetNames[0];
    if (!sheetName) throw new Error("Excel file has no sheets");
    const sheet = workbook.Sheets[sheetName];
    const jsonRows = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    records = jsonRows.map((row: any) => {
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
