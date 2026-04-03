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

const POOL_SIZE = 4;
const workerPool: Worker[] = [];
const taskQueue: Array<{ workerData: any; resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }> = [];
const workerBusy = new Map<Worker, boolean>();

function createWorker(): Worker {
  const worker = new Worker(getWorkerPath(), { execArgv: ["--loader", "tsx/esm"] });
  worker.on("message", (msg) => {
    const task = (worker as any)._currentTask;
    if (task) {
      clearTimeout(task.timer);
      workerBusy.set(worker, false);
      (worker as any)._currentTask = null;
      if (msg.success) task.resolve(msg.data);
      else task.reject(new Error(msg.error));
      processQueue();
    }
  });
  worker.on("error", (err) => {
    const task = (worker as any)._currentTask;
    if (task) clearTimeout(task.timer);
    workerBusy.set(worker, false);
    (worker as any)._currentTask = null;
    if (task) task.reject(err);
    const idx = workerPool.indexOf(worker);
    if (idx !== -1) {
      workerPool.splice(idx, 1);
      const replacement = createWorker();
      workerPool.push(replacement);
    }
    processQueue();
  });
  workerBusy.set(worker, false);
  return worker;
}

function processQueue() {
  if (taskQueue.length === 0) return;
  const freeWorker = workerPool.find(w => !workerBusy.get(w));
  if (!freeWorker) return;
  const task = taskQueue.shift()!;
  workerBusy.set(freeWorker, true);
  (freeWorker as any)._currentTask = task;
  freeWorker.postMessage(task.workerData);
}

for (let i = 0; i < POOL_SIZE; i++) workerPool.push(createWorker());

function runWorker(workerData: any): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("File processing timed out (10 min)"));
    }, 600000);
    taskQueue.push({ workerData, resolve, reject, timer });
    processQueue();
  });
}

export async function parseFileInWorker(filePath: string, filename: string, selectedSheet?: string): Promise<Record<string, string>[]> {
  try {
    return await runWorker({
      action: "parse",
      filePath,
      filename,
      selectedSheet,
    });
  } catch (err: any) {
    console.warn("Worker parsing failed, falling back to main thread:", err.message);
    const fs = require("fs");
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
    try { fs.unlinkSync(filePath); } catch {}
    return parseFileMainThread(buffer, filename, selectedSheet);
  }
}

export async function getSheetNamesInWorker(filePath: string): Promise<string[]> {
  try {
    return await runWorker({
      action: "sheetNames",
      filePath,
    });
  } catch (err: any) {
    console.warn("Worker sheet names failed, falling back to main thread:", err.message);
    const fs = require("fs");
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
    try { fs.unlinkSync(filePath); } catch {}
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
    return workbook.SheetNames || [];
  }
}

export async function previewHeadersInWorker(filePath: string, filename: string, selectedSheet?: string): Promise<{ headers: string[]; sampleRows: Record<string, string>[] }> {
  try {
    return await runWorker({
      action: "preview",
      filePath,
      filename,
      selectedSheet,
    });
  } catch (err: any) {
    console.warn("Worker preview failed, falling back to main thread:", err.message);
    const fs = require("fs");
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
    try { fs.unlinkSync(filePath); } catch {}
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
