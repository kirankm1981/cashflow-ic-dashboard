/**
 * Auto-start runner - handles DB wait + schema sync + server start on Windows.
 * Called by the auto-start VBS after the initial boot delay.
 *
 * Why this exists: doing the DB check / server launch from VBScript proved
 * fragile and produced no usable diagnostics. This Node script loads .env via
 * dotenv (reliable), retries the DB connection, runs the schema sync, starts
 * the server, and logs everything with full detail to windows/logs/.
 *
 * IMPORTANT: forces IPv4-first DNS and rewrites `localhost` -> 127.0.0.1, since
 * on Windows + Node 17+ `localhost` resolves to IPv6 (::1) first while a default
 * PostgreSQL install only listens on IPv4 (127.0.0.1) -> ECONNREFUSED.
 */
const path = require("path");
const fs = require("fs");
const dns = require("dns");
const { execSync, spawn } = require("child_process");

// Change to project root (parent of windows/)
const projectRoot = path.resolve(__dirname, "..");
process.chdir(projectRoot);

// Load .env using dotenv (reliable, unlike VBS parsing)
require("dotenv").config({ path: path.join(projectRoot, ".env") });

// Force IPv4-first resolution and normalize the DB host.
if (typeof dns.setDefaultResultOrder === "function") {
  dns.setDefaultResultOrder("ipv4first");
}
function normalizeDbHost(url) {
  return url ? url.replace(/@localhost([:/])/i, "@127.0.0.1$1") : url;
}
const DATABASE_URL = normalizeDbHost(process.env.DATABASE_URL);
if (DATABASE_URL) process.env.DATABASE_URL = DATABASE_URL;

// Setup logging
const logsDir = path.join(projectRoot, "windows", "logs");
if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir, { recursive: true });

const logFile = path.join(logsDir, "autostart.log");
const dbLogFile = path.join(logsDir, "db-check.log");
const serverLogPath = path.join(logsDir, "server.log");

function ts() {
  return new Date().toLocaleString("en-IN", { hour12: false });
}
function log(msg) {
  const line = `[${ts()}] ${msg}\n`;
  try { fs.appendFileSync(logFile, line); } catch (_) {}
  process.stdout.write(line);
}
function dbLog(msg) {
  try { fs.appendFileSync(dbLogFile, `[${ts()}] ${msg}\n`); } catch (_) {}
}

const HEALTH_URL = "http://127.0.0.1:" + (process.env.PORT || "3000") + "/api/health";

function safeTarget(url) {
  return url ? url.replace(/\/\/[^@]*@/, "//***@") : "(DATABASE_URL not set)";
}

log("Auto-start runner started");
log(`Project root: ${projectRoot}`);
log(`Platform: ${process.platform} ${process.arch}, Node: ${process.version}`);
log(`Target HTTP port: ${process.env.PORT || "3000"} (HTTPS ${process.env.HTTPS_PORT || "3443"} if certs present)`);
log(`Logs: autostart.log, db-check.log, server.log in windows\\logs`);
log(`DATABASE_URL set: ${!!process.env.DATABASE_URL}`);

if (!process.env.DATABASE_URL) {
  log("FATAL: DATABASE_URL not set. Check .env file.");
  dbLog("FATAL: DATABASE_URL not found in environment or .env");
  process.exit(1);
}

const { Client } = require("pg");
const MAX_RETRIES = 15;
const RETRY_DELAY_MS = 10000;

function httpHealthCheck(url, timeoutMs) {
  return new Promise((resolve, reject) => {
    const req = require("http").get(url, (res) => {
      // Drain so the socket frees up.
      res.resume();
      if (res.statusCode === 200) resolve(true);
      else reject(new Error(`Status ${res.statusCode}`));
    });
    req.on("error", reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function tryConnect() {
  dbLog(`Target: ${safeTarget(DATABASE_URL)}`);
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      dbLog(`--- Attempt ${attempt} of ${MAX_RETRIES} ---`);
      const client = new Client({ connectionString: DATABASE_URL });
      await client.connect();
      await client.query("SELECT 1");
      await client.end();
      log(`Database connected on attempt ${attempt}`);
      dbLog(`SUCCESS: Connected on attempt ${attempt}`);
      return true;
    } catch (err) {
      const errMsg = err.message || String(err);
      log(`DB attempt ${attempt} failed: ${errMsg}`);
      dbLog(`FAILED: ${errMsg}`);
      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
      }
    }
  }
  return false;
}

function runSchemaSync() {
  try {
    log("Running schema sync...");
    const out = execSync("node windows/sync-db.cjs", {
      cwd: projectRoot,
      stdio: "pipe",
      env: process.env,
      timeout: 90000,
    });
    const text = (out || "").toString().trim();
    if (text) text.split(/\r?\n/).forEach((l) => log(`  [sync-db] ${l}`));
    log("Schema sync complete");
    return true;
  } catch (err) {
    log(`Schema sync reported a problem (non-fatal): ${err.message || err}`);
    const eout = ((err.stdout || "") + (err.stderr || "")).toString().trim();
    if (eout) eout.split(/\r?\n/).forEach((l) => log(`  [sync-db] ${l}`));
    return false;
  }
}

async function startServer() {
  log("Starting server (node dist/index.cjs)...");

  const env = {
    ...process.env,
    NODE_ENV: "production",
    NODE_OPTIONS: "--max-old-space-size=2048",
  };

  // Write server output straight to a file descriptor so it survives this
  // (parent) process exiting. Piping through the parent would break when we exit.
  const outFd = fs.openSync(serverLogPath, "a");
  const errFd = fs.openSync(serverLogPath, "a");

  const server = spawn("node", ["dist/index.cjs"], {
    cwd: projectRoot,
    env,
    stdio: ["ignore", outFd, errFd],
    detached: true,
    windowsHide: true,
  });
  server.unref();
  log(`Server started with PID ${server.pid}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      await httpHealthCheck(HEALTH_URL, 3000);
      log("Server is running on http://localhost:3000");
      return true;
    } catch (_) {
      // keep waiting
    }
  }
  log("WARNING: Server did not respond to health check after 60s");
  log("Check windows\\logs\\server.log for server errors");
  return false;
}

async function main() {
  // If the server is already up, just open the browser and exit.
  try {
    await httpHealthCheck(HEALTH_URL, 2000);
    log("Server already running on port 3000, exiting");
    try { execSync('start "" "http://localhost:3000"', { stdio: "ignore", shell: true }); } catch (_) {}
    process.exit(0);
  } catch (_) {
    // not running, proceed
  }

  const dbOk = await tryConnect();
  if (!dbOk) {
    log("FATAL: Database connection failed after all retries");
    log("See windows\\logs\\db-check.log for the exact error.");
    process.exit(1);
  }

  runSchemaSync();
  await startServer();

  try {
    execSync('start "" "http://localhost:3000"', { stdio: "ignore", shell: true });
  } catch (_) { /* ignore browser open failure */ }

  log("Auto-start runner complete");
  process.exit(0);
}

main().catch((err) => {
  log(`FATAL: ${err.message || err}`);
  process.exit(1);
});
