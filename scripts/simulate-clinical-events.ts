/**
 * simulate-clinical-events.ts
 * Generates realistic medical AI events based on the UBC hospital 
 * simulation framework and fires them into the EventService.
 */
import { v4 as uuidv4 } from 'uuid';
import { hashMessage } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const API_URL = `${API_BASE}/v1/events`;
const API_KEY = process.env.API_KEY || 'sk_test_123';

let AGENTS: { id: string, version: string }[] = [];

const WORKFLOWS = ['triage_recommendation', 'draft_clinical_note', 'simulated_patient_interaction'];
const POLICIES = ['ubc_med_sim_protocol_v2', 'discharge_protocol_v1', 'autonomous_pathway_x'];
const CLINICIAN_ACTIONS = ['accepted', 'overridden', 'ignored', 'autonomous'];

function randomChoice(arr: any[]) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function generateMockHash() {
  return hashMessage(uuidv4());
}

function generateMockPatientContext() {
  const age = Math.floor(Math.random() * 80) + 18;
  const sexOptions: ('male' | 'female' | 'intersex' | 'unknown')[] = ['male', 'female', 'intersex', 'unknown'];
  const sex_at_birth = randomChoice(sexOptions);
  let gender_identity: string | undefined = undefined;
  
  if (Math.random() > 0.8) {
    gender_identity = randomChoice(['non-binary', 'transgender', 'gender-fluid', 'prefer not to say']);
  }

  return {
    demographics: {
      age_years: age,
      sex_at_birth,
      gender_identity,
      language_primary: randomChoice(['en', 'fr', 'es', 'zh']),
      country_region: randomChoice(['CA-BC', 'CA-ON', 'US-NY', 'GB-LON'])
    },
    clinical: {
      comorbidities: Math.random() > 0.5 ? [{ code: 'HTN', description: 'Hypertension' }] : [],
      medications: Math.random() > 0.5 ? [{ name: 'Ametoprolol', dose: '25mg' }] : [],
      allergies: Math.random() > 0.8 ? [{ substance: 'Penicillin', reaction: 'Hives' }] : []
    }
  };
}

async function simulateEvent() {
  const agent = randomChoice(AGENTS);
  const patient_context = generateMockPatientContext();
  
  const payload = {
    agent_fingerprint_id: agent.id,
    model_version: agent.version,
    workflow_type: randomChoice(WORKFLOWS),
    policy_id: randomChoice(POLICIES),
    session_id: `enc_${Math.floor(Math.random() * 10000)}`,
    clinician_action: randomChoice(CLINICIAN_ACTIONS),
    input_ref: `sha256:${generateMockHash().substring(2)}`,
    output_ref: `sha256:${generateMockHash().substring(2)}`,
    clinical_data: {
      schemaVersion: 2,
      chief_complaint: 'Simulated Encounter',
      patient_context,
      vitals: {
        hr: 70 + Math.floor(Math.random() * 40),
        bp_sys: 110 + Math.floor(Math.random() * 30),
        bp_dia: 70 + Math.floor(Math.random() * 20),
        rr: 14 + Math.floor(Math.random() * 6),
        spo2: 95 + Math.floor(Math.random() * 5),
        temp: 36.5 + (Math.random() * 1.5),
        pain_score: Math.floor(Math.random() * 10)
      },
      state: 'completed'
    }
  };

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    console.log(`[Simulator] Ingested Event: ${data.data.event_hash.substring(0, 10)}... | Workflow: ${payload.workflow_type}`);
  } catch (err) {
    console.error('[Simulator] Failed to send event:', err);
  }
}

async function fetchRegisteredAgents() {
  try {
    const res = await fetch(`${API_BASE}/v1/agents`, {
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const data = await res.json();
    if (data.data && data.data.length > 0) {
      AGENTS = data.data.map((a: any) => ({ id: a.fingerprintHash, version: a.name }));
      console.log(`[Simulator] Using ${AGENTS.length} registered agent(s) from the blockchain registry.`);
    } else {
      console.error('\n❌ ERROR: No registered AI agents found in the registry.');
      console.error('Please register at least one agent fingerprint in the UI (or run `npm run seed:agents`) before running the medical simulator.\n');
      process.exit(1);
    }
  } catch (err) {
    console.error('\n❌ ERROR: Failed to connect to the Agent Registry API. Is the server running?');
    process.exit(1);
  }
}

async function runSimulation() {
  await fetchRegisteredAgents();
  
  console.log('Starting Phase 1 Medical MVP Simulation Engine...');
  console.log(`Targeting local API: ${API_URL}`);
  
  // Fire off 15 events randomly over a few seconds
  for (let i = 0; i < 15; i++) {
    await simulateEvent();
    const sleepMs = Math.floor(Math.random() * 500) + 100;
    await new Promise(r => setTimeout(r, sleepMs));
  }
  
  /* 
  * COMMENTED OUT FOR WALKTHROUGH 
  * This is where the script used to automatically trigger the anchoring API.
  console.log('\n[Simulator] Triggering background Merkle Tree anchor pull...');
  try {
    const anchorRes = await fetch(`${API_URL}/anchor/trigger`, { 
      method: 'POST',
      headers: { 'Authorization': `Bearer ${API_KEY}` }
    });
    const anchorData = await anchorRes.json();
    console.log(`[Simulator] Anchor Status: ${anchorData.count} events anchored inside Merkle Root ${anchorData.merkleRoot?.substring(0, 10)}...`);
  } catch(e) { console.error(e); }
  */

  console.log('\n[Simulator] Performing final cryptographic Health Audit...');
  try {
    const auditRes = await fetch(`${API_BASE}/health/audit`);
    const auditData = await auditRes.json();
    console.log(`[Simulator] Audit Result: Checked ${auditData.total_events_checked} records. Faults: ${auditData.faults_detected}. ${auditData.is_healthy ? '✅ DB is Cryptographically Sound' : '❌ Tampering Detected!'}`);
  } catch(e) { console.error(e); }
}

runSimulation();
