import type { Express, Request, Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { storage } from "../storage";
import { loginSchema } from "@shared/schema";
import { requireAuth, requireAdmin, userCache } from "../middleware/auth";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Too many login attempts. Please try again in 15 minutes." },
  skipSuccessfulRequests: true,
});

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_MAX_AGE_DAYS = 90;
const PASSWORD_RULES = [
  { test: (p: string) => p.length >= PASSWORD_MIN_LENGTH, msg: `At least ${PASSWORD_MIN_LENGTH} characters` },
  { test: (p: string) => /[A-Z]/.test(p), msg: "At least one uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), msg: "At least one lowercase letter" },
  { test: (p: string) => /[0-9]/.test(p), msg: "At least one number" },
  { test: (p: string) => /[!@#$%^&*()_+\-=\[\]{}|;':",.<>?\/\\`~]/.test(p), msg: "At least one special character (!@#$%^&*...)" },
];

function validatePasswordComplexity(password: string): string[] {
  return PASSWORD_RULES.filter(r => !r.test(password)).map(r => r.msg);
}

function isPasswordExpired(passwordChangedAt: string | null | undefined): boolean {
  if (!passwordChangedAt) return true;
  const changedDate = new Date(passwordChangedAt);
  const now = new Date();
  const diffDays = (now.getTime() - changedDate.getTime()) / (1000 * 60 * 60 * 24);
  return diffDays >= PASSWORD_MAX_AGE_DAYS;
}

function needsPasswordChange(user: any): boolean {
  if (user.mustChangePassword) return true;
  return isPasswordExpired(user.passwordChangedAt);
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/password-rules", (_req, res) => {
    res.json({
      rules: PASSWORD_RULES.map(r => r.msg),
      maxAgeDays: PASSWORD_MAX_AGE_DAYS,
      minLength: PASSWORD_MIN_LENGTH,
    });
  });

  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    try {
      const parsed = loginSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      const { username, password } = parsed.data;
      const user = await storage.getUserByUsername(username);
      if (!user) {
        return res.status(401).json({ message: "Invalid username or password" });
      }
      if (!user.active) {
        return res.status(403).json({ message: "Account is disabled. Contact your administrator." });
      }
      const valid = await bcrypt.compare(password, user.password);
      if (!valid) {
        return res.status(401).json({ message: "Invalid username or password" });
      }

      const mustChangePassword = needsPasswordChange(user);

      const loginModules = user.role === "platform_admin"
        ? ["ic_recon", "cashflow", "ic_matrix"]
        : (user.allowedModules || ["ic_recon", "cashflow", "ic_matrix"]);
      const userData = {
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        mustChangePassword,
        allowedModules: loginModules,
      };
      req.session.regenerate((err) => {
        if (err) {
          return res.status(500).json({ message: "Session error" });
        }
        req.session.userId = user.id;
        req.session.role = user.role;
        res.json(userData);
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy((err) => {
      if (err) return res.status(500).json({ message: "Logout failed" });
      res.clearCookie("connect.sid");
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    if (!req.session?.userId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const user = await storage.getUserById(req.session.userId);
    if (!user || !user.active) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Not authenticated" });
    }
    const modules = user.role === "platform_admin"
      ? ["ic_recon", "cashflow", "ic_matrix"]
      : (user.allowedModules || ["ic_recon", "cashflow", "ic_matrix"]);
    res.json({
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      role: user.role,
      mustChangePassword: needsPasswordChange(user),
      allowedModules: modules,
    });
  });

  app.get("/api/users", requireAdmin, async (_req, res) => {
    try {
      const allUsers = await storage.getUsers();
      res.json(allUsers.map(u => ({
        id: u.id,
        username: u.username,
        displayName: u.displayName,
        role: u.role,
        active: u.active,
        allowedModules: u.allowedModules || ["ic_recon", "cashflow", "ic_matrix"],
        createdAt: u.createdAt,
      })));
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/users", requireAdmin, async (req, res) => {
    try {
      const { username, password, displayName, role, allowedModules } = req.body;
      if (!username || !password) {
        return res.status(400).json({ message: "Username and password are required" });
      }
      if (role && !["platform_admin", "recon_user", "viewer"].includes(role)) {
        return res.status(400).json({ message: "Invalid role" });
      }
      const pwErrors = validatePasswordComplexity(password);
      if (pwErrors.length > 0) {
        return res.status(400).json({ message: "Password does not meet complexity requirements", errors: pwErrors });
      }
      const validModules = ["ic_recon", "cashflow", "ic_matrix"];
      const userModules = Array.isArray(allowedModules)
        ? allowedModules.filter((m: string) => validModules.includes(m))
        : validModules;
      const existing = await storage.getUserByUsername(username);
      if (existing) {
        return res.status(409).json({ message: "Username already exists" });
      }
      const hashedPassword = await bcrypt.hash(password, 12);
      const user = await storage.createUser({
        username,
        password: hashedPassword,
        displayName: displayName || username,
        role: role || "recon_user",
      });
      await storage.updateUser(user.id, {
        mustChangePassword: true,
        passwordChangedAt: new Date().toISOString(),
        allowedModules: userModules,
      } as any);
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.patch("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      const updates: any = {};
      if (req.body.displayName !== undefined) updates.displayName = req.body.displayName;
      if (req.body.role !== undefined) {
        if (!["platform_admin", "recon_user", "viewer"].includes(req.body.role)) {
          return res.status(400).json({ message: "Invalid role" });
        }
        updates.role = req.body.role;
      }
      if (req.body.active !== undefined) updates.active = req.body.active;
      if (req.body.allowedModules !== undefined) {
        const validModules = ["ic_recon", "cashflow", "ic_matrix"];
        updates.allowedModules = Array.isArray(req.body.allowedModules)
          ? req.body.allowedModules.filter((m: string) => validModules.includes(m))
          : validModules;
      }
      if (req.body.password) {
        const pwErrors = validatePasswordComplexity(req.body.password);
        if (pwErrors.length > 0) {
          return res.status(400).json({ message: "Password does not meet complexity requirements", errors: pwErrors });
        }
        updates.password = await bcrypt.hash(req.body.password, 12);
        updates.mustChangePassword = true;
        updates.passwordChangedAt = new Date().toISOString();
      }
      const user = await storage.updateUser(id, updates);
      if (!user) return res.status(404).json({ message: "User not found" });
      userCache.delete(id);
      res.json({
        id: user.id,
        username: user.username,
        displayName: user.displayName,
        role: user.role,
        active: user.active,
        allowedModules: user.allowedModules || ["ic_recon", "cashflow", "ic_matrix"],
        createdAt: user.createdAt,
      });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.delete("/api/users/:id", requireAdmin, async (req, res) => {
    try {
      const { id } = req.params;
      if (id === req.session?.userId) {
        return res.status(400).json({ message: "Cannot delete your own account" });
      }
      await storage.deleteUser(id);
      userCache.delete(id);
      res.json({ message: "User deleted" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });

  app.post("/api/auth/change-password", requireAuth, async (req, res) => {
    try {
      const { currentPassword, newPassword } = req.body;
      if (!currentPassword || !newPassword) {
        return res.status(400).json({ message: "Current and new password required" });
      }
      const user = await storage.getUserById(req.session!.userId!);
      if (!user) return res.status(401).json({ message: "Not authenticated" });
      const valid = await bcrypt.compare(currentPassword, user.password);
      if (!valid) return res.status(401).json({ message: "Current password is incorrect" });
      const pwErrors = validatePasswordComplexity(newPassword);
      if (pwErrors.length > 0) {
        return res.status(400).json({ message: "Password does not meet complexity requirements", errors: pwErrors });
      }
      const sameAsOld = await bcrypt.compare(newPassword, user.password);
      if (sameAsOld) {
        return res.status(400).json({ message: "New password must be different from your current password" });
      }
      const hashed = await bcrypt.hash(newPassword, 12);
      await storage.updateUser(user.id, {
        password: hashed,
        mustChangePassword: false,
        passwordChangedAt: new Date().toISOString(),
      } as any);
      res.json({ message: "Password changed successfully" });
    } catch (error: any) {
      res.status(500).json({ message: error.message });
    }
  });
}
