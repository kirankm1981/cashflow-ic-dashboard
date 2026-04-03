import { db } from "./db";
import { reconciliationRules, users } from "@shared/schema";
import bcrypt from "bcryptjs";

export async function seedDefaultRules() {
  const existing = await db.select().from(reconciliationRules);
  const existingIds = new Set(existing.map(r => r.ruleId));

  const defaultRules = [
    {
      ruleId: "IC-R1",
      name: "Invoice/Reference Match",
      ruleType: "invoice_match",
      matchType: "1:1",
      priority: 1,
      dateTolerance: null,
      amountTolerance: 5,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "AUTO_MATCH",
      active: true,
      description: "Phase 7 (Reference): Invoice/Bill reference extracted from narration matches exactly. Highest confidence — requires regex extraction from narration.",
      params: null,
    },
    {
      ruleId: "IC-R2",
      name: "Exact Date + Exact Amount",
      ruleType: "exact_match",
      matchType: "1:1",
      priority: 2,
      dateTolerance: 0,
      amountTolerance: 0,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "AUTO_MATCH",
      active: true,
      description: "Phase 1 (R01): Exact amount with same-day posting. Highest confidence 1:1 match. Covers ~32% of dataset.",
      params: null,
    },
    {
      ruleId: "IC-R3",
      name: "Exact Amount + Date ±5 days",
      ruleType: "date_range_match",
      matchType: "1:1",
      priority: 3,
      dateTolerance: 5,
      amountTolerance: 1,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "AUTO_MATCH",
      active: true,
      description: "Phase 1-2 (R01-R06): Exact amount (±1 rounding) with short date window. Handles posting delays and rounding differences.",
      params: null,
    },
    {
      ruleId: "IC-R4",
      name: "Aggregation Match (exact date)",
      ruleType: "exact_aggregation",
      matchType: "1:M",
      priority: 4,
      dateTolerance: 0,
      amountTolerance: 1,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "AUTO_MATCH",
      active: true,
      description: "Phase 4 (R13-R14): Many:1 / 1:Many exact sum match on same date. Max 5 txns on many side. Common for consolidated payments.",
      params: JSON.stringify({ maxGroupSize: 5 }),
    },
    {
      ruleId: "IC-R5",
      name: "Aggregation Match + Date ±5 days",
      ruleType: "date_range_aggregation",
      matchType: "1:M",
      priority: 5,
      dateTolerance: 5,
      amountTolerance: 1,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "AUTO_MATCH",
      active: true,
      description: "Phase 4 (R13-R14): Aggregation with ±3-5 day tolerance. Max 5 txns. Captures split entries with minor booking delays.",
      params: JSON.stringify({ maxGroupSize: 5 }),
    },
    {
      ruleId: "IC-R10",
      name: "Exact Amount (no date constraint)",
      ruleType: "amount_only_match",
      matchType: "1:1",
      priority: 6,
      dateTolerance: null,
      amountTolerance: 1,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "REVIEW_MATCH",
      active: true,
      description: "Phase 1 (R04 extended): Exact amount match with dates ignored. Needs human review for timing differences beyond 30 days.",
      params: null,
    },
    {
      ruleId: "IC-R11",
      name: "Narration Fuzzy Match",
      ruleType: "fuzzy_narration_match",
      matchType: "1:1",
      priority: 7,
      dateTolerance: null,
      amountTolerance: 100,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "REVIEW_MATCH",
      active: true,
      description: "Phase 7 (R28): Narration keyword similarity ≥70%. Amount tolerance ±100 for TDS/GST differences. Best for ranking manual review queue.",
      params: JSON.stringify({ fuzzyThreshold: 0.7, minNarrationLength: 20 }),
    },
    {
      ruleId: "IC-R12",
      name: "Aggregated Amount (no date constraint)",
      ruleType: "amount_only_aggregation",
      matchType: "M:M",
      priority: 8,
      dateTolerance: null,
      amountTolerance: 100,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "REVIEW_MATCH",
      active: true,
      description: "Phase 5-6 (R21-R25): M:M aggregation with ±100 amount tolerance. Wider tolerance for grouped transactions. Max 5 per side.",
      params: JSON.stringify({ maxGroupSize: 5 }),
    },
    {
      ruleId: "IC-R1B",
      name: "Cheque Number Match",
      ruleType: "cheque_match",
      matchType: "1:1",
      priority: 9,
      dateTolerance: null,
      amountTolerance: 100,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Phase 7 (Reference): Cheque number cross-match between counterparties. Amount tolerance ±100 handles TDS deductions on cheque payments. No date constraint.",
      params: null,
    },
    {
      ruleId: "IC-R6",
      name: "Exact Amount + Date ±15 days",
      ruleType: "date_range_match",
      matchType: "1:1",
      priority: 10,
      dateTolerance: 15,
      amountTolerance: 1,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Phase 1 (R03): Wider date window for month-end cutoff differences. Exact amount provides confidence despite date gap.",
      params: null,
    },
    {
      ruleId: "IC-R7",
      name: "Amount ±100 + Date ±5 days",
      ruleType: "date_range_match",
      matchType: "1:1",
      priority: 11,
      dateTolerance: 5,
      amountTolerance: 100,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Phase 3 (R09-R10): Covers TDS rate differences, GST rounding. Short date window adds confidence.",
      params: null,
    },
    {
      ruleId: "IC-R8",
      name: "Aggregation + Date ±15 days",
      ruleType: "date_range_aggregation",
      matchType: "1:M",
      priority: 12,
      dateTolerance: 15,
      amountTolerance: 1,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Phase 4 (R15-R16): Aggregation with wider date window. Max 10 txns. Typical for payroll/salary remittances.",
      params: JSON.stringify({ maxGroupSize: 10 }),
    },
    {
      ruleId: "IC-R9",
      name: "Monthly Aggregation Match",
      ruleType: "monthly_aggregation",
      matchType: "M:M",
      priority: 13,
      dateTolerance: null,
      amountTolerance: 100,
      amountTolerancePct: 0,
      confidence: "probable_match",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Gap Closure Phase A: Groups all unmatched transactions by IC pair + calendar month. Matches if monthly totals net to zero. Addresses deep Many:Many patterns.",
      params: null,
    },
    {
      ruleId: "IC-R13",
      name: "Combined Scoring (AI)",
      ruleType: "combined_scoring",
      matchType: "1:M",
      priority: 14,
      dateTolerance: null,
      amountTolerance: 0,
      amountTolerancePct: 0.05,
      confidence: "suggestion",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Gap Closure Phase C: Weighted scoring — Amount (50pts) + Date proximity (30pts) + Narration similarity (20pts). Confidence auto-adjusted by scoring layer.",
      params: JSON.stringify({ scoreThreshold: 50, amountWeight: 50, dateWeight: 30, narrationWeight: 20 }),
    },
    {
      ruleId: "IC-R14",
      name: "Wide Amount % Tolerance (1%)",
      ruleType: "amount_only_match",
      matchType: "1:1",
      priority: 15,
      dateTolerance: null,
      amountTolerance: 0,
      amountTolerancePct: 0.01,
      confidence: "suggestion",
      classification: "SUGGESTED_MATCH",
      active: true,
      description: "Phase 3 extended: Catches FX conversion differences and rounding — amount within 1% tolerance.",
      params: null,
    },
    {
      ruleId: "IC-R15",
      name: "Reversal Transactions",
      ruleType: "reversal_match",
      matchType: "1:M",
      priority: 16,
      dateTolerance: 5,
      amountTolerance: 5,
      amountTolerancePct: 0,
      confidence: "real_match",
      classification: "REVERSAL",
      active: true,
      description: "Phase 8 (R29-R30): Same-entity reversal matching. ALWAYS runs after all IC rules. Matches offsetting Dr/Cr entries within same entity (Company=CounterParty). ±5 day tolerance for cross-entity reversals, no date constraint for self-IC reversals. Includes 1:M aggregation for split reversals.",
      params: null,
    },
  ];

  const priorityMap: Record<string, number> = {};
  for (const r of defaultRules) {
    priorityMap[r.ruleId] = r.priority;
  }
  const { eq } = await import("drizzle-orm");
  for (const r of existing) {
    if (priorityMap[r.ruleId] !== undefined && r.priority !== priorityMap[r.ruleId]) {
      await db.update(reconciliationRules)
        .set({ priority: priorityMap[r.ruleId] })
        .where(eq(reconciliationRules.ruleId, r.ruleId));
    }
  }

  const deprecatedRuleIds = ["IC-R16"];
  const toDelete = existing.filter(r => deprecatedRuleIds.includes(r.ruleId));
  if (toDelete.length > 0) {
    for (const r of toDelete) {
      await db.delete(reconciliationRules).where(eq(reconciliationRules.ruleId, r.ruleId));
    }
    console.log(`Removed deprecated rules: ${toDelete.map(r => r.ruleId).join(', ')}`);
  }

  const newRules = defaultRules.filter(r => !existingIds.has(r.ruleId));
  if (newRules.length > 0) {
    await db.insert(reconciliationRules).values(newRules);
    console.log(`Seeded ${newRules.length} reconciliation rules: ${newRules.map(r => r.ruleId).join(', ')}`);
  }
}

export async function fixReversalStatuses() {
  const { eq, and, sql } = await import("drizzle-orm");
  const reversalRules = await db.select().from(reconciliationRules)
    .where(eq(reconciliationRules.ruleType, "reversal_match"));
  if (reversalRules.length === 0) return;

  const ruleNames = reversalRules.map(r => r.name);
  for (const ruleName of ruleNames) {
    const result = await db.execute(sql`
      UPDATE summarized_lines 
      SET recon_status = 'reversal' 
      WHERE recon_rule = ${ruleName} 
      AND recon_status = 'matched'
    `);
    const count = (result as any).rowCount || 0;
    if (count > 0) {
      console.log(`Fixed ${count} reversal transactions (rule: ${ruleName}) from 'matched' to 'reversal'`);
      await db.execute(sql`
        UPDATE reconciliation_groups
        SET status = 'reversal'
        WHERE rule_name = ${ruleName}
        AND status = 'matched'
      `);
    }
  }
}

export async function seedDefaultAdmin(adminPassword?: string) {
  const existing = await db.select().from(users);
  if (existing.length === 0) {
    const password = adminPassword || process.env.ADMIN_PASSWORD || "admin";
    const mustChange = !adminPassword && !process.env.ADMIN_PASSWORD;
    const hashedPassword = await bcrypt.hash(password, 10);
    await db.insert(users).values({
      username: "admin",
      password: hashedPassword,
      displayName: "Platform Admin",
      role: "platform_admin",
      mustChangePassword: mustChange,
      passwordChangedAt: new Date().toISOString(),
      allowedModules: ["ic_recon", "cashflow", "ic_matrix"],
    });
    console.log("Seeded default admin user");
  }
}

export async function migratePasswordFields() {
  const { eq, isNull } = await import("drizzle-orm");
  const allUsers = await db.select().from(users);
  for (const u of allUsers) {
    const updates: any = {};
    if (u.passwordChangedAt === null || u.passwordChangedAt === undefined) {
      updates.passwordChangedAt = new Date().toISOString();
      if (u.mustChangePassword === null || u.mustChangePassword === undefined) {
        updates.mustChangePassword = u.role === "platform_admin" ? false : true;
      }
    }
    if (!u.allowedModules || u.allowedModules.length === 0) {
      updates.allowedModules = ["ic_recon", "cashflow", "ic_matrix"];
    }
    if (Object.keys(updates).length > 0) {
      await db.update(users).set(updates).where(eq(users.id, u.id));
    }
  }
  console.log("Migrated password fields and module access for existing users");
}
