import * as esbuild from "esbuild";
import path from "path";
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
  console.log("Full production build done!");
}

build().catch((err) => {
  console.error("Build failed:", err);
  process.exit(1);
});
