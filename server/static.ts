import express, { type Express } from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function serveStatic(app: Express) {
  const distPath = path.resolve(__dirname, "public");
  const altDistPath = path.resolve(process.cwd(), "dist", "public");

  let servePath: string;
  if (fs.existsSync(distPath)) {
    servePath = distPath;
  } else if (fs.existsSync(altDistPath)) {
    servePath = altDistPath;
  } else {
    throw new Error(
      `Could not find the build directory. Checked: ${distPath} and ${altDistPath}. Run the build step first.`,
    );
  }

  app.use(express.static(servePath));

  app.use("/{*path}", (_req, res) => {
    res.sendFile(path.resolve(servePath, "index.html"));
  });
}
