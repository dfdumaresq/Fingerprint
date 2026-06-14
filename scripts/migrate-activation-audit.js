/**
 * scripts/migrate-activation-audit.js
 *
 * Idempotently sets up the audit schema and the agent_activation_events
 * ledger table, complete with indexing, trigger-based immutability,
 * and role-based privilege restriction.
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

async function run() {
  console.log('==> Starting Audit Schema Migration...');
  const client = await pool.connect();

  try {
    // 1. Create audit schema
    await client.query('CREATE SCHEMA IF NOT EXISTS audit;');
    console.log('   Schema "audit" created/verified.');

    // 2. Create audit table
    await client.query(`
      CREATE TABLE IF NOT EXISTS audit.agent_activation_events (
          id SERIAL PRIMARY KEY,
          occurred_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
          
          -- Authenticated Actor (derived server-side from token)
          actor_type VARCHAR(50) NOT NULL,             -- 'system'
          actor_id VARCHAR(255) NOT NULL,              -- 'system_dashboard'
          actor_display_name VARCHAR(255) NOT NULL,    -- 'System Dashboard'
          actor_role VARCHAR(100) NOT NULL,            -- 'System Service'
          
          event_type VARCHAR(100) DEFAULT 'activation_attempt' NOT NULL,
          target_agent_id VARCHAR(255) NOT NULL,
          target_fingerprint_hash VARCHAR(66) NOT NULL,
          previous_agent_id VARCHAR(255),
          previous_fingerprint_hash VARCHAR(66),
          
          source VARCHAR(50) NOT NULL,                 -- 'ui' | 'api' | 'system' | 'seed'
          request_id VARCHAR(255) NOT NULL,
          reason TEXT,
          outcome VARCHAR(50) NOT NULL,                -- 'success' | 'failure'
          metadata JSONB
      );
    `);
    console.log('   Table "audit.agent_activation_events" created/verified.');

    // 3. Create performance & correlation indexes
    await client.query('CREATE INDEX IF NOT EXISTS idx_activation_occurred_at ON audit.agent_activation_events(occurred_at DESC);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_activation_actor ON audit.agent_activation_events(actor_id);');
    await client.query('CREATE INDEX IF NOT EXISTS idx_activation_request_id ON audit.agent_activation_events(request_id);');
    console.log('   Indexes created/verified.');

    // 4. Create trigger function and register idempotent trigger (Postgres 14+ supports CREATE OR REPLACE TRIGGER)
    await client.query(`
      CREATE OR REPLACE FUNCTION audit.prevent_audit_modification()
      RETURNS TRIGGER AS $$
      BEGIN
          RAISE EXCEPTION 'IMMUTABLE: Cannot modify or delete rows in the audit.agent_activation_events table.';
      END;
      $$ LANGUAGE plpgsql;
    `);

    await client.query(`
      CREATE OR REPLACE TRIGGER trg_prevent_audit_modification
      BEFORE UPDATE OR DELETE ON audit.agent_activation_events
      FOR EACH ROW EXECUTE FUNCTION audit.prevent_audit_modification();
    `);
    console.log('   Immutability trigger registered.');

    // 5. Revoke modify permissions for general user roles
    await client.query('REVOKE UPDATE, DELETE, TRUNCATE ON audit.agent_activation_events FROM PUBLIC;');
    console.log('   Privileges UPDATE, DELETE, TRUNCATE revoked from PUBLIC.');

    console.log('✅ Audit Schema Migration Completed Successfully!');
  } catch (err) {
    console.error('❌ Audit Schema Migration Failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
