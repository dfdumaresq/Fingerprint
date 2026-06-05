/**
 * scripts/seed-triage-agent.js
 *
 * Idempotently registers the active triage agent in the database so that
 * the governance registry resolves it and the UI shows "nominal" status.
 *
 * Run on the server after `docker compose up`:
 *   node scripts/seed-triage-agent.js
 *
 * Or via Docker:
 *   docker compose exec api node scripts/seed-triage-agent.js
 */
'use strict';
require('dotenv').config();
const { Pool } = require('pg');
const { randomUUID } = require('crypto');

const slug      = process.env.TRIAGE_AGENT_SLUG     || 'rules-engine-v1';
const name      = process.env.TRIAGE_AGENT_NAME     || 'Clinical Rules Engine';
const provider  = process.env.TRIAGE_AGENT_PROVIDER || 'rules';
const model     = process.env.TRIAGE_AGENT_MODEL    || 'built-in';

// Deterministic fingerprint based on slug so re-runs are idempotent
const crypto = require('crypto');
const fingerprintHash = '0x' + crypto.createHash('sha256').update(slug).digest('hex');

const db = new Pool({ connectionString: process.env.DATABASE_URL });

async function run() {
  const client = await db.connect();
  try {
    const existing = await client.query(
      'SELECT agent_id FROM agents WHERE agent_id = $1',
      [slug]
    );

    if (existing.rows.length > 0) {
      console.log(`⏩ Agent "${slug}" already registered — nothing to do.`);
      return;
    }

    await client.query(
      `INSERT INTO agents
         (fingerprint_hash, agent_id, name, provider, version, registered_by, is_revoked, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())`,
      [
        fingerprintHash,
        slug,
        name,
        provider,
        model,
        '0x0000000000000000000000000000000000000000'
      ]
    );

    console.log(`✅ Registered triage agent:`);
    console.log(`   slug:     ${slug}`);
    console.log(`   name:     ${name}`);
    console.log(`   provider: ${provider}`);
    console.log(`   hash:     ${fingerprintHash}`);
  } catch (err) {
    console.error('❌ Failed to seed triage agent:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await db.end();
  }
}

run();
