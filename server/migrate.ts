import { pool } from "./db";

export async function ensureSchema() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        display_name TEXT,
        role TEXT NOT NULL DEFAULT 'recon_user',
        active BOOLEAN DEFAULT true,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS transactions (
        id SERIAL PRIMARY KEY,
        upload_batch_id TEXT NOT NULL,
        company TEXT NOT NULL,
        counter_party TEXT NOT NULL,
        business_unit TEXT,
        account_head TEXT,
        sub_account_head TEXT,
        debit DOUBLE PRECISION DEFAULT 0,
        credit DOUBLE PRECISION DEFAULT 0,
        net_amount DOUBLE PRECISION DEFAULT 0,
        document_no TEXT,
        doc_date TEXT,
        narration TEXT,
        ic_gl TEXT,
        raw_row_data TEXT,
        recon_status TEXT DEFAULT 'unmatched',
        recon_id TEXT,
        recon_rule TEXT,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS summarized_lines (
        id SERIAL PRIMARY KEY,
        upload_batch_id TEXT NOT NULL,
        company TEXT NOT NULL,
        counter_party TEXT NOT NULL,
        document_no TEXT,
        doc_date TEXT,
        narration TEXT,
        ic_gl TEXT,
        cheque_no TEXT,
        net_amount DOUBLE PRECISION DEFAULT 0,
        transaction_count INTEGER DEFAULT 1,
        recon_status TEXT DEFAULT 'unmatched',
        recon_id TEXT,
        recon_rule TEXT,
        confidence_tier TEXT,
        confidence_score DOUBLE PRECISION,
        amount_diff DOUBLE PRECISION,
        date_diff INTEGER,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_rules (
        id SERIAL PRIMARY KEY,
        rule_id TEXT NOT NULL,
        name TEXT NOT NULL,
        rule_type TEXT NOT NULL,
        match_type TEXT DEFAULT '1:1',
        priority INTEGER NOT NULL,
        date_tolerance DOUBLE PRECISION,
        amount_tolerance DOUBLE PRECISION DEFAULT 0,
        amount_tolerance_pct DOUBLE PRECISION DEFAULT 0,
        confidence TEXT DEFAULT 'real_match',
        classification TEXT DEFAULT 'AUTO_MATCH',
        active BOOLEAN DEFAULT true,
        description TEXT,
        params TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS reconciliation_groups (
        id SERIAL PRIMARY KEY,
        recon_id TEXT NOT NULL UNIQUE,
        rule_name TEXT NOT NULL,
        total_debit DOUBLE PRECISION DEFAULT 0,
        total_credit DOUBLE PRECISION DEFAULT 0,
        transaction_count INTEGER DEFAULT 0,
        status TEXT DEFAULT 'matched',
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_match_patterns (
        id SERIAL PRIMARY KEY,
        pattern_type TEXT NOT NULL,
        company_a TEXT NOT NULL,
        company_b TEXT NOT NULL,
        amount_range TEXT,
        date_range TEXT,
        narration_pattern TEXT,
        document_pattern TEXT,
        weight DOUBLE PRECISION DEFAULT 1.0,
        occurrences INTEGER DEFAULT 1,
        last_used TEXT,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS match_confidence_scores (
        id SERIAL PRIMARY KEY,
        summarized_line_id INTEGER NOT NULL,
        recon_id TEXT,
        overall_score DOUBLE PRECISION DEFAULT 0,
        amount_score DOUBLE PRECISION DEFAULT 0,
        date_score DOUBLE PRECISION DEFAULT 0,
        narration_score DOUBLE PRECISION DEFAULT 0,
        reference_score DOUBLE PRECISION DEFAULT 0,
        pattern_score DOUBLE PRECISION DEFAULT 0,
        factors TEXT,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS anomaly_flags (
        id SERIAL PRIMARY KEY,
        summarized_line_id INTEGER NOT NULL,
        anomaly_type TEXT NOT NULL,
        severity TEXT DEFAULT 'medium',
        description TEXT NOT NULL,
        details TEXT,
        resolved BOOLEAN DEFAULT false,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS unmatched_classifications (
        id SERIAL PRIMARY KEY,
        summarized_line_id INTEGER NOT NULL,
        classification TEXT NOT NULL,
        confidence DOUBLE PRECISION DEFAULT 0,
        reasoning TEXT,
        suggested_action TEXT,
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ml_suggestions (
        id SERIAL PRIMARY KEY,
        line_id_a INTEGER NOT NULL,
        line_id_b INTEGER NOT NULL,
        confidence_score DOUBLE PRECISION DEFAULT 0,
        amount_score DOUBLE PRECISION DEFAULT 0,
        date_score DOUBLE PRECISION DEFAULT 0,
        narration_score DOUBLE PRECISION DEFAULT 0,
        reference_score DOUBLE PRECISION DEFAULT 0,
        pattern_score DOUBLE PRECISION DEFAULT 0,
        reasoning TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ic_matrix_tb_files (
        id SERIAL PRIMARY KEY,
        file_name TEXT NOT NULL,
        label TEXT NOT NULL,
        enterprise TEXT,
        period TEXT,
        period_start TEXT,
        period_end TEXT,
        total_records INTEGER DEFAULT 0,
        uploaded_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ic_matrix_tb_data (
        id SERIAL PRIMARY KEY,
        tb_file_id INTEGER NOT NULL,
        company TEXT NOT NULL,
        business_unit TEXT,
        group1 TEXT,
        group2 TEXT,
        group3 TEXT,
        group4 TEXT,
        group5 TEXT,
        sub_ledger_type TEXT,
        code TEXT,
        account_head TEXT,
        sub_account_code TEXT,
        sub_account_head TEXT,
        opening_debit DOUBLE PRECISION DEFAULT 0,
        opening_credit DOUBLE PRECISION DEFAULT 0,
        period_debit DOUBLE PRECISION DEFAULT 0,
        period_credit DOUBLE PRECISION DEFAULT 0,
        closing_debit DOUBLE PRECISION DEFAULT 0,
        closing_credit DOUBLE PRECISION DEFAULT 0,
        net_balance DOUBLE PRECISION DEFAULT 0,
        new_coa_gl_name TEXT,
        ic_counter_party TEXT,
        ic_counter_party_code TEXT,
        ic_txn_type TEXT,
        company_code TEXT,
        tb_source TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ic_matrix_mapping_gl (
        id SERIAL PRIMARY KEY,
        account_head TEXT NOT NULL,
        new_coa_gl_name TEXT,
        ic_counter_party TEXT,
        ic_counter_party_code TEXT,
        ic_txn_type TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ic_matrix_mapping_company (
        id SERIAL PRIMARY KEY,
        company_name TEXT NOT NULL,
        company_code TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ic_recon_gl_raw_rows (
        id SERIAL PRIMARY KEY,
        file_id INTEGER NOT NULL,
        row_data TEXT NOT NULL,
        company TEXT,
        company_code TEXT,
        net_amount DOUBLE PRECISION DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS ic_recon_gl_files (
        id SERIAL PRIMARY KEY,
        file_name TEXT NOT NULL,
        enterprise TEXT,
        label TEXT NOT NULL,
        period TEXT,
        total_records INTEGER DEFAULT 0,
        uploaded_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS upload_batches (
        id SERIAL PRIMARY KEY,
        batch_id TEXT NOT NULL UNIQUE,
        file_name TEXT NOT NULL,
        upload_type TEXT DEFAULT 'standard',
        company_a TEXT,
        company_b TEXT,
        total_records INTEGER DEFAULT 0,
        matched_records INTEGER DEFAULT 0,
        status TEXT DEFAULT 'processing',
        created_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cashflow_tb_files (
        id SERIAL PRIMARY KEY,
        file_name TEXT NOT NULL,
        label TEXT NOT NULL,
        enterprise TEXT,
        period TEXT,
        total_records INTEGER DEFAULT 0,
        uploaded_at TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cashflow_tb_data (
        id SERIAL PRIMARY KEY,
        tb_file_id INTEGER NOT NULL,
        company TEXT NOT NULL,
        business_unit TEXT,
        group1 TEXT,
        group2 TEXT,
        group3 TEXT,
        group4 TEXT,
        group5 TEXT,
        sub_ledger_type TEXT,
        code TEXT,
        account_head TEXT,
        sub_account_code TEXT,
        sub_account_head TEXT,
        opening_debit DOUBLE PRECISION DEFAULT 0,
        opening_credit DOUBLE PRECISION DEFAULT 0,
        period_debit DOUBLE PRECISION DEFAULT 0,
        period_credit DOUBLE PRECISION DEFAULT 0,
        closing_debit DOUBLE PRECISION DEFAULT 0,
        closing_credit DOUBLE PRECISION DEFAULT 0,
        net_opening_balance DOUBLE PRECISION DEFAULT 0,
        net_closing_balance DOUBLE PRECISION DEFAULT 0,
        cashflow TEXT,
        cf_head TEXT,
        structure TEXT,
        project_name TEXT,
        entity_status TEXT,
        tb_source TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cashflow_mapping_groupings (
        id SERIAL PRIMARY KEY,
        account_head TEXT NOT NULL,
        cashflow TEXT,
        cf_head TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cashflow_mapping_entities (
        id SERIAL PRIMARY KEY,
        company_name TEXT,
        company_name_erp TEXT NOT NULL,
        structure TEXT,
        business_unit TEXT,
        project_name TEXT,
        entity_status TEXT,
        remarks TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS dashboard_settings (
        id SERIAL PRIMARY KEY,
        user_id TEXT NOT NULL,
        chart_id TEXT NOT NULL,
        number_scale TEXT NOT NULL DEFAULT 'absolute',
        decimal_places INTEGER NOT NULL DEFAULT 0
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cashflow_past_losses (
        id SERIAL PRIMARY KEY,
        company TEXT,
        project TEXT,
        cashflow TEXT,
        cf_head TEXT,
        amount DOUBLE PRECISION DEFAULT 0,
        as_per_fs TEXT,
        losses_upto TEXT
      )
    `);

    const alterStatements = [
      "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS business_unit TEXT",
      "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS account_head TEXT",
      "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS sub_account_head TEXT",
      "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS ic_gl TEXT",
      "ALTER TABLE transactions ADD COLUMN IF NOT EXISTS raw_row_data TEXT",
      "ALTER TABLE summarized_lines ADD COLUMN IF NOT EXISTS confidence_tier TEXT",
      "ALTER TABLE summarized_lines ADD COLUMN IF NOT EXISTS confidence_score DOUBLE PRECISION",
      "ALTER TABLE summarized_lines ADD COLUMN IF NOT EXISTS amount_diff DOUBLE PRECISION",
      "ALTER TABLE summarized_lines ADD COLUMN IF NOT EXISTS date_diff INTEGER",
      "ALTER TABLE summarized_lines ADD COLUMN IF NOT EXISTS cheque_no TEXT",
      "ALTER TABLE ic_matrix_tb_data ADD COLUMN IF NOT EXISTS company_code TEXT",
      "ALTER TABLE ic_matrix_tb_data ADD COLUMN IF NOT EXISTS tb_source TEXT",
      "ALTER TABLE ic_matrix_tb_files ADD COLUMN IF NOT EXISTS period_start TEXT",
      "ALTER TABLE ic_matrix_tb_files ADD COLUMN IF NOT EXISTS period_end TEXT",
      "ALTER TABLE ic_recon_gl_raw_rows ADD COLUMN IF NOT EXISTS company TEXT",
      "ALTER TABLE ic_recon_gl_raw_rows ADD COLUMN IF NOT EXISTS company_code TEXT",
      "ALTER TABLE ic_recon_gl_raw_rows ADD COLUMN IF NOT EXISTS net_amount DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS business_unit TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS group1 TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS group2 TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS group3 TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS group4 TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS group5 TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS sub_ledger_type TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS code TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS sub_account_code TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS sub_account_head TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS net_opening_balance DOUBLE PRECISION DEFAULT 0",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS structure TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS project_name TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS entity_status TEXT",
      "ALTER TABLE cashflow_tb_data ADD COLUMN IF NOT EXISTS tb_source TEXT",
      "ALTER TABLE cashflow_mapping_entities ADD COLUMN IF NOT EXISTS company_name TEXT",
      "ALTER TABLE cashflow_mapping_entities ADD COLUMN IF NOT EXISTS structure TEXT",
      "ALTER TABLE cashflow_mapping_entities ADD COLUMN IF NOT EXISTS business_unit TEXT",
      "ALTER TABLE cashflow_mapping_entities ADD COLUMN IF NOT EXISTS project_name TEXT",
      "ALTER TABLE cashflow_mapping_entities ADD COLUMN IF NOT EXISTS entity_status TEXT",
      "ALTER TABLE cashflow_mapping_entities ADD COLUMN IF NOT EXISTS remarks TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN DEFAULT true",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS password_changed_at TEXT",
      "ALTER TABLE users ADD COLUMN IF NOT EXISTS allowed_modules TEXT[]",
    ];

    for (const stmt of alterStatements) {
      await client.query(stmt);
    }

    await client.query("COMMIT");
    console.log("[migrate] Schema sync complete — all tables and columns verified.");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[migrate] Schema sync failed:", err);
    throw err;
  } finally {
    client.release();
  }
}
