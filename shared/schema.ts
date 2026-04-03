import { sql } from "drizzle-orm";
import { pgTable, text, integer, serial, doublePrecision, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: text("id").primaryKey().$defaultFn(() => crypto.randomUUID()),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  displayName: text("display_name"),
  role: text("role").notNull().default("recon_user"),
  active: boolean("active").default(true),
  mustChangePassword: boolean("must_change_password").default(true),
  passwordChangedAt: text("password_changed_at"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
  displayName: true,
  role: true,
});

export const loginSchema = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const transactions = pgTable("transactions", {
  id: serial("id").primaryKey(),
  uploadBatchId: text("upload_batch_id").notNull(),
  company: text("company").notNull(),
  counterParty: text("counter_party").notNull(),
  businessUnit: text("business_unit"),
  accountHead: text("account_head"),
  subAccountHead: text("sub_account_head"),
  debit: doublePrecision("debit").default(0),
  credit: doublePrecision("credit").default(0),
  netAmount: doublePrecision("net_amount").default(0),
  documentNo: text("document_no"),
  docDate: text("doc_date"),
  narration: text("narration"),
  icGl: text("ic_gl"),
  rawRowData: text("raw_row_data"),
  reconStatus: text("recon_status").default("unmatched"),
  reconId: text("recon_id"),
  reconRule: text("recon_rule"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertTransactionSchema = createInsertSchema(transactions).omit({
  id: true,
  createdAt: true,
});

export type InsertTransaction = z.infer<typeof insertTransactionSchema>;
export type Transaction = typeof transactions.$inferSelect;

export const summarizedLines = pgTable("summarized_lines", {
  id: serial("id").primaryKey(),
  uploadBatchId: text("upload_batch_id").notNull(),
  company: text("company").notNull(),
  counterParty: text("counter_party").notNull(),
  documentNo: text("document_no"),
  docDate: text("doc_date"),
  narration: text("narration"),
  icGl: text("ic_gl"),
  chequeNo: text("cheque_no"),
  netAmount: doublePrecision("net_amount").default(0),
  transactionCount: integer("transaction_count").default(1),
  reconStatus: text("recon_status").default("unmatched"),
  reconId: text("recon_id"),
  reconRule: text("recon_rule"),
  confidenceTier: text("confidence_tier"),
  confidenceScore: doublePrecision("confidence_score"),
  amountDiff: doublePrecision("amount_diff"),
  dateDiff: integer("date_diff"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertSummarizedLineSchema = createInsertSchema(summarizedLines).omit({
  id: true,
  createdAt: true,
});

export type InsertSummarizedLine = z.infer<typeof insertSummarizedLineSchema>;
export type SummarizedLine = typeof summarizedLines.$inferSelect;

export const reconciliationRules = pgTable("reconciliation_rules", {
  id: serial("id").primaryKey(),
  ruleId: text("rule_id").notNull(),
  name: text("name").notNull(),
  ruleType: text("rule_type").notNull(),
  matchType: text("match_type").default("1:1"),
  priority: integer("priority").notNull(),
  dateTolerance: doublePrecision("date_tolerance"),
  amountTolerance: doublePrecision("amount_tolerance").default(0),
  amountTolerancePct: doublePrecision("amount_tolerance_pct").default(0),
  confidence: text("confidence").default("real_match"),
  classification: text("classification").default("AUTO_MATCH"),
  active: boolean("active").default(true),
  description: text("description"),
  params: text("params"),
});

export const insertRuleSchema = createInsertSchema(reconciliationRules).omit({
  id: true,
});

export type InsertRule = z.infer<typeof insertRuleSchema>;
export type Rule = typeof reconciliationRules.$inferSelect;

export const reconciliationGroups = pgTable("reconciliation_groups", {
  id: serial("id").primaryKey(),
  reconId: text("recon_id").notNull().unique(),
  ruleName: text("rule_name").notNull(),
  totalDebit: doublePrecision("total_debit").default(0),
  totalCredit: doublePrecision("total_credit").default(0),
  transactionCount: integer("transaction_count").default(0),
  status: text("status").default("matched"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertReconGroupSchema = createInsertSchema(reconciliationGroups).omit({
  id: true,
  createdAt: true,
});

export type InsertReconGroup = z.infer<typeof insertReconGroupSchema>;
export type ReconGroup = typeof reconciliationGroups.$inferSelect;

export const mlMatchPatterns = pgTable("ml_match_patterns", {
  id: serial("id").primaryKey(),
  patternType: text("pattern_type").notNull(),
  companyA: text("company_a").notNull(),
  companyB: text("company_b").notNull(),
  amountRange: text("amount_range"),
  dateRange: text("date_range"),
  narrationPattern: text("narration_pattern"),
  documentPattern: text("document_pattern"),
  weight: doublePrecision("weight").default(1.0),
  occurrences: integer("occurrences").default(1),
  lastUsed: text("last_used").$defaultFn(() => new Date().toISOString()),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertMlMatchPatternSchema = createInsertSchema(mlMatchPatterns).omit({
  id: true,
  createdAt: true,
});

export type InsertMlMatchPattern = z.infer<typeof insertMlMatchPatternSchema>;
export type MlMatchPattern = typeof mlMatchPatterns.$inferSelect;

export const matchConfidenceScores = pgTable("match_confidence_scores", {
  id: serial("id").primaryKey(),
  summarizedLineId: integer("summarized_line_id").notNull(),
  reconId: text("recon_id"),
  overallScore: doublePrecision("overall_score").default(0),
  amountScore: doublePrecision("amount_score").default(0),
  dateScore: doublePrecision("date_score").default(0),
  narrationScore: doublePrecision("narration_score").default(0),
  referenceScore: doublePrecision("reference_score").default(0),
  patternScore: doublePrecision("pattern_score").default(0),
  factors: text("factors"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertMatchConfidenceSchema = createInsertSchema(matchConfidenceScores).omit({
  id: true,
  createdAt: true,
});

export type InsertMatchConfidence = z.infer<typeof insertMatchConfidenceSchema>;
export type MatchConfidence = typeof matchConfidenceScores.$inferSelect;

export const anomalyFlags = pgTable("anomaly_flags", {
  id: serial("id").primaryKey(),
  summarizedLineId: integer("summarized_line_id").notNull(),
  anomalyType: text("anomaly_type").notNull(),
  severity: text("severity").default("medium"),
  description: text("description").notNull(),
  details: text("details"),
  resolved: boolean("resolved").default(false),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertAnomalyFlagSchema = createInsertSchema(anomalyFlags).omit({
  id: true,
  createdAt: true,
});

export type InsertAnomalyFlag = z.infer<typeof insertAnomalyFlagSchema>;
export type AnomalyFlag = typeof anomalyFlags.$inferSelect;

export const unmatchedClassifications = pgTable("unmatched_classifications", {
  id: serial("id").primaryKey(),
  summarizedLineId: integer("summarized_line_id").notNull(),
  classification: text("classification").notNull(),
  confidence: doublePrecision("confidence").default(0),
  reasoning: text("reasoning"),
  suggestedAction: text("suggested_action"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertUnmatchedClassificationSchema = createInsertSchema(unmatchedClassifications).omit({
  id: true,
  createdAt: true,
});

export type InsertUnmatchedClassification = z.infer<typeof insertUnmatchedClassificationSchema>;
export type UnmatchedClassification = typeof unmatchedClassifications.$inferSelect;

export const mlSuggestions = pgTable("ml_suggestions", {
  id: serial("id").primaryKey(),
  lineIdA: integer("line_id_a").notNull(),
  lineIdB: integer("line_id_b").notNull(),
  confidenceScore: doublePrecision("confidence_score").default(0),
  amountScore: doublePrecision("amount_score").default(0),
  dateScore: doublePrecision("date_score").default(0),
  narrationScore: doublePrecision("narration_score").default(0),
  referenceScore: doublePrecision("reference_score").default(0),
  patternScore: doublePrecision("pattern_score").default(0),
  reasoning: text("reasoning"),
  status: text("status").default("pending"),
  createdAt: text("created_at").$defaultFn(() => new Date().toISOString()),
});

export const insertMlSuggestionSchema = createInsertSchema(mlSuggestions).omit({
  id: true,
  createdAt: true,
});

export type InsertMlSuggestion = z.infer<typeof insertMlSuggestionSchema>;
export type MlSuggestion = typeof mlSuggestions.$inferSelect;

export const icMatrixTbFiles = pgTable("ic_matrix_tb_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  label: text("label").notNull(),
  enterprise: text("enterprise"),
  period: text("period"),
  periodStart: text("period_start"),
  periodEnd: text("period_end"),
  totalRecords: integer("total_records").default(0),
  uploadedAt: text("uploaded_at").$defaultFn(() => new Date().toISOString()),
});

export type IcMatrixTbFile = typeof icMatrixTbFiles.$inferSelect;

export const icMatrixTbData = pgTable("ic_matrix_tb_data", {
  id: serial("id").primaryKey(),
  tbFileId: integer("tb_file_id").notNull(),
  company: text("company").notNull(),
  businessUnit: text("business_unit"),
  group1: text("group1"),
  group2: text("group2"),
  group3: text("group3"),
  group4: text("group4"),
  group5: text("group5"),
  subLedgerType: text("sub_ledger_type"),
  code: text("code"),
  accountHead: text("account_head"),
  subAccountCode: text("sub_account_code"),
  subAccountHead: text("sub_account_head"),
  openingDebit: doublePrecision("opening_debit").default(0),
  openingCredit: doublePrecision("opening_credit").default(0),
  periodDebit: doublePrecision("period_debit").default(0),
  periodCredit: doublePrecision("period_credit").default(0),
  closingDebit: doublePrecision("closing_debit").default(0),
  closingCredit: doublePrecision("closing_credit").default(0),
  netBalance: doublePrecision("net_balance").default(0),
  newCoaGlName: text("new_coa_gl_name"),
  icCounterParty: text("ic_counter_party"),
  icCounterPartyCode: text("ic_counter_party_code"),
  icTxnType: text("ic_txn_type"),
  companyCode: text("company_code"),
  tbSource: text("tb_source"),
});

export type IcMatrixTbData = typeof icMatrixTbData.$inferSelect;

export const icMatrixMappingGl = pgTable("ic_matrix_mapping_gl", {
  id: serial("id").primaryKey(),
  glName: text("gl_name").notNull(),
  newCoaGlName: text("new_coa_gl_name"),
  icCounterParty: text("ic_counter_party"),
  icCounterPartyCode: text("ic_counter_party_code"),
  icTxnType: text("ic_txn_type"),
});

export type IcMatrixMappingGl = typeof icMatrixMappingGl.$inferSelect;

export const icMatrixMappingCompany = pgTable("ic_matrix_mapping_company", {
  id: serial("id").primaryKey(),
  companyName: text("company_name"),
  companyNameErp: text("company_name_erp").notNull(),
  companyCode: text("company_code").notNull(),
});

export type IcMatrixMappingCompany = typeof icMatrixMappingCompany.$inferSelect;

export const icReconGlRawRows = pgTable("ic_recon_gl_raw_rows", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  rowData: text("row_data").notNull(),
});

export type IcReconGlRawRow = typeof icReconGlRawRows.$inferSelect;

export const icReconGlFiles = pgTable("ic_recon_gl_files", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull(),
  fileName: text("file_name").notNull(),
  label: text("label").notNull(),
  enterpriseName: text("enterprise_name"),
  reportPeriod: text("report_period"),
  totalRecords: integer("total_records").default(0),
  icRecords: integer("ic_records").default(0),
  uploadedAt: text("uploaded_at").$defaultFn(() => new Date().toISOString()),
});

export type IcReconGlFile = typeof icReconGlFiles.$inferSelect;

export const uploadBatches = pgTable("upload_batches", {
  id: serial("id").primaryKey(),
  batchId: text("batch_id").notNull().unique(),
  fileName: text("file_name").notNull(),
  totalRecords: integer("total_records").default(0),
  uploadedAt: text("uploaded_at").$defaultFn(() => new Date().toISOString()),
});

export const insertUploadBatchSchema = createInsertSchema(uploadBatches).omit({
  id: true,
  uploadedAt: true,
});

export type InsertUploadBatch = z.infer<typeof insertUploadBatchSchema>;
export type UploadBatch = typeof uploadBatches.$inferSelect;

export const cashflowTbFiles = pgTable("cashflow_tb_files", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  label: text("label").notNull(),
  enterprise: text("enterprise"),
  period: text("period"),
  totalRecords: integer("total_records").default(0),
  uploadedAt: text("uploaded_at").$defaultFn(() => new Date().toISOString()),
});

export type CashflowTbFile = typeof cashflowTbFiles.$inferSelect;

export const cashflowTbData = pgTable("cashflow_tb_data", {
  id: serial("id").primaryKey(),
  tbFileId: integer("tb_file_id").notNull(),
  company: text("company").notNull(),
  businessUnit: text("business_unit"),
  group1: text("group1"),
  group2: text("group2"),
  group3: text("group3"),
  group4: text("group4"),
  group5: text("group5"),
  subLedgerType: text("sub_ledger_type"),
  code: text("code"),
  accountHead: text("account_head"),
  subAccountCode: text("sub_account_code"),
  subAccountHead: text("sub_account_head"),
  openingDebit: doublePrecision("opening_debit").default(0),
  openingCredit: doublePrecision("opening_credit").default(0),
  periodDebit: doublePrecision("period_debit").default(0),
  periodCredit: doublePrecision("period_credit").default(0),
  closingDebit: doublePrecision("closing_debit").default(0),
  closingCredit: doublePrecision("closing_credit").default(0),
  netOpeningBalance: doublePrecision("net_opening_balance").default(0),
  netClosingBalance: doublePrecision("net_closing_balance").default(0),
  cashflow: text("cashflow"),
  cfHead: text("cf_head"),
  structure: text("structure"),
  projectName: text("project_name"),
  entityStatus: text("entity_status"),
  tbSource: text("tb_source"),
});

export type CashflowTbData = typeof cashflowTbData.$inferSelect;

export const cashflowMappingGroupings = pgTable("cashflow_mapping_groupings", {
  id: serial("id").primaryKey(),
  accountHead: text("account_head").notNull(),
  cashflow: text("cashflow"),
  cfHead: text("cf_head"),
});

export type CashflowMappingGrouping = typeof cashflowMappingGroupings.$inferSelect;

export const cashflowMappingEntities = pgTable("cashflow_mapping_entities", {
  id: serial("id").primaryKey(),
  companyName: text("company_name"),
  companyNameErp: text("company_name_erp").notNull(),
  structure: text("structure"),
  businessUnit: text("business_unit"),
  projectName: text("project_name"),
  entityStatus: text("entity_status"),
  remarks: text("remarks"),
});

export type CashflowMappingEntity = typeof cashflowMappingEntities.$inferSelect;

export const dashboardSettings = pgTable("dashboard_settings", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  chartId: text("chart_id").notNull(),
  numberScale: text("number_scale").notNull().default("absolute"),
  decimalPlaces: integer("decimal_places").notNull().default(0),
});

export const insertDashboardSettingSchema = createInsertSchema(dashboardSettings).omit({
  id: true,
});

export type InsertDashboardSetting = z.infer<typeof insertDashboardSettingSchema>;
export type DashboardSetting = typeof dashboardSettings.$inferSelect;

export const cashflowPastLosses = pgTable("cashflow_past_losses", {
  id: serial("id").primaryKey(),
  company: text("company"),
  project: text("project"),
  cashflow: text("cashflow"),
  cfHead: text("cf_head"),
  amount: doublePrecision("amount").default(0),
  asPerFs: text("as_per_fs"),
  lossesUpto: text("losses_upto"),
});
