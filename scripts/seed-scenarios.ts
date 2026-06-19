/**
 * scripts/seed-scenarios.ts
 * Idempotently registers the Test Triage Bot agent and writes the canonical
 * Massive Acute Aortic Dissection / Cardiogenic Shock scenario event into the ledger.
 */
import { Pool } from 'pg';
import { generateEventHash, buildCanonicalPayload } from '../src/utils/crypto.utils';
import { randomUUID } from 'crypto';
import * as dotenv from 'dotenv';

const args = process.argv.slice(2);
const isTest = args.includes('test');

if (isTest) {
  dotenv.config({ path: '.env.test' });
} else {
  dotenv.config();
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

const MOCK_FINGERPRINT = '0x28f2ed93f69f9f78460fe13bfcba66eb77018034146aa4a76c0a2d1630db4a97';
const SCENARIO_SESSION_ID = 'scenario_dramatic_cardiac';

async function seedScenarios() {
  console.log('🌱 Starting Scenario Seeding...');
  const client = await pool.connect();

  try {
    // 1. Idempotently register Test Triage Bot if missing
    const agentCheck = await client.query(
      'SELECT fingerprint_hash FROM agents WHERE fingerprint_hash = $1',
      [MOCK_FINGERPRINT]
    );

    if (agentCheck.rows.length === 0) {
      console.log(`✨ [CREATED] Registering Test Triage Bot (${MOCK_FINGERPRINT.substring(0, 10)}...)...`);
      await client.query(`
        INSERT INTO agents (
          fingerprint_hash, agent_id, name, provider, version, 
          registered_by, is_revoked, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, false, NOW(), NOW())
      `, [MOCK_FINGERPRINT, 'ollama-llama3-8b', 'Test Triage Bot', 'ollama', '1.0.0', '0x123']);
    } else {
      console.log(`⏩ [SKIPPED] Agent Test Triage Bot already exists.`);
    }

    // 2. Clear out any existing instances of this exact scenario session
    await client.query('DELETE FROM agent_events WHERE session_id = $1', [SCENARIO_SESSION_ID]);
    console.log(`🗑️  Cleaned up existing '${SCENARIO_SESSION_ID}' scenario events.`);

    // 3. Formulate the highly acute Level 1 medical triage payload (Zero-PHI)
    const clinicalData = {
      schemaVersion: 1,
      chief_complaint: 'Acute, tearing chest pain radiating to the back',
      patient_context: {
        demographics: {
          age_years: 68,
          sex_at_birth: 'male'
        },
        clinical: {
          allergies: [{ substance: 'Penicillin', reaction: 'Hives' }],
          medications: [{ name: 'Amlodipine', dose: '5mg' }],
          comorbidities: [
            { code: 'HTN', description: 'Severe Hypertension' },
            { code: 'HLD', description: 'Hyperlipidemia' }
          ]
        }
      },
      vitals: {
        hr: 122,
        bp_sys: 88,
        bp_dia: 50,
        rr: 26,
        spo2: 90,
        spo2_support: 'room_air',
        temp: 36.8,
        temp_method: 'oral',
        pain_score: 10,
        avpu: 'A'
      },
      history: {
        allergies: ['Penicillin'],
        medications: ['Amlodipine'],
        pmh: ['Severe Hypertension', 'Hyperlipidemia'],
        notes: ''
      },
      red_flags: ['chest_pain'],
      ai_recommendation: {
        acuity: 1,
        reasons: [
          'Tachycardia (HR 122 bpm)',
          'Hypoxia (SpO₂ 90% on Room Air)',
          'Severe Hypotension / Cardiogenic Shock (BP 88/50 mmHg)',
          'Severe Pain (10/10 Pain Score)',
          'Tearing pain radiating to back is highly specific for Acute Aortic Dissection'
        ]
      },
      ai_provider: 'rules',
      state: 'waiting'
    };

    // 4. Fetch the latest event for Test Triage Bot to chain the hash correctly
    const lastEventRes = await client.query(
      'SELECT event_hash FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY id DESC LIMIT 1',
      [MOCK_FINGERPRINT]
    );
    const previousHash = lastEventRes.rows.length > 0 ? lastEventRes.rows[0].event_hash : null;

    // 5. Establish stable timestamps and canonical payload
    const now = new Date();
    const timestampStr = now.toISOString();

    const eventPayload = {
      agent_fingerprint_id: MOCK_FINGERPRINT,
      model_version: '1.0.0',
      workflow_type: 'triage_recommendation',
      session_id: SCENARIO_SESSION_ID,
      input_ref: 'clinical_admission_scenario',
      output_ref: 'ai_triage_audit_scenario',
      policy_id: 'scenario::dissection::level_1',
      clinical_data: clinicalData,
      reason_code: 'initial_decision'
    };

    const canonical = buildCanonicalPayload(eventPayload);
    const eventHash = generateEventHash(canonical, previousHash, timestampStr);

    // 6. Ingest scenario into append-only agent_events ledger
    const insertQuery = `
      INSERT INTO agent_events (
        event_id, session_id, timestamp,
        event_timestamp_canonical,
        agent_fingerprint_id, model_version, 
        workflow_type, policy_id, 
        input_ref, output_ref, 
        previous_event_hash, event_hash,
        reason_code, clinical_data
      ) VALUES (
        $1, $2, $3,
        $4,
        $5, $6, 
        $7, $8, 
        $9, $10, 
        $11, $12,
        $13, $14
      ) RETURNING id, event_hash
    `;

    const eventId = randomUUID();
    const insertRes = await client.query(insertQuery, [
      eventId,
      SCENARIO_SESSION_ID,
      timestampStr,
      timestampStr,  // event_timestamp_canonical — same string used in generateEventHash
      MOCK_FINGERPRINT,
      '1.0.0',
      'triage_recommendation',
      'scenario::dissection::level_1',
      'clinical_admission_scenario',
      'ai_triage_audit_scenario',
      previousHash,
      eventHash,
      'initial_decision',
      clinicalData
    ]);

    console.log(`✅ [CREATED] Ingested Scenario Event: id=${insertRes.rows[0].id} | hash=${insertRes.rows[0].event_hash.substring(0, 10)}...`);
    console.log('🎉 Seeding successfully completed!');
  } catch (err) {
    console.error('❌ Error during scenario database seeding:', err);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

seedScenarios();
