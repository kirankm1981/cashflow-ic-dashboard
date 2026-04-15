import { Worker } from "worker_threads";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

function resolveDir(): string {
  try {
    if (typeof __dirname !== "undefined") return __dirname;
  } catch {}
  return path.dirname(fileURLToPath(import.meta.url));
}

function getWorkerPath(): string {
  const dir = resolveDir();
  return path.join(dir, "file-worker.cjs");
}

const isProd = process.env.NODE_ENV === "production";
const POOL_SIZE = isProd ? 4 : 0;
const workerPool: Worker[] = [];
const taskQueue: Array<{ workerData: any; resolve: Function; reject: Function; timer: ReturnType<typeof setTimeout> }> = [];
const workerBusy = new Map<Worker, boolean>();

function createWorker(): Worker {
  const workerPath = getWorkerPath();
  const worker = new Worker(workerPath);
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
  clearTimeout(task.timer);
  workerBusy.set(freeWorker, true);
  (freeWorker as any)._currentTask = task;
  freeWorker.postMessage(task.workerData);
}

for (let i = 0; i < POOL_SIZE; i++) workerPool.push(createWorker());

function runWorker(workerData: any): Promise<any> {
  if (POOL_SIZE === 0) return Promise.reject(new Error("Workers disabled in dev mode"));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("File processing timed out (10 min)"));
    }, 600000);
    taskQueue.push({ workerData, resolve, reject, timer });
    processQueue();
  });
}

function getOneOffWorkerPath(): string {
  const dir = resolveDir();
  const cjsPath = path.join(dir, "file-worker.cjs");
  if (fs.existsSync(cjsPath)) return cjsPath;
  return path.join(dir, "file-worker.ts");
}

function runOneOffWorker(workerData: any, timeoutMs = 600000): Promise<any> {
  return new Promise((resolve, reject) => {
    const workerPath = getOneOffWorkerPath();
    const isTsFile = workerPath.endsWith(".ts");
    // Use conservative memory limit that works on Replit (512MB-1GB containers)
    const heapMb = parseInt(process.env.WORKER_HEAP_MB || "2048", 10);
    const workerOpts: any = {
      resourceLimits: { maxOldGenerationSizeMb: heapMb },
    };
    if (isTsFile) {
      workerOpts.execArgv = ["--import", "tsx"];
    }
    let settled = false;
    const settle = (fn: () => void) => { if (!settled) { settled = true; fn(); } };
    const worker = new Worker(workerPath, workerOpts);
    const timer = setTimeout(() => {
      worker.terminate();
      settle(() => reject(new Error("File processing timed out (10 min)")));
    }, timeoutMs);
    worker.on("message", (msg) => {
      clearTimeout(timer);
      worker.terminate();
      settle(() => { if (msg.success) resolve(msg.data); else reject(new Error(msg.error)); });
    });
    worker.on("error", (err) => {
      clearTimeout(timer);
      worker.terminate();
      settle(() => reject(err));
    });
    worker.on("exit", (code) => {
      clearTimeout(timer);
      settle(() => reject(new Error(`Worker exited unexpectedly with code ${code} (possible OOM)`)));
    });
    worker.postMessage(workerData);
  });
}

export async function parseFileInWorker(filePath: string, filename: string, selectedSheet?: string, action: string = "parse"): Promise<any> {
  try {
    if (POOL_SIZE > 0) {
      return await runWorker({
        action,
        filePath,
        filename,
        selectedSheet,
      });
    }
    return await runOneOffWorker({ action, filePath, filename, selectedSheet });
  } catch (err: any) {
    const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    const MAX_MAIN_THREAD_SIZE = 15 * 1024 * 1024;
    if (fileSize > MAX_MAIN_THREAD_SIZE) {
      console.error(`Worker parsing failed for large file (${(fileSize / 1024 / 1024).toFixed(1)}MB), not falling back to main thread:`, err.message);
      try { fs.unlinkSync(filePath); } catch {}
      throw new Error(`File too large to process (${(fileSize / 1024 / 1024).toFixed(0)}MB). Worker failed: ${err.message}`);
    }
    console.warn("Worker parsing failed, falling back to main thread:", err.message);
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
    try { fs.unlinkSync(filePath); } catch {}
    return mainThreadDispatch(buffer, filename, selectedSheet, action);
  }
}

export async function getSheetNamesInWorker(filePath: string): Promise<string[]> {
  try {
    const workerData = { action: "sheetNames", filePath };
    return POOL_SIZE > 0 ? await runWorker(workerData) : await runOneOffWorker(workerData);
  } catch (err: any) {
    console.warn("Worker sheet names failed, falling back to main thread:", err.message);
    const fileSize = fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
    if (fileSize > 15 * 1024 * 1024) {
      // For large files, use ExcelJS streaming to just get sheet names
      try {
        const ExcelJS = await import("exceljs");
        const workbook = new (ExcelJS as any).default.Workbook();
        // Only read the workbook structure, not cell data
        await workbook.xlsx.readFile(filePath);
        const names = workbook.worksheets.map((ws: any) => ws.name);
        try { fs.unlinkSync(filePath); } catch {}
        return names;
      } catch (e2: any) {
        console.warn("ExcelJS sheet names fallback also failed:", e2.message);
        try { fs.unlinkSync(filePath); } catch {}
        throw e2;
      }
    }
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
    try { fs.unlinkSync(filePath); } catch {}
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(buffer, { type: "buffer", bookSheets: true });
    return workbook.SheetNames || [];
  }
}

export async function previewHeadersInWorker(filePath: string, filename: string, selectedSheet?: string): Promise<{ headers: string[]; sampleRows: Record<string, string>[] }> {
  try {
    const workerData = { action: "preview", filePath, filename, selectedSheet };
    return POOL_SIZE > 0 ? await runWorker(workerData) : await runOneOffWorker(workerData);
  } catch (err: any) {
    console.warn("Worker preview failed, falling back to main thread:", err.message);
    const buffer = fs.existsSync(filePath) ? fs.readFileSync(filePath) : Buffer.alloc(0);
    try { fs.unlinkSync(filePath); } catch {}
    return previewMainThread(buffer, filename, selectedSheet);
  }
}

async function mainThreadDispatch(buffer: Buffer, filename: string, selectedSheet: string | undefined, action: string): Promise<any> {
  const XLSX = await import("xlsx");

  switch (action) {
    case "parseTbSheet": {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const ws = wb.Sheets[wb.SheetNames[0]];
      return XLSX.utils.sheet_to_json(ws, { header: 1, range: 0, defval: "" });
    }
    case "parseMultiSheet": {
      const wb = XLSX.read(buffer, { type: "buffer" });
      const sheets: Record<string, any[][]> = {};
      for (const name of wb.SheetNames) {
        sheets[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, range: 0, defval: "" });
      }
      return { sheetNames: wb.SheetNames, sheets };
    }
    case "preview":
      return previewMainThread(buffer, filename, selectedSheet);
    case "parse":
    default:
      return parseFileMainThread(buffer, filename, selectedSheet);
  }
}

async function parseFileMainThread(buffer: Buffer, filename: string, selectedSheet?: string): Promise<Record<string, string>[]> {
  const XLSX = await import("xlsx");
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
  const csvParse = await import("csv-parse/sync");
  const content = buffer.toString("utf-8");
  return csvParse.parse(content, {
    columns: true, skip_empty_lines: true, trim: true,
    relax_column_count: true, relax_quotes: true,
  });
}

async function previewMainThread(buffer: Buffer, filename: string, selectedSheet?: string): Promise<{ headers: string[]; sampleRows: Record<string, string>[] }> {
  const XLSX = await import("xlsx");
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
    const csvParse = await import("csv-parse/sync");
    const content = buffer.toString("utf-8");
    records = csvParse.parse(content, {
      columns: true, skip_empty_lines: true, trim: true,
      relax_column_count: true, relax_quotes: true, to: 5,
    });
  }
  const headers = records.length > 0 ? Object.keys(records[0]) : [];
  return { headers, sampleRows: records.slice(0, 3) };
}
