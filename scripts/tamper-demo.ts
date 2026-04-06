import { Pool } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const DEFAULT_AGENT_HASH = process.env.DEFAULT_DEMO_AGENT_HASH || '0xdc2764344d2df4507411e7aef001673fa1c217769d048e024210227952cd1ae3';

async function setupBackupTable(client: any) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS demo_tamper_backups (
      id SERIAL PRIMARY KEY,
      event_id INTEGER UNIQUE NOT NULL,
      original_action clinician_action_enum,
      original_data JSONB,
      tampered_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
}

async function tamper() {
  console.log('🚨 TAMPERING: Modifying most recent clinical entry in database...');
  
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    await setupBackupTable(client);
    
    // 1. Find the target row
    const targetRes = await client.query(`
      SELECT id, clinician_action, clinical_data FROM agent_events 
      WHERE agent_fingerprint_id = $1
      ORDER BY timestamp DESC 
      LIMIT 1
    `, [DEFAULT_AGENT_HASH]);

    if (targetRes.rowCount === 0) {
      console.error('❌ No recent events found for the triage agent.');
      await client.query('ROLLBACK');
      return;
    }

    const targetRow = targetRes.rows[0];

    // 2. Snapshot the original state
    await client.query(`
      INSERT INTO demo_tamper_backups (event_id, original_action, original_data)
      VALUES ($1, $2, $3)
      ON CONFLICT (event_id) DO UPDATE SET
        original_action = EXCLUDED.original_action,
        original_data = EXCLUDED.original_data
    `, [targetRow.id, targetRow.clinician_action, targetRow.clinical_data]);

    // 3. Mutate the main record
    console.log('🔓 Bypassing database immutability triggers...');
    await client.query('ALTER TABLE agent_events DISABLE TRIGGER trg_prevent_anchored_mutation');

    const toggleAction = targetRow.clinician_action === 'accepted' ? 'escalated' : 'accepted';
    
    const result = await client.query(`
      UPDATE agent_events 
      SET clinician_action = $1::clinician_action_enum 
      WHERE id = $2
      RETURNING id, session_id, clinician_action;
    `, [toggleAction, targetRow.id]);

    await client.query('ALTER TABLE agent_events ENABLE TRIGGER trg_prevent_anchored_mutation');
    await client.query('COMMIT');

    console.log('✅ TAMPERED: Row ID %s (Session: %s) is now set to "%s"', 
      result.rows[0].id, result.rows[0].session_id, result.rows[0].clinician_action);
    console.log('\n🔍 TO DETECT THE TAMPER:');
    console.log(' 1. Go to the Audit Dashboard UI');
    console.log(' 2. Click the "🩺 Run Health Check" button');
    console.log('\nAlternatively, run "npm run audit-health" to see the server-side detection.');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Tamper failed:', err);
  } finally {
    client.release();
  }
}

async function revert() {
  console.log('🩹 RECOVERING: Restoring original clinical decision...');
  
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    
    // 1. Find the most recent backup
    const backupRes = await client.query(`
      SELECT b.* FROM demo_tamper_backups b
      JOIN agent_events e ON b.event_id = e.id
      WHERE e.agent_fingerprint_id = $1
      ORDER BY b.tampered_at DESC
      LIMIT 1
    `, [DEFAULT_AGENT_HASH]);

    if (backupRes.rowCount === 0) {
      console.log('ℹ️ No backup snapshots found. System may already be healthy or requires a manual fix.');
      await client.query('ROLLBACK');
      return;
    }

    const backup = backupRes.rows[0];

    // 2. Restore the original state
    await client.query('ALTER TABLE agent_events DISABLE TRIGGER trg_prevent_anchored_mutation');

    await client.query(`
      UPDATE agent_events 
      SET clinician_action = $1::clinician_action_enum,
          clinical_data = $2
      WHERE id = $3
    `, [backup.original_action, backup.original_data, backup.event_id]);

    await client.query('ALTER TABLE agent_events ENABLE TRIGGER trg_prevent_anchored_mutation');
    
    // 3. Clear the backup
    await client.query('DELETE FROM demo_tamper_backups WHERE id = $1', [backup.id]);
    
    await client.query('COMMIT');

    console.log('✅ RECOVERED: Row ID %s has been restored to its original state.', backup.event_id);
    console.log('\n🩹 TO RESTORE STABILITY:');
    console.log(' 1. Go to the Audit Dashboard UI');
    console.log(' 2. Click "🔄 Refresh Audit Status"');
    console.log(' 3. Status will flip back to "🔗 ANCHORED"');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Revert failed:', err);
  } finally {
    client.release();
  }
}

const command = process.argv[2];
if (command === 'tamper') {
  tamper();
} else if (command === 'revert') {
  revert();
} else {
  console.log('Usage: npx ts-node scripts/tamper-demo.ts [tamper|revert]');
  process.exit(1);
}
