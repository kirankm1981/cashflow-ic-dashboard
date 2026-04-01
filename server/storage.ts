import { eq, and, desc, asc, inArray, or, isNull, sql } from "drizzle-orm";
import { db } from "./db";
import {
  users,
  transactions,
  summarizedLines,
  reconciliationRules,
  reconciliationGroups,
  uploadBatches,
  icReconGlFiles,
  mlMatchPatterns,
  matchConfidenceScores,
  anomalyFlags,
  unmatchedClassifications,
  mlSuggestions,
  dashboardSettings,
  type InsertUser,
  type User,
  type InsertTransaction,
  type InsertSummarizedLine,
  type InsertRule,
  type InsertReconGroup,
  type InsertUploadBatch,
  type InsertMlMatchPattern,
  type InsertMatchConfidence,
  type InsertAnomalyFlag,
  type InsertUnmatchedClassification,
  type InsertMlSuggestion,
  type Transaction,
  type SummarizedLine,
  type Rule,
  type ReconGroup,
  type UploadBatch,
  type MlMatchPattern,
  type MatchConfidence,
  type AnomalyFlag,
  type UnmatchedClassification,
  type MlSuggestion,
} from "@shared/schema";

export interface IStorage {
  getUserByUsername(username: string): Promise<User | undefined>;
  getUserById(id: string): Promise<User | undefined>;
  getUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;
  updateUser(id: string, updates: Partial<InsertUser & { active: boolean }>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;

  getTransactions(filters?: {
    company?: string;
    counterParty?: string;
    reconStatus?: string;
    uploadBatchId?: string;
  }): Promise<Transaction[]>;
  getTransactionById(id: number): Promise<Transaction | undefined>;
  getTransactionsByIds(ids: number[]): Promise<Transaction[]>;
  insertTransactions(txns: InsertTransaction[]): Promise<Transaction[]>;
  updateTransactionRecon(
    ids: number[],
    reconId: string,
    reconRule: string,
    status: string
  ): Promise<void>;
  resetReconciliation(): Promise<void>;

  getRules(): Promise<Rule[]>;
  getActiveRules(): Promise<Rule[]>;
  getRuleById(id: number): Promise<Rule | undefined>;
  insertRule(rule: InsertRule): Promise<Rule>;
  updateRule(id: number, rule: Partial<InsertRule>): Promise<Rule | undefined>;
  deleteRule(id: number): Promise<void>;

  getReconGroups(): Promise<ReconGroup[]>;
  insertReconGroup(group: InsertReconGroup): Promise<ReconGroup>;
  unmatchReconGroup(reconId: string): Promise<number>;

  getUploadBatches(): Promise<UploadBatch[]>;
  insertUploadBatch(batch: InsertUploadBatch): Promise<UploadBatch>;

  getDashboardStats(): Promise<{
    totalTransactions: number;
    matchedTransactions: number;
    unmatchedTransactions: number;
    matchRate: number;
    totalDebit: number;
    totalCredit: number;
    companySummary: { company: string; total: number; matched: number; reversal: number; review: number; suggested: number; unmatched: number }[];
    ruleBreakdown: { rule: string; count: number; matchType: string }[];
    statusBreakdown: { status: string; count: number }[];
    glSources: { label: string; enterpriseName: string | null; reportPeriod: string | null; icRecords: number }[];
  }>;

  getSummarizedLines(filters?: {
    company?: string;
    companies?: string[];
    counterParty?: string;
    counterParties?: string[];
    reconStatus?: string;
    reconId?: string;
  }): Promise<SummarizedLine[]>;
  getSummarizedLinesByIds(ids: number[]): Promise<SummarizedLine[]>;
  insertSummarizedLines(lines: InsertSummarizedLine[]): Promise<SummarizedLine[]>;
  updateSummarizedLineRecon(
    ids: number[],
    reconId: string,
    reconRule: string,
    status: string,
    confidenceData?: { tier?: string; score?: number; amountDiff?: number; dateDiff?: number }
  ): Promise<void>;
  updateSummarizedLineCounterParty(id: number, counterParty: string): Promise<void>;
  resetSummarizedLines(): Promise<void>;

  getCompanies(): Promise<string[]>;
  getCounterParties(): Promise<string[]>;
  getCompanyPairs(): Promise<{
    company: string;
    counterParty: string;
    total: number;
    matched: number;
    unmatched: number;
    totalDebit: number;
    totalCredit: number;
  }[]>;

  getMlMatchPatterns(): Promise<MlMatchPattern[]>;
  findMlMatchPattern(companyA: string, companyB: string): Promise<MlMatchPattern | undefined>;
  insertMlMatchPattern(pattern: InsertMlMatchPattern): Promise<MlMatchPattern>;
  updateMlMatchPattern(id: number, updates: Partial<InsertMlMatchPattern>): Promise<void>;
  deleteMlMatchPattern(id: number): Promise<void>;

  getMatchConfidenceScores(reconId?: string): Promise<MatchConfidence[]>;
  insertMatchConfidenceScores(scores: InsertMatchConfidence[]): Promise<void>;
  clearMatchConfidenceScores(): Promise<void>;

  getAnomalyFlags(resolved?: boolean): Promise<AnomalyFlag[]>;
  insertAnomalyFlags(flags: InsertAnomalyFlag[]): Promise<void>;
  resolveAnomalyFlag(id: number): Promise<void>;
  clearAnomalyFlags(): Promise<void>;

  getUnmatchedClassifications(): Promise<UnmatchedClassification[]>;
  insertUnmatchedClassifications(classifications: InsertUnmatchedClassification[]): Promise<void>;
  clearUnmatchedClassifications(): Promise<void>;

  getMlSuggestions(status?: string): Promise<MlSuggestion[]>;
  insertMlSuggestions(suggestions: InsertMlSuggestion[]): Promise<void>;
  updateMlSuggestionStatus(id: number, status: string): Promise<void>;
  clearMlSuggestions(): Promise<void>;
}

const MATCHED_STATUSES = ["matched", "reversal", "review_match", "suggested_match"];

function isMatchedStatus(status: string): boolean {
  return MATCHED_STATUSES.includes(status);
}

export class DatabaseStorage implements IStorage {
  async getUserByUsername(username: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.username, username));
    return row;
  }

  async getUserById(id: string): Promise<User | undefined> {
    const [row] = await db.select().from(users).where(eq(users.id, id));
    return row;
  }

  async getUsers(): Promise<User[]> {
    return await db.select().from(users).orderBy(asc(users.username));
  }

  async createUser(user: InsertUser): Promise<User> {
    const [inserted] = await db.insert(users).values(user).returning();
    return inserted;
  }

  async updateUser(id: string, updates: Partial<InsertUser & { active: boolean }>): Promise<User | undefined> {
    const [updated] = await db.update(users).set(updates).where(eq(users.id, id)).returning();
    return updated;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async getTransactions(filters?: {
    company?: string;
    counterParty?: string;
    reconStatus?: string;
    uploadBatchId?: string;
  }): Promise<Transaction[]> {
    const conditions = [];
    if (filters?.company) conditions.push(eq(transactions.company, filters.company));
    if (filters?.counterParty) conditions.push(eq(transactions.counterParty, filters.counterParty));
    if (filters?.reconStatus) conditions.push(eq(transactions.reconStatus, filters.reconStatus));
    if (filters?.uploadBatchId) conditions.push(eq(transactions.uploadBatchId, filters.uploadBatchId));

    if (conditions.length > 0) {
      return await db.select().from(transactions).where(and(...conditions)).orderBy(desc(transactions.id));
    }
    return await db.select().from(transactions).orderBy(desc(transactions.id));
  }

  async getTransactionById(id: number): Promise<Transaction | undefined> {
    const [row] = await db.select().from(transactions).where(eq(transactions.id, id));
    return row;
  }

  async getTransactionsByIds(ids: number[]): Promise<Transaction[]> {
    if (ids.length === 0) return [];
    return await db.select().from(transactions).where(inArray(transactions.id, ids));
  }

  async insertTransactions(txns: InsertTransaction[]): Promise<Transaction[]> {
    if (txns.length === 0) return [];
    const results: Transaction[] = [];
    const batchSize = 500;
    for (let i = 0; i < txns.length; i += batchSize) {
      const batch = txns.slice(i, i + batchSize);
      const inserted = await db.insert(transactions).values(batch).returning();
      results.push(...inserted);
    }
    return results;
  }

  async updateTransactionRecon(
    ids: number[],
    reconId: string,
    reconRule: string,
    status: string
  ): Promise<void> {
    if (ids.length === 0) return;
    await db.update(transactions)
      .set({ reconId, reconRule, reconStatus: status })
      .where(inArray(transactions.id, ids));
  }

  async resetReconciliation(): Promise<void> {
    await db.update(transactions)
      .set({ reconId: null, reconRule: null, reconStatus: "unmatched" });
    await db.delete(reconciliationGroups);
  }

  async getRules(): Promise<Rule[]> {
    return await db.select().from(reconciliationRules).orderBy(asc(reconciliationRules.priority));
  }

  async getActiveRules(): Promise<Rule[]> {
    return await db
      .select()
      .from(reconciliationRules)
      .where(eq(reconciliationRules.active, true))
      .orderBy(asc(reconciliationRules.priority));
  }

  async getRuleById(id: number): Promise<Rule | undefined> {
    const [row] = await db.select().from(reconciliationRules).where(eq(reconciliationRules.id, id));
    return row;
  }

  async insertRule(rule: InsertRule): Promise<Rule> {
    const [inserted] = await db.insert(reconciliationRules).values(rule).returning();
    return inserted;
  }

  async updateRule(id: number, rule: Partial<InsertRule>): Promise<Rule | undefined> {
    const [updated] = await db
      .update(reconciliationRules)
      .set(rule)
      .where(eq(reconciliationRules.id, id))
      .returning();
    return updated;
  }

  async deleteRule(id: number): Promise<void> {
    await db.delete(reconciliationRules).where(eq(reconciliationRules.id, id));
  }

  async getReconGroups(): Promise<ReconGroup[]> {
    return await db.select().from(reconciliationGroups).orderBy(desc(reconciliationGroups.createdAt));
  }

  async insertReconGroup(group: InsertReconGroup): Promise<ReconGroup> {
    const [inserted] = await db.insert(reconciliationGroups).values(group).returning();
    return inserted;
  }

  async unmatchReconGroup(reconId: string): Promise<number> {
    const affected = await db.update(summarizedLines)
      .set({ reconId: null, reconRule: null, reconStatus: "unmatched" })
      .where(eq(summarizedLines.reconId, reconId))
      .returning();
    await db.delete(reconciliationGroups)
      .where(eq(reconciliationGroups.reconId, reconId));
    return affected.length;
  }

  async getUploadBatches(): Promise<UploadBatch[]> {
    return await db.select().from(uploadBatches).orderBy(desc(uploadBatches.uploadedAt));
  }

  async insertUploadBatch(batch: InsertUploadBatch): Promise<UploadBatch> {
    const [inserted] = await db.insert(uploadBatches).values(batch).returning();
    return inserted;
  }

  async getDashboardStats() {
    const allLines = await db.select().from(summarizedLines);
    const totalTransactions = allLines.length;
    const matchedTransactions = allLines.filter((t) => isMatchedStatus(t.reconStatus || "")).length;
    const unmatchedTransactions = totalTransactions - matchedTransactions;

    const matchRate = totalTransactions > 0 ? (matchedTransactions / totalTransactions) * 100 : 0;

    const totalDebit = allLines.reduce((sum, t) => sum + Math.max(t.netAmount || 0, 0), 0);
    const totalCredit = allLines.reduce((sum, t) => sum + Math.abs(Math.min(t.netAmount || 0, 0)), 0);

    const companyMap = new Map<string, { total: number; matched: number; reversal: number; review: number; suggested: number; unmatched: number; icTotal: number; icReconciled: number }>();
    for (const t of allLines) {
      const key = t.company;
      if (!companyMap.has(key)) companyMap.set(key, { total: 0, matched: 0, reversal: 0, review: 0, suggested: 0, unmatched: 0, icTotal: 0, icReconciled: 0 });
      const entry = companyMap.get(key)!;
      entry.total++;
      const s = t.reconStatus || "unmatched";
      if (s === "matched" || s === "manual") entry.matched++;
      else if (s === "reversal") entry.reversal++;
      else if (s === "review_match") entry.review++;
      else if (s === "suggested_match") entry.suggested++;
      else entry.unmatched++;

      const isSameEntity = t.company === t.counterParty;
      if (!isSameEntity && s !== "reversal") {
        entry.icTotal++;
        if (s === "matched" || s === "manual" || s === "review_match" || s === "suggested_match") {
          entry.icReconciled++;
        }
      }
    }
    const companySummary = Array.from(companyMap.entries()).map(([company, stats]) => ({
      company,
      ...stats,
    }));

    const ruleMap = new Map<string, number>();
    for (const t of allLines) {
      if (t.reconRule) {
        ruleMap.set(t.reconRule, (ruleMap.get(t.reconRule) || 0) + 1);
      }
    }

    const allRules = await db.select().from(reconciliationRules).orderBy(asc(reconciliationRules.priority));
    const ruleBreakdown = allRules.map((r) => ({
      rule: r.name,
      count: ruleMap.get(r.name) || 0,
      matchType: r.classification || "AUTO_MATCH",
    }));

    const statusMap = new Map<string, number>();
    for (const t of allLines) {
      const s = t.reconStatus || "unmatched";
      statusMap.set(s, (statusMap.get(s) || 0) + 1);
    }
    const statusBreakdown = Array.from(statusMap.entries()).map(([status, count]) => ({ status, count }));

    const glFilesList = await db.select().from(icReconGlFiles);
    const glSources = glFilesList.map(f => {
      let eName = f.enterpriseName || null;
      let rPeriod = f.reportPeriod || null;
      if (!rPeriod) {
        const m = (f.fileName || "").match(/\(([A-Za-z]{3,9}\s*'?\d{2,4}\s+to\s+[A-Za-z]{3,9}\s*'?\d{2,4})\)/i)
          || (f.fileName || "").match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4}\s*(?:to|-)\s*(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s*'?\d{2,4})/i);
        if (m) rPeriod = m[1].trim();
      }
      if (!eName) {
        const m2 = (f.fileName || "").match(/\d+\s*(?:AM|PM)\s+([\w\s]+?)(?:\s*\()/i);
        if (m2) eName = m2[1].trim();
      }
      return {
        label: f.label,
        enterpriseName: eName,
        reportPeriod: rPeriod,
        icRecords: f.icRecords || 0,
      };
    });

    return {
      totalTransactions,
      matchedTransactions,
      unmatchedTransactions,
      matchRate,
      totalDebit,
      totalCredit,
      companySummary,
      ruleBreakdown,
      statusBreakdown,
      glSources,
    };
  }

  async getSummarizedLines(filters?: {
    company?: string;
    companies?: string[];
    counterParty?: string;
    counterParties?: string[];
    reconStatus?: string;
    reconId?: string;
  }): Promise<SummarizedLine[]> {
    const conditions = [];
    if (filters?.companies && filters.companies.length > 0) {
      conditions.push(inArray(summarizedLines.company, filters.companies));
    } else if (filters?.company) {
      conditions.push(eq(summarizedLines.company, filters.company));
    }
    if (filters?.counterParties && filters.counterParties.length > 0) {
      conditions.push(inArray(summarizedLines.counterParty, filters.counterParties));
    } else if (filters?.counterParty) {
      conditions.push(eq(summarizedLines.counterParty, filters.counterParty));
    }
    if (filters?.reconStatus) {
      if (filters.reconStatus === "unmatched") {
        conditions.push(or(eq(summarizedLines.reconStatus, "unmatched"), isNull(summarizedLines.reconStatus)));
      } else {
        conditions.push(eq(summarizedLines.reconStatus, filters.reconStatus));
      }
    }
    if (filters?.reconId) conditions.push(eq(summarizedLines.reconId, filters.reconId));

    if (conditions.length > 0) {
      return await db.select().from(summarizedLines).where(and(...conditions)).orderBy(desc(summarizedLines.id));
    }
    return await db.select().from(summarizedLines).orderBy(desc(summarizedLines.id));
  }

  async getSummarizedLinesByIds(ids: number[]): Promise<SummarizedLine[]> {
    if (ids.length === 0) return [];
    return await db.select().from(summarizedLines).where(inArray(summarizedLines.id, ids));
  }

  async insertSummarizedLines(lines: InsertSummarizedLine[]): Promise<SummarizedLine[]> {
    if (lines.length === 0) return [];
    const results: SummarizedLine[] = [];
    const batchSize = 500;
    for (let i = 0; i < lines.length; i += batchSize) {
      const batch = lines.slice(i, i + batchSize);
      const inserted = await db.insert(summarizedLines).values(batch).returning();
      results.push(...inserted);
    }
    return results;
  }

  async updateSummarizedLineCounterParty(id: number, counterParty: string): Promise<void> {
    await db.update(summarizedLines)
      .set({ counterParty })
      .where(eq(summarizedLines.id, id));
  }

  async updateSummarizedLineRecon(
    ids: number[],
    reconId: string,
    reconRule: string,
    status: string,
    confidenceData?: { tier?: string; score?: number; amountDiff?: number; dateDiff?: number }
  ): Promise<void> {
    if (ids.length === 0) return;
    const setData: any = { reconId, reconRule, reconStatus: status };
    if (confidenceData) {
      if (confidenceData.tier) setData.confidenceTier = confidenceData.tier;
      if (confidenceData.score !== undefined) setData.confidenceScore = confidenceData.score;
      if (confidenceData.amountDiff !== undefined) setData.amountDiff = confidenceData.amountDiff;
      if (confidenceData.dateDiff !== undefined) setData.dateDiff = confidenceData.dateDiff;
    }
    await db.update(summarizedLines)
      .set(setData)
      .where(inArray(summarizedLines.id, ids));
  }

  async resetSummarizedLines(): Promise<void> {
    await db.delete(summarizedLines)
      .where(eq(summarizedLines.netAmount, 0));
    await db.update(summarizedLines)
      .set({ reconId: null, reconRule: null, reconStatus: "unmatched" })
      .where(sql`NOT (${summarizedLines.reconRule} = 'Manual Match' OR ${summarizedLines.reconRule} LIKE 'Manual Upload%')`);
    await db.delete(reconciliationGroups)
      .where(sql`NOT (${reconciliationGroups.ruleName} = 'Manual Match' OR ${reconciliationGroups.ruleName} LIKE 'Manual Upload%')`);
  }

  async getCompanies(): Promise<string[]> {
    const result = await db
      .selectDistinct({ company: summarizedLines.company })
      .from(summarizedLines);
    return result.map((r) => r.company);
  }

  async getCounterParties(): Promise<string[]> {
    const result = await db
      .selectDistinct({ counterParty: summarizedLines.counterParty })
      .from(summarizedLines);
    return result.map((r) => r.counterParty);
  }

  async getCompanyPairs() {
    const allLines = await db.select().from(summarizedLines);
    const pairMap = new Map<string, {
      company: string;
      counterParty: string;
      total: number;
      matched: number;
      unmatched: number;
      totalDebit: number;
      totalCredit: number;
    }>();

    for (const t of allLines) {
      const sorted = [t.company, t.counterParty].sort();
      const key = `${sorted[0]}||${sorted[1]}`;
      if (!pairMap.has(key)) {
        pairMap.set(key, {
          company: sorted[0],
          counterParty: sorted[1],
          total: 0,
          matched: 0,
          unmatched: 0,
          totalDebit: 0,
          totalCredit: 0,
        });
      }
      const entry = pairMap.get(key)!;
      entry.total++;
      if (isMatchedStatus(t.reconStatus || "")) entry.matched++;
      else entry.unmatched++;
      entry.totalDebit += Math.max(t.netAmount || 0, 0);
      entry.totalCredit += Math.abs(Math.min(t.netAmount || 0, 0));
    }

    return Array.from(pairMap.values()).sort((a, b) => b.total - a.total);
  }

  async getMlMatchPatterns(): Promise<MlMatchPattern[]> {
    return await db.select().from(mlMatchPatterns).orderBy(desc(mlMatchPatterns.occurrences));
  }

  async findMlMatchPattern(companyA: string, companyB: string): Promise<MlMatchPattern | undefined> {
    const a = companyA.trim().toUpperCase();
    const b = companyB.trim().toUpperCase();
    const all = await db.select().from(mlMatchPatterns);
    return all.find(p => {
      const pA = (p.companyA || "").trim().toUpperCase();
      const pB = (p.companyB || "").trim().toUpperCase();
      return (pA === a && pB === b) || (pA === b && pB === a);
    });
  }

  async insertMlMatchPattern(pattern: InsertMlMatchPattern): Promise<MlMatchPattern> {
    const [inserted] = await db.insert(mlMatchPatterns).values(pattern).returning();
    return inserted;
  }

  async updateMlMatchPattern(id: number, updates: Partial<InsertMlMatchPattern>): Promise<void> {
    await db.update(mlMatchPatterns).set(updates).where(eq(mlMatchPatterns.id, id));
  }

  async deleteMlMatchPattern(id: number): Promise<void> {
    await db.delete(mlMatchPatterns).where(eq(mlMatchPatterns.id, id));
  }

  async getMatchConfidenceScores(reconId?: string): Promise<MatchConfidence[]> {
    if (reconId) {
      return await db.select().from(matchConfidenceScores).where(eq(matchConfidenceScores.reconId, reconId));
    }
    return await db.select().from(matchConfidenceScores).orderBy(desc(matchConfidenceScores.overallScore));
  }

  async insertMatchConfidenceScores(scores: InsertMatchConfidence[]): Promise<void> {
    if (scores.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < scores.length; i += batchSize) {
      await db.insert(matchConfidenceScores).values(scores.slice(i, i + batchSize));
    }
  }

  async clearMatchConfidenceScores(): Promise<void> {
    await db.delete(matchConfidenceScores);
  }

  async getAnomalyFlags(resolved?: boolean): Promise<AnomalyFlag[]> {
    if (resolved !== undefined) {
      return await db.select().from(anomalyFlags).where(eq(anomalyFlags.resolved, resolved)).orderBy(desc(anomalyFlags.id));
    }
    return await db.select().from(anomalyFlags).orderBy(desc(anomalyFlags.id));
  }

  async insertAnomalyFlags(flags: InsertAnomalyFlag[]): Promise<void> {
    if (flags.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < flags.length; i += batchSize) {
      await db.insert(anomalyFlags).values(flags.slice(i, i + batchSize));
    }
  }

  async resolveAnomalyFlag(id: number): Promise<void> {
    await db.update(anomalyFlags).set({ resolved: true }).where(eq(anomalyFlags.id, id));
  }

  async clearAnomalyFlags(): Promise<void> {
    await db.delete(anomalyFlags);
  }

  async getUnmatchedClassifications(): Promise<UnmatchedClassification[]> {
    return await db.select().from(unmatchedClassifications).orderBy(desc(unmatchedClassifications.confidence));
  }

  async insertUnmatchedClassifications(classifications: InsertUnmatchedClassification[]): Promise<void> {
    if (classifications.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < classifications.length; i += batchSize) {
      await db.insert(unmatchedClassifications).values(classifications.slice(i, i + batchSize));
    }
  }

  async clearUnmatchedClassifications(): Promise<void> {
    await db.delete(unmatchedClassifications);
  }

  async getMlSuggestions(status?: string): Promise<MlSuggestion[]> {
    if (status) {
      return await db.select().from(mlSuggestions).where(eq(mlSuggestions.status, status)).orderBy(desc(mlSuggestions.confidenceScore));
    }
    return await db.select().from(mlSuggestions).orderBy(desc(mlSuggestions.confidenceScore));
  }

  async insertMlSuggestions(suggestions: InsertMlSuggestion[]): Promise<void> {
    if (suggestions.length === 0) return;
    const batchSize = 500;
    for (let i = 0; i < suggestions.length; i += batchSize) {
      await db.insert(mlSuggestions).values(suggestions.slice(i, i + batchSize));
    }
  }

  async updateMlSuggestionStatus(id: number, status: string): Promise<void> {
    await db.update(mlSuggestions).set({ status }).where(eq(mlSuggestions.id, id));
  }

  async clearMlSuggestions(): Promise<void> {
    await db.delete(mlSuggestions);
  }

  async getDashboardSettings(userId: string): Promise<typeof dashboardSettings.$inferSelect[]> {
    return await db.select().from(dashboardSettings).where(eq(dashboardSettings.userId, userId));
  }

  async upsertDashboardSetting(userId: string, chartId: string, numberScale: string, decimalPlaces: number): Promise<void> {
    const existing = await db.select().from(dashboardSettings)
      .where(and(eq(dashboardSettings.userId, userId), eq(dashboardSettings.chartId, chartId)));
    if (existing.length > 0) {
      await db.update(dashboardSettings)
        .set({ numberScale, decimalPlaces })
        .where(and(eq(dashboardSettings.userId, userId), eq(dashboardSettings.chartId, chartId)));
    } else {
      await db.insert(dashboardSettings).values({ userId, chartId, numberScale, decimalPlaces });
    }
  }
}

export const storage = new DatabaseStorage();
