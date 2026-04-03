import type { Express } from "express";
import { createServer, type Server } from "http";
import { registerIcMatrixRoutes } from "./ic-matrix-routes";
import { registerCashflowRoutes } from "./cashflow-routes";
import { registerAuthRoutes } from "./routes/auth";
import { registerUploadRoutes } from "./routes/upload";
import { registerReconciliationRoutes } from "./routes/reconciliation";
import { registerReconGlRoutes } from "./routes/recon-gl";
import { registerMlRoutes } from "./routes/ml";
import { registerReportRoutes } from "./routes/reports";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  registerAuthRoutes(app);
  registerUploadRoutes(app);
  registerReconciliationRoutes(app);
  registerReconGlRoutes(app);
  registerMlRoutes(app);
  registerReportRoutes(app);
  registerIcMatrixRoutes(app);
  registerCashflowRoutes(app);

  return httpServer;
}
