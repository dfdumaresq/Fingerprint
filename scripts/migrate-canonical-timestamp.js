#!/usr/bin/env node
/**
 * migrate-canonical-timestamp.js
 *
 * LEDGER MIGRATION NOTICE — Protocol v0 → v1
 * ============================================
 * This script adds the `event_timestamp_canonical` column to `agent_events`
 * and derives a deterministic ISO-8601 UTC millisecond string for every
 * existing row.  It then re-computes and updates `event_hash` and
 * `previous_event_hash` for the full per-agent chain so that the ledger is
 * internally consistent under the new protocol.
 *
 * IMPORTANT: This constitutes a deliberate, documented re-baselining of the
 * ledger.  Pre-migration hashes are superseded.  This script does NOT claim to
 * restore "original" strings — it derives and persists a new canonical string
 * from the stored TIMESTAMPTZ value, which is the best possible approximation
 * given that the original ingest string was not preserved.
 *
 * Usage:
 *   node scripts/migrate-canonical-timestamp.js             # live run (local)
 *   node scripts/migrate-canonical-timestamp.js --dry-run   # no DB writes
 *   node scripts/migrate-canonical-timestamp.js --env prod  # requires explicit flag
 *
 * Run on VPS:
 *   # 1. Deploy new code first (so ingest uses canonical column going forward)
 *   # 2. Run dry-run and review output
 *   # 3. Run live
 *   # 4. Verify with: npx ts-node scripts/diagnose-integrity.ts
 */

'use strict';

require('dotenv').config();
const { Pool } = require('pg');
const { keccak256 } = require('ethereum-cryptography/keccak');
const { utf8ToBytes } = require('ethereum-cryptography/utils');

// ─── Argument parsing ────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const DRY_RUN  = args.includes('--dry-run');
const ENV_FLAG = args.includes('--env') ? args[args.indexOf('--env') + 1] : 'local';

if (ENV_FLAG === 'prod' && !args.includes('--i-understand-this-rebaselines-the-ledger')) {
  console.error('\n❌  Production run requires: --i-understand-this-rebaselines-the-ledger\n');
  process.exit(1);
}

// ─── Crypto helpers (must match src/utils/crypto.utils.ts exactly) ───────────
const CANONICAL_FIELDS = [
  'agent_fingerprint_id', 'model_version', 'workflow_type', 'policy_id',
  'session_id', 'input_ref', 'output_ref', 'clinician_action',
  'amends_event_id', 'reason_code', 'reason_text', 'clinical_data',
];

function buildCanonicalPayload(event) {
  const obj = {};
  for (const field of CANONICAL_FIELDS) {
    const val = event[field];
    // Omit undefined; include null (matches TypeScript service behaviour)
    if (val !== undefined) obj[field] = val ?? null;
  }
  return JSON.stringify(obj, Object.keys(obj).sort());
}

function generateEventHash(canonicalPayload, previousHash, canonicalTimestamp) {
  const input = JSON.stringify({
    payload: canonicalPayload,
    previous_hash: previousHash ?? null,
    timestamp: canonicalTimestamp,
  });
  const bytes  = utf8ToBytes(input);
  const digest = keccak256(bytes);
  return '0x' + Buffer.from(digest).toString('hex');
}

// ─── Migration ────────────────────────────────────────────────────────────────
async function migrate() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    console.log('\n══════════════════════════════════════════════════════');
    console.log(' LEDGER MIGRATION: add event_timestamp_canonical');
    console.log(` Mode : ${DRY_RUN ? 'DRY RUN (no writes)' : 'LIVE'}`);
    console.log(` Env  : ${ENV_FLAG}`);
    console.log('══════════════════════════════════════════════════════\n');

    await client.query('BEGIN');

    // ── Step 1: Add column as nullable (idempotent) ───────────────────────
    console.log('Step 1: Adding event_timestamp_canonical column (if absent)…');
    if (!DRY_RUN) {
      await client.query(`
        ALTER TABLE agent_events
        ADD COLUMN IF NOT EXISTS event_timestamp_canonical TEXT
      `);
    }
    console.log('  ✓ Column present\n');

    // ── Step 2: Disable immutability trigger for the migration window ─────
    console.log('Step 2: Disabling immutability trigger…');
    if (!DRY_RUN) {
      await client.query('ALTER TABLE agent_events DISABLE TRIGGER trg_prevent_anchored_mutation');
    }
    console.log('  ✓ Trigger disabled\n');

    // ── Step 3: Fetch all rows, per-agent ordered ─────────────────────────
    console.log('Step 3: Fetching all events (ordered per agent chain)…');
    const { rows: events } = await client.query(`
      SELECT * FROM agent_events
      ORDER BY agent_fingerprint_id, id ASC
    `);
    console.log(`  → ${events.length} rows to process\n`);

    // ── Step 4: Re-derive canonical timestamps and re-hash each chain ─────
    console.log('Step 4: Re-deriving canonical timestamps and re-hashing chains…\n');

    const lastNewHashes = {}; // agentId → new hash of last processed event

    let rowsScanned     = 0;
    let rowsBackfilled  = 0;
    let hashChanged     = 0;
    let prevHashUpdated = 0;
    let rowsSkipped     = 0;
    let rowsFailed      = 0;

    for (const event of events) {
      rowsScanned++;
      const agentId = event.agent_fingerprint_id;

      try {
        // The canonical timestamp is derived from the stored TIMESTAMPTZ.
        // new Date(event.timestamp).toISOString() gives the JS millisecond
        // representation, which is the best deterministic derivation available
        // for pre-migration rows.  New rows persisted after this migration
        // will use the exact ingest-time string.
        const canonicalTimestamp = new Date(event.timestamp).toISOString();

        // The chain must be re-built using NEW hashes so previous_event_hash
        // references stay consistent after any hash changes upstream.
        const newPrevHash = lastNewHashes[agentId] ?? null;

        const canonicalPayload = buildCanonicalPayload(event);
        const newHash = generateEventHash(canonicalPayload, newPrevHash, canonicalTimestamp);

        const oldHash         = event.event_hash;
        const oldPrevHash     = event.previous_event_hash;
        const hashWillChange  = newHash !== oldHash;
        const prevWillChange  = newPrevHash !== oldPrevHash;

        if (hashWillChange)  hashChanged++;
        if (prevWillChange)  prevHashUpdated++;

        if (!DRY_RUN) {
          await client.query(`
            UPDATE agent_events
            SET
              event_timestamp_canonical = $1,
              event_hash                = $2,
              previous_event_hash       = $3
            WHERE id = $4
          `, [canonicalTimestamp, newHash, newPrevHash, event.id]);
        }

        lastNewHashes[agentId] = newHash;
        rowsBackfilled++;

      } catch (err) {
        console.error(`  ✗ Failed row id=${event.id}:`, err.message);
        rowsFailed++;
        // Still advance the chain state using the original stored hash so
        // subsequent rows in this agent's chain remain processable.
        lastNewHashes[agentId] = event.event_hash;
      }
    }

    // ── Step 5: Enforce NOT NULL ──────────────────────────────────────────
    if (rowsFailed === 0) {
      console.log('\nStep 5: Enforcing NOT NULL on event_timestamp_canonical…');
      if (!DRY_RUN) {
        await client.query(`
          ALTER TABLE agent_events
          ALTER COLUMN event_timestamp_canonical SET NOT NULL
        `);
      }
      console.log('  ✓ Constraint applied\n');
    } else {
      console.warn(`\n⚠  Skipping NOT NULL enforcement — ${rowsFailed} rows failed.\n`);
    }

    // ── Step 6: Re-enable trigger ─────────────────────────────────────────
    console.log('Step 6: Re-enabling immutability trigger…');
    if (!DRY_RUN) {
      await client.query('ALTER TABLE agent_events ENABLE TRIGGER trg_prevent_anchored_mutation');
    }
    console.log('  ✓ Trigger restored\n');

    if (DRY_RUN) {
      await client.query('ROLLBACK');
    } else {
      await client.query('COMMIT');
    }

    // ── Report ────────────────────────────────────────────────────────────
    console.log('══════════════════════════════════════════════════════');
    console.log(' MIGRATION REPORT');
    console.log('══════════════════════════════════════════════════════');
    console.log(`  Rows scanned          : ${rowsScanned}`);
    console.log(`  Rows backfilled       : ${rowsBackfilled}`);
    console.log(`  event_hash changed    : ${hashChanged}`);
    console.log(`  previous_hash updated : ${prevHashUpdated}`);
    console.log(`  Rows failed           : ${rowsFailed}`);
    console.log(`  Mode                  : ${DRY_RUN ? 'DRY RUN — no changes written' : 'COMMITTED'}`);
    console.log('══════════════════════════════════════════════════════\n');

    if (rowsFailed > 0) {
      process.exit(1);
    }

    console.log('✅  Migration complete. Run diagnose-integrity.ts to verify ledger health.\n');

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n❌  Migration failed, rolled back:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
