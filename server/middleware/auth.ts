import type { Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { LRUCache } from "lru-cache";

export const userCache = new LRUCache<string, { active: boolean; role: string }>({ max: 200, ttl: 60_000 });

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  let userData = userCache.get(req.session.userId);
  if (!userData) {
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Not authenticated" });
    }
    userData = { active: user.active, role: user.role };
    userCache.set(req.session.userId, userData);
  }

  if (!userData.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Not authenticated" });
  }
  req.session.role = userData.role;
  next();
}

export async function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session?.userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }

  let userData = userCache.get(req.session.userId);
  if (!userData) {
    const user = await storage.getUserById(req.session.userId);
    if (!user) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Not authenticated" });
    }
    userData = { active: user.active, role: user.role };
    userCache.set(req.session.userId, userData);
  }

  if (!userData.active) {
    req.session.destroy(() => {});
    return res.status(401).json({ message: "Not authenticated" });
  }
  if (userData.role !== "platform_admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  req.session.role = userData.role;
  next();
}
