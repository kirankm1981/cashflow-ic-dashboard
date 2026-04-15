import "dotenv/config";

process.on("unhandledRejection", (reason, promise) => {
  console.error("[FATAL] Unhandled Rejection at:", promise, "reason:", reason);
});

process.on("uncaughtException", (err) => {
  console.error("[FATAL] Uncaught Exception:", err);
  setTimeout(() => process.exit(1), 3000);
});
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import helmet from "helmet";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import rateLimit from "express-rate-limit";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import https from "https";
import fs from "fs";
import path from "path";
import os from "os";
import { pool } from "./db";

function cleanupStaleTempFiles() {
  const tmpDir = path.join(os.tmpdir(), "ic-uploads");
  if (!fs.existsSync(tmpDir)) return;
  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  try {
    for (const file of fs.readdirSync(tmpDir)) {
      const filePath = path.join(tmpDir, file);
      const stat = fs.statSync(filePath);
      if (now - stat.mtimeMs > TWO_HOURS) {
        fs.unlinkSync(filePath);
        console.log(`[Cleanup] Removed stale temp file: ${file}`);
      }
    }
  } catch (e) {
    console.warn("[Cleanup] Temp file cleanup error:", e);
  }
}

cleanupStaleTempFiles();
setInterval(cleanupStaleTempFiles, 4 * 60 * 60 * 1000);

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

declare module "express-session" {
  interface SessionData {
    userId: string;
    role: string;
  }
}

app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  }
}));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "blob:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

app.use((req, res, next) => {
  if (req.path.startsWith("/api/upload") || req.path.startsWith("/api/recon/upload") || req.path.startsWith("/api/cashflow/upload") || req.path.startsWith("/api/ic-matrix/upload")) {
    return next();
  }
  express.json({ limit: "1mb" })(req, res, next);
});

app.use(express.urlencoded({ extended: false, limit: "1mb" }));

const PgStore = connectPgSimple(session);
app.use(
  session({
    store: new PgStore({
      pool,
      tableName: "user_sessions",
      createTableIfMissing: true,
    }),
    secret: (() => {
      const secret = (process.env.SESSION_SECRET || "").trim();
      if (secret.length >= 16) return secret;
      if (process.env.NODE_ENV === "production") {
        console.error("FATAL: SESSION_SECRET environment variable is required in production.");
        process.exit(1);
      }
      return "cashflow-ic-dev-secret";
    })(),
    resave: false,
    saveUninitialized: false,
    cookie: {
      maxAge: 24 * 60 * 60 * 1000,
      httpOnly: true,
      secure: process.env.FORCE_HTTPS === "true",
      sameSite: "lax",
    },
  })
);

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  keyGenerator: (req) => (req.session as any)?.userId || req.ip || "unknown",
  skip: (req) => {
    const url = req.originalUrl || req.path;
    return url.startsWith("/api/upload") ||
           url.startsWith("/api/recon/upload") ||
           url.startsWith("/api/cashflow/upload") ||
           url.startsWith("/api/ic-matrix/upload");
  },
  message: { message: "Too many requests. Please slow down." },
  validate: { xForwardedForHeader: false, ip: false, default: false },
});
app.use("/api", apiLimiter);

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse && process.env.NODE_ENV !== "production") {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  const { ensureSchema } = await import("./migrate");
  await ensureSchema();

  const { seedDefaultRules, seedDefaultAdmin, fixReversalStatuses, migratePasswordFields } = await import("./seed");
  await seedDefaultRules();
  await seedDefaultAdmin();

  try { await fixReversalStatuses(); } catch {}
  try { await migratePasswordFields(); } catch {}

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const isMulterError = err.name === "MulterError" ||
      (err.message && /file type|mime type|file size/i.test(err.message));
    const status = isMulterError ? 400 : (err.status || err.statusCode || 500);

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    const clientMessage = status < 500
      ? (err.message || "Bad request")
      : `Internal server error: ${err.message || String(err)}`;

    return res.status(status).json({ message: clientMessage });
  });

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    try {
      const { setupVite } = await import("./vite");
      await setupVite(httpServer, app);
    } catch (e) {
      console.error("Vite dev server failed to start, falling back to static files:", e);
      try {
        serveStatic(app);
      } catch (e2) {
        console.error("Static files not found either. Run 'npx tsx script/build.ts' first, then use 'npm start'.");
      }
    }
  }

  httpServer.timeout = 1200000;
  httpServer.keepAliveTimeout = 300000;
  httpServer.headersTimeout = 1220000;

  const port = parseInt(process.env.PORT || "3000", 10);
  const listenOpts: any = { port, host: "0.0.0.0" };
  if (process.platform !== "win32") {
    listenOpts.reusePort = true;
  }
  httpServer.listen(listenOpts, async () => {
    log(`serving on port ${port}`);
    try {
      const result = await pool.query("SELECT 1 AS ok");
      log(`database: connected (${process.env.DATABASE_URL ? "DATABASE_URL set" : "DATABASE_URL MISSING"})`);
    } catch (err: any) {
      console.error(`[STARTUP] Database connection FAILED: ${err.message}`);
    }
    log(`platform: ${process.platform}, node: ${process.version}, mode: ${process.env.NODE_ENV || "development"}`);
    log(`cwd: ${process.cwd()}`);
    const tmpDir = path.join(os.tmpdir(), "ic-uploads");
    log(`temp upload dir: ${tmpDir}`);
  });

  const certsDir = path.join(process.cwd(), "certs");
  const keyPath = path.join(certsDir, "server.key");
  const certPath = path.join(certsDir, "server.cert");

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    try {
      const httpsOptions = {
        key: fs.readFileSync(keyPath),
        cert: fs.readFileSync(certPath),
      };
      const httpsPort = parseInt(process.env.HTTPS_PORT || "3443", 10);
      const httpsServer = https.createServer(httpsOptions, app);
      httpsServer.timeout = 1200000;
      httpsServer.keepAliveTimeout = 300000;
      httpsServer.headersTimeout = 1220000;
      httpsServer.listen(httpsPort, "0.0.0.0", () => {
        log(`HTTPS serving on port ${httpsPort}`);
      });
    } catch (err: any) {
      console.error(`[express] HTTPS setup failed: ${err.message}`);
      console.error("[express] Continuing with HTTP only");
    }
  } else {
    log(`HTTPS disabled (no certs found in certs/ folder)`);
  }
})();
