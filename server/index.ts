import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";

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

app.use((req, res, next) => {
  if (req.path.startsWith("/api/upload") || req.path.startsWith("/api/recon/upload") || req.path.startsWith("/api/cashflow/upload")) {
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
      if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
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

  const { seedDefaultRules } = await import("./seed");
  await seedDefaultRules();

  const { seedDefaultAdmin } = await import("./seed");
  await seedDefaultAdmin();

  try {
    const { fixReversalStatuses } = await import("./seed");
    await fixReversalStatuses();
  } catch {}

  try {
    const { migratePasswordFields } = await import("./seed");
    await migratePasswordFields();
  } catch {}

  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
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
  httpServer.listen(listenOpts, () => {
    log(`serving on port ${port}`);
  });
})();
