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
]);

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
      return cb(new Error(`File type not allowed. Only xlsx, xls, csv permitted. Got: ${ext}`));
    }
    if (!ALLOWED_MIMETYPES.has(file.mimetype)) {
      return cb(new Error(`MIME type not permitted: ${file.mimetype}`));
    }
    cb(null, true);
  },
});

export function cleanupFile(filePath: string) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch {}
}
