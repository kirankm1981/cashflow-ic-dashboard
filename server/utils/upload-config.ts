import multer from "multer";
import path from "path";
import os from "os";
import fs from "fs";
import { randomUUID } from "crypto";

const ALLOWED_EXTENSIONS = new Set([".xlsx", ".xls", ".csv"]);
const ALLOWED_MIMETYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "text/csv",
  "application/csv",
  "text/plain",
  "application/octet-stream",
]);

function getUploadLogPath(): string {
  const logsDir = path.join(process.cwd(), "windows", "logs");
  if (!fs.existsSync(logsDir)) {
    try { fs.mkdirSync(logsDir, { recursive: true }); } catch {}
  }
  return path.join(logsDir, "uploads.log");
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export function logUpload(module: string, action: string, details: string) {
  const timestamp = new Date().toISOString();
  const line = `[${timestamp}] [${module}] ${action}: ${details}`;
  console.log(line);
  try {
    const logPath = getUploadLogPath();
    if (fs.existsSync(path.dirname(logPath))) {
      if (fs.existsSync(logPath)) {
        const stat = fs.statSync(logPath);
        if (stat.size > 20 * 1024 * 1024) {
          fs.writeFileSync(logPath, `[${timestamp}] Log truncated (was ${formatFileSize(stat.size)})\n`);
        }
      }
      fs.appendFileSync(logPath, line + "\n");
    }
  } catch {}
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const tmpDir = path.join(os.tmpdir(), "ic-uploads");
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    cb(null, tmpDir);
  },
  filename: (_req, file, cb) => {
    cb(null, `${Date.now()}-${randomUUID()}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({
  storage: diskStorage,
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!ALLOWED_EXTENSIONS.has(ext)) {
      logUpload("MULTER", "REJECTED", `${file.originalname} — invalid extension: ${ext}`);
      return cb(new Error(`File type not allowed. Only xlsx, xls, csv permitted. Got: ${ext}`));
    }
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      logUpload("MULTER", "REJECTED", `${file.originalname} — invalid MIME: ${file.mimetype}`);
      return cb(new Error(`MIME type not permitted: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

export function cleanupFile(filePath: string) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logUpload("CLEANUP", "OK", `Deleted temp file: ${path.basename(filePath)}`);
    }
  } catch (err: any) {
    logUpload("CLEANUP", "ERROR", `Failed to delete ${path.basename(filePath)}: ${err.message}`);
  }
}
