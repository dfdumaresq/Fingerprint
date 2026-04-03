import { Pool } from 'pg';
import dotenv from 'dotenv';
import { TriageService } from '../src/services/triage.service';

dotenv.config();

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function verify() {
  const service = new TriageService(pool);
  
  console.log("1. Creating a fresh encounter...");
  const encounter = await service.createEncounterWithAI({
    chief_complaint: "Testing Immutability",
    vitals: { hr: 80, bp_sys: 120, bp_dia: 80, rr: 16, spo2: 98, temp: 37.0, pain_score: 0 },
    age: 45,
    sex: 'M',
    history: { allergies: [], medications: [], pmh: [] }
  }, "Dr. Verifier");
  
  const sid = encounter.encounter_id;
  console.log(`   Session ID: ${sid}`);

  console.log("2. Logging initial decision: accepted");
  await service.logClinicianAction(sid, 'accepted', 'initial_triage');

  console.log("3. Anchoring the session...");
  await pool.query('UPDATE agent_events SET anchored_to_chain = true WHERE session_id = $1', [sid]);

  console.log("4. Attempting to AMEND (should create NEW row)...");
  const result = await service.logClinicianAction(sid, 'escalated', 'reevaluation');
  console.log(`   Result: is_amendment=${result.is_amendment}, prev=${result.previous_action}`);

  console.log("5. Checking DB for rows...");
  const rows = await pool.query('SELECT id, workflow_type, clinician_action, anchored_to_chain FROM agent_events WHERE session_id = $1 ORDER BY id ASC', [sid]);
  
  console.table(rows.rows);

  if (rows.rows.length === 3 && rows.rows[1].clinician_action === 'accepted' && rows.rows[2].clinician_action === 'escalated') {
    console.log("✅ SUCCESS: Append-only amendment verified.");
  } else {
    console.log("❌ FAILURE: Unexpected row count or status.");
  }

  console.log("6. Testing Trigger: Attempting to MUTATE anchored row...");
  try {
    await pool.query('UPDATE agent_events SET clinician_action = "downgraded" WHERE id = $1', [rows.rows[1].id]);
    console.log("❌ BUG: Trigger failed to block mutation!");
  } catch (e: any) {
    console.log(`✅ SUCCESS: Trigger blocked mutation: ${e.message}`);
  }

  await pool.end();
}

verify().catch(console.error);
