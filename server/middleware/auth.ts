import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { LRUCache } from "lru-cache";

export const userCache = new LRUCache<string, { active: boolean; role: string }>({ max: 200, ttl: 60_000 });

async function resolveUser(req: Request, res: Response): Promise<{ active: boolean; role: string } | null> {
  if (!req.session?.userId) {
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }

  let userData = userCache.get(req.session.userId);
  if (!userData) {
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      res.status(401).json({ message: "Not authenticated" });
      return null;
    }
    userData = { active: !!user.active, role: user.role };
    userCache.set(req.session.userId, userData);
  }

  if (!userData.active) {
    req.session.destroy(() => {});
    res.status(401).json({ message: "Not authenticated" });
    return null;
  }

  return userData;
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  const userData = await resolveUser(req, res);
  if (!userData) return;
  req.session.role = userData.role;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const userData = await resolveUser(req, res);
  if (!userData) return;
  if (userData.role !== "platform_admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  req.session.role = userData.role;
  next();
}

export async function requireWriteAccess(req: Request, res: Response, next: NextFunction) {
  const userData = await resolveUser(req, res);
  if (!userData) return;
  if (userData.role === "recon_viewer") {
    return res.status(403).json({ message: "Write access required" });
  }
  req.session.role = userData.role;
  next();
}
