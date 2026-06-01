require('dotenv').config();
const dns = require('dns');
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// Force IPv4-first DNS so `localhost` reaches a PostgreSQL bound to 127.0.0.1.
if (typeof dns.setDefaultResultOrder === 'function') dns.setDefaultResultOrder('ipv4first');
function normalizeDbHost(url) { return url ? url.replace(/@localhost([:/])/i, '@127.0.0.1$1') : url; }

async function main() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    console.error('ADMIN_PASSWORD environment variable is required');
    process.exit(1);
  }

  const client = new Client({ connectionString: normalizeDbHost(process.env.DATABASE_URL) });
  await client.connect();

  try {
    const defaultRules = [
      { ruleId: 'IC-R1', name: 'Invoice/Reference Match', ruleType: 'invoice_match', matchType: '1:1', priority: 1, dateTolerance: null, amountTolerance: 5, amountTolerancePct: 0, confidence: 'real_match', classification: 'AUTO_MATCH', active: true, description: 'Phase 7 (Reference): Invoice/Bill reference extracted from narration matches exactly.', params: null },
      { ruleId: 'IC-R2', name: 'Exact Date + Exact Amount', ruleType: 'exact_match', matchType: '1:1', priority: 2, dateTolerance: 0, amountTolerance: 0, amountTolerancePct: 0, confidence: 'real_match', classification: 'AUTO_MATCH', active: true, description: 'Phase 1 (R01): Exact amount with same-day posting.', params: null },
      { ruleId: 'IC-R3', name: 'Exact Amount + Date +/-5 days', ruleType: 'date_range_match', matchType: '1:1', priority: 3, dateTolerance: 5, amountTolerance: 1, amountTolerancePct: 0, confidence: 'real_match', classification: 'AUTO_MATCH', active: true, description: 'Phase 1-2 (R01-R06): Exact amount with short date window.', params: null },
      { ruleId: 'IC-R4', name: 'Aggregation Match (exact date)', ruleType: 'exact_aggregation', matchType: '1:M', priority: 4, dateTolerance: 0, amountTolerance: 1, amountTolerancePct: 0, confidence: 'real_match', classification: 'AUTO_MATCH', active: true, description: 'Phase 4 (R13-R14): Many:1 exact sum match on same date.', params: JSON.stringify({ maxGroupSize: 5 }) },
      { ruleId: 'IC-R5', name: 'Aggregation Match + Date +/-5 days', ruleType: 'date_range_aggregation', matchType: '1:M', priority: 5, dateTolerance: 5, amountTolerance: 1, amountTolerancePct: 0, confidence: 'real_match', classification: 'AUTO_MATCH', active: true, description: 'Phase 4 (R13-R14): Aggregation with +/-3-5 day tolerance.', params: JSON.stringify({ maxGroupSize: 5 }) },
      { ruleId: 'IC-R10', name: 'Exact Amount (no date constraint)', ruleType: 'amount_only_match', matchType: '1:1', priority: 6, dateTolerance: null, amountTolerance: 1, amountTolerancePct: 0, confidence: 'probable_match', classification: 'REVIEW_MATCH', active: true, description: 'Phase 1 (R04 extended): Exact amount match with dates ignored.', params: null },
      { ruleId: 'IC-R11', name: 'Narration Fuzzy Match', ruleType: 'fuzzy_narration_match', matchType: '1:1', priority: 7, dateTolerance: null, amountTolerance: 100, amountTolerancePct: 0, confidence: 'probable_match', classification: 'REVIEW_MATCH', active: true, description: 'Phase 7 (R28): Narration keyword similarity >=70%.', params: JSON.stringify({ fuzzyThreshold: 0.7, minNarrationLength: 20 }) },
      { ruleId: 'IC-R12', name: 'Aggregated Amount (no date constraint)', ruleType: 'amount_only_aggregation', matchType: 'M:M', priority: 8, dateTolerance: null, amountTolerance: 100, amountTolerancePct: 0, confidence: 'probable_match', classification: 'REVIEW_MATCH', active: true, description: 'Phase 5-6 (R21-R25): M:M aggregation with +/-100 amount tolerance.', params: JSON.stringify({ maxGroupSize: 5 }) },
      { ruleId: 'IC-R1B', name: 'Cheque Number Match', ruleType: 'cheque_match', matchType: '1:1', priority: 9, dateTolerance: null, amountTolerance: 100, amountTolerancePct: 0, confidence: 'real_match', classification: 'SUGGESTED_MATCH', active: true, description: 'Phase 7 (Reference): Cheque number cross-match between counterparties.', params: null },
      { ruleId: 'IC-R6', name: 'Exact Amount + Date +/-15 days', ruleType: 'date_range_match', matchType: '1:1', priority: 10, dateTolerance: 15, amountTolerance: 1, amountTolerancePct: 0, confidence: 'probable_match', classification: 'SUGGESTED_MATCH', active: true, description: 'Phase 1 (R03): Wider date window for month-end cutoff differences.', params: null },
      { ruleId: 'IC-R7', name: 'Amount +/-100 + Date +/-5 days', ruleType: 'date_range_match', matchType: '1:1', priority: 11, dateTolerance: 5, amountTolerance: 100, amountTolerancePct: 0, confidence: 'probable_match', classification: 'SUGGESTED_MATCH', active: true, description: 'Phase 3 (R09-R10): Covers TDS rate differences, GST rounding.', params: null },
      { ruleId: 'IC-R8', name: 'Aggregation + Date +/-15 days', ruleType: 'date_range_aggregation', matchType: '1:M', priority: 12, dateTolerance: 15, amountTolerance: 1, amountTolerancePct: 0, confidence: 'probable_match', classification: 'SUGGESTED_MATCH', active: true, description: 'Phase 4 (R15-R16): Aggregation with wider date window.', params: JSON.stringify({ maxGroupSize: 10 }) },
      { ruleId: 'IC-R9', name: 'Monthly Aggregation Match', ruleType: 'monthly_aggregation', matchType: 'M:M', priority: 13, dateTolerance: null, amountTolerance: 100, amountTolerancePct: 0, confidence: 'probable_match', classification: 'SUGGESTED_MATCH', active: true, description: 'Gap Closure Phase A: Groups all unmatched by IC pair + calendar month.', params: null },
      { ruleId: 'IC-R13', name: 'Combined Scoring (AI)', ruleType: 'combined_scoring', matchType: '1:M', priority: 14, dateTolerance: null, amountTolerance: 0, amountTolerancePct: 0.05, confidence: 'suggestion', classification: 'SUGGESTED_MATCH', active: true, description: 'Gap Closure Phase C: Weighted scoring.', params: JSON.stringify({ scoreThreshold: 50, amountWeight: 50, dateWeight: 30, narrationWeight: 20 }) },
      { ruleId: 'IC-R14', name: 'Wide Amount % Tolerance (1%)', ruleType: 'amount_only_match', matchType: '1:1', priority: 15, dateTolerance: null, amountTolerance: 0, amountTolerancePct: 0.01, confidence: 'suggestion', classification: 'SUGGESTED_MATCH', active: true, description: 'Phase 3 extended: Catches FX conversion differences.', params: null },
      { ruleId: 'IC-R15', name: 'Reversal Transactions', ruleType: 'reversal_match', matchType: '1:M', priority: 16, dateTolerance: 5, amountTolerance: 5, amountTolerancePct: 0, confidence: 'real_match', classification: 'REVERSAL', active: true, description: 'Phase 8 (R29-R30): Same-entity reversal matching.', params: null },
    ];

    const existing = await client.query('SELECT rule_id FROM reconciliation_rules');
    const existingIds = new Set(existing.rows.map(function(r) { return r.rule_id; }));

    for (const r of defaultRules) {
      if (!existingIds.has(r.ruleId)) {
        await client.query(
          'INSERT INTO reconciliation_rules (rule_id, name, rule_type, match_type, priority, date_tolerance, amount_tolerance, amount_tolerance_pct, confidence, classification, active, description, params) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
          [r.ruleId, r.name, r.ruleType, r.matchType, r.priority, r.dateTolerance, r.amountTolerance, r.amountTolerancePct, r.confidence, r.classification, r.active, r.description, r.params]
        );
        console.log('  Seeded rule: ' + r.ruleId);
      }
    }
    console.log('  [OK] Reconciliation rules ready.');

    const adminCheck = await client.query("SELECT id FROM users WHERE username = 'admin'");
    const hashedPassword = await bcrypt.hash(adminPassword, 10);

    if (adminCheck.rows.length > 0) {
      await client.query(
        "UPDATE users SET password = $1, must_change_password = false, password_changed_at = $2 WHERE username = 'admin'",
        [hashedPassword, new Date().toISOString()]
      );
      console.log('  [OK] Admin password updated.');
    } else {
      const id = require('crypto').randomUUID();
      await client.query(
        "INSERT INTO users (id, username, password, display_name, role, active, must_change_password, password_changed_at, allowed_modules) VALUES ($1, 'admin', $2, 'Platform Admin', 'platform_admin', true, false, $3, $4)",
        [id, hashedPassword, new Date().toISOString(), '{ic_recon,cashflow,ic_matrix}']
      );
      console.log('  [OK] Admin user created.');
    }

    console.log('Seed complete');
  } finally {
    await client.end();
  }
}

main().catch(function(err) {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
