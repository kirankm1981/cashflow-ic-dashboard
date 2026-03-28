import { build as esbuild } from "esbuild";
import { build as viteBuild } from "vite";
import { rm, writeFile, mkdir, cp } from "fs/promises";
import path from "path";
import { execSync } from "child_process";
import fs from "fs";
import https from "https";
import http from "http";

const DIST = "dist-windows";
const BSQ3_VERSION = "12.6.2";
const NODE_ABI = "115";

function download(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const get = url.startsWith("https") ? https.get : http.get;
    get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        file.close();
        fs.unlinkSync(dest);
        download(response.headers.location!, dest).then(resolve).catch(reject);
        return;
      }
      response.pipe(file);
      file.on("finish", () => { file.close(); resolve(); });
    }).on("error", reject);
  });
}

async function packageForWindows() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  console.log("Step 1/5: Building frontend...");
  await viteBuild({
    build: {
      outDir: path.resolve(DIST, "public"),
      emptyOutDir: true,
    },
  });

  console.log("Step 2/5: Bundling server...");
  await esbuild({
    entryPoints: ["server/index.ts"],
    platform: "node",
    bundle: true,
    format: "cjs",
    outfile: path.join(DIST, "server.cjs"),
    define: {
      "process.env.NODE_ENV": '"production"',
    },
    minify: true,
    external: ["better-sqlite3"],
    logLevel: "info",
  });

  console.log("Step 3/5: Downloading Windows native binary for better-sqlite3...");

  const bsq3Src = path.resolve("node_modules/better-sqlite3");
  const bsq3Dest = path.join(DIST, "node_modules", "better-sqlite3");

  await mkdir(path.join(bsq3Dest, "lib"), { recursive: true });
  await mkdir(path.join(bsq3Dest, "build", "Release"), { recursive: true });

  await cp(path.join(bsq3Src, "lib"), path.join(bsq3Dest, "lib"), { recursive: true });

  const bsq3Pkg = JSON.parse(fs.readFileSync(path.join(bsq3Src, "package.json"), "utf-8"));
  delete bsq3Pkg.scripts;
  delete bsq3Pkg.devDependencies;
  bsq3Pkg.dependencies = {};
  await writeFile(path.join(bsq3Dest, "package.json"), JSON.stringify(bsq3Pkg, null, 2));

  const prebuildUrl = `https://github.com/WiseLibs/better-sqlite3/releases/download/v${BSQ3_VERSION}/better-sqlite3-v${BSQ3_VERSION}-node-v${NODE_ABI}-win32-x64.tar.gz`;
  const tarPath = path.join("/tmp", "bsq3-win.tar.gz");
  const extractDir = path.join("/tmp", "bsq3-win-extract");

  console.log(`  Downloading from: ${prebuildUrl}`);
  await download(prebuildUrl, tarPath);

  await rm(extractDir, { recursive: true, force: true });
  await mkdir(extractDir, { recursive: true });
  execSync(`tar xzf ${tarPath} -C ${extractDir}`);

  const winNativeFile = path.join(extractDir, "build", "Release", "better_sqlite3.node");
  if (!fs.existsSync(winNativeFile)) {
    throw new Error("Windows native binary not found in prebuild archive");
  }
  await cp(winNativeFile, path.join(bsq3Dest, "build", "Release", "better_sqlite3.node"));
  console.log("  Windows x64 native binary included!");

  const bindingsSrc = path.resolve("node_modules/bindings");
  if (fs.existsSync(bindingsSrc)) {
    await cp(bindingsSrc, path.join(DIST, "node_modules", "bindings"), { recursive: true });
    console.log("  Copied: bindings");
  }
  const furiSrc = path.resolve("node_modules/file-uri-to-path");
  if (fs.existsSync(furiSrc)) {
    await cp(furiSrc, path.join(DIST, "node_modules", "file-uri-to-path"), { recursive: true });
    console.log("  Copied: file-uri-to-path");
  }

  console.log("Step 4/5: Creating launcher files...");

  const packageJson = {
    name: "ic-recon",
    version: "1.0.0",
    private: true,
  };
  await writeFile(path.join(DIST, "package.json"), JSON.stringify(packageJson, null, 2));

  const batContent = `@echo off
title IC Recon - Intercompany Reconciliation Platform
echo.
echo  ============================================
echo   IC Recon - Intercompany Reconciliation
echo  ============================================
echo.

cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo  [ERROR] Node.js is not installed.
    echo  Please install Node.js v20 LTS from https://nodejs.org
    echo.
    pause
    exit /b 1
)

echo  Starting IC Recon server...
echo  Open your browser to: http://localhost:5000
echo.
echo  Press Ctrl+C to stop the server.
echo.

set PORT=5000
set NODE_ENV=production
node server.cjs

pause
`;
  await writeFile(path.join(DIST, "start.bat"), batContent);

  const silentVbs = `Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
strPath = fso.GetParentFolderName(WScript.ScriptFullPath)
WshShell.CurrentDirectory = strPath
WshShell.Run "cmd /c cd /d """ & strPath & """ && set PORT=5000&& set NODE_ENV=production&& node server.cjs", 0, False
WScript.Sleep 2000
WshShell.Run "http://localhost:5000", 1, False
`;
  await writeFile(path.join(DIST, "start-silent.vbs"), silentVbs);

  const readmeContent = `# IC Recon - Intercompany Reconciliation Platform
=============================================

## Prerequisites
  Node.js v20 LTS (download from https://nodejs.org)
  That's it - nothing else to install.

## How to Run
  1. Double-click "start.bat" (shows console window)
     OR
     Double-click "start-silent.vbs" (runs silently, opens browser)

  2. Open http://localhost:5000 in your browser

  No internet connection required. No npm install required.
  Everything is pre-bundled and ready to go.

## Auto-Start with Windows
  1. Press Win+R, type: shell:startup, press Enter
  2. Copy "start-silent.vbs" (or a shortcut) into that folder

## Stopping the App
  - start.bat: Press Ctrl+C in the console
  - start-silent.vbs: Task Manager > find "node.exe" > End Task

## Data & Backup
  All data is in the "data" folder (created on first run).
  - Backup: Copy the "data" folder
  - Reset: Delete the "data" folder and restart

## Port Conflict
  If port 5000 is in use, edit start.bat and change PORT=5000
  to another port (e.g., PORT=8080).

## Node.js Version
  This package includes prebuilt binaries for Node.js v20 (LTS).
  If you use a different Node.js version, you may need to rebuild
  the database driver by running: npm install better-sqlite3
`;
  await writeFile(path.join(DIST, "README.txt"), readmeContent);

  console.log("Step 5/5: Package complete!");
  console.log("");
  console.log("=== Package Contents ===");

  function printDir(dir: string, prefix = "") {
    const entries = fs.readdirSync(dir).sort();
    for (const e of entries) {
      const full = path.join(dir, e);
      const stat = fs.statSync(full);
      if (stat.isDirectory()) {
        if (e === "node_modules") {
          const mods = fs.readdirSync(full);
          console.log(`${prefix}${e}/ (${mods.length} pre-bundled packages)`);
        } else if (prefix.split("/").length > 3) {
          console.log(`${prefix}${e}/`);
        } else {
          console.log(`${prefix}${e}/`);
          printDir(full, prefix + "  ");
        }
      } else {
        const kb = (stat.size / 1024).toFixed(0);
        console.log(`${prefix}${e} (${kb} KB)`);
      }
    }
  }
  printDir(DIST);

  const totalSize = execSync(`du -sh ${DIST}`).toString().trim().split("\t")[0];
  console.log("");
  console.log(`Total package size: ${totalSize}`);
  console.log("");
  console.log("READY TO DEPLOY:");
  console.log("  1. Copy the entire dist-windows folder to a USB drive or network share");
  console.log("  2. On target Windows PC, just need Node.js v20 installed");
  console.log("  3. Double-click start.bat - that's it!");
  console.log("  No internet, no npm install, no build tools, no proxy config needed.");
}

packageForWindows().catch((err) => {
  console.error(err);
  process.exit(1);
});
