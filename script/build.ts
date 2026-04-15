import * as esbuild from "esbuild";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

async function build() {
  console.log("Building frontend with Vite...");
  execSync("npx vite build", { cwd: projectRoot, stdio: "inherit" });
  console.log("Frontend build complete.");

  console.log("Building server bundle...");

  await esbuild.build({
    entryPoints: [path.resolve(projectRoot, "server/index.ts")],
    outfile: path.resolve(projectRoot, "dist/index.cjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    external: [
      "pg-native",
      "bufferutil",
      "utf-8-validate",
      "lightningcss",
      "@babel/preset-typescript",
      "esbuild",
    ],
    define: {
      "import.meta.dirname": "__dirname",
    },
    loader: {
      ".ts": "ts",
    },
  });

  console.log("Server build complete: dist/index.cjs");

  await esbuild.build({
    entryPoints: [path.resolve(projectRoot, "server/file-worker.ts")],
    outfile: path.resolve(projectRoot, "dist/file-worker.cjs"),
    bundle: true,
    platform: "node",
    target: "node20",
    format: "cjs",
    sourcemap: true,
    external: ["pg-native", "bufferutil", "utf-8-validate"],
    loader: { ".ts": "ts" },
  });
  console.log("Worker build complete: dist/file-worker.cjs");

  const runtimeFiles = ["parse-gl-child.cjs", "streaming-xlsx-parser.cjs"];
  const distDir = path.resolve(projectRoot, "dist");
  for (const file of runtimeFiles) {
    const src = path.resolve(projectRoot, "server", file);
    const dst = path.resolve(distDir, file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, dst);
      console.log(`Copied runtime file: dist/${file}`);
    }
  }

  try {
    const hash = execSync("git rev-parse HEAD", { cwd: projectRoot, encoding: "utf-8" }).trim();
    fs.writeFileSync(path.resolve(projectRoot, "dist/.build-hash"), hash);
    console.log(`Build hash: ${hash}`);
  } catch {
    fs.writeFileSync(path.resolve(projectRoot, "dist/.build-hash"), new Date().toISOString());
  }

  console.log("Full production build done!");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
