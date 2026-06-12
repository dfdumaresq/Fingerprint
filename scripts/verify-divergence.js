#!/usr/bin/env node
/**
 * POST-MVP VERIFICATION PLAN & POLICY
 * 
 * NOTE: Direct verification of the divergence signal is a post-MVP feature.
 * Policy requires implementing and verifying this signal locally in the development
 * environment (dev) before deploying and verifying on the production server (prod).
 * 
 * 1. LOCAL DEV VERIFICATION:
 *    - Start local database: `npm run dev:medical` (sets up schema and starts server on port 3000)
 *    - Seed active agent locally if needed: `node scripts/seed-triage-agent.js`
 *    - Run this verification script locally:
 *        node scripts/verify-divergence.js http://localhost:3000 sk_test_123
 * 
 * 2. PROD DEPLOYMENT (POST-MVP):
 *    - Push branch changes and pull on the server: `git pull && docker compose up -d --build api`
 *    - Run this script against the remote server:
 *        node scripts/verify-divergence.js https://clinicianledger.ca [PROD_API_KEY]
 */

/**
 * verify-divergence.js
 * 
 * Smoke test for the AI vs. Rules Engine divergence signal.
 * Submits two encounters to the local (or production) API:
 *   1. A DVT case — should produce divergence ≥ 2 (Silent Failure tier)
 *   2. A laceration case — should produce divergence 0 (aligned/stable)
 * 
 * Usage:
 *   node scripts/verify-divergence.js                    (local, port 3000)
 *   node scripts/verify-divergence.js https://clinicianledger.ca f98ee134f35b
 */

const BASE_URL = process.argv[2] || 'http://localhost:3000';
const API_KEY  = process.argv[3] || 'sk_test_123';

const HEADERS = {
  'Content-Type': 'application/json',
  'Authorization': `Bearer ${API_KEY}`
};

// ── Test cases ────────────────────────────────────────────────────────────────

const TEST_CASES = [
  {
    label: '⚡ DVT / Silent Failure (expect divergence ≥ 1)',
    clinician_name: 'verify_script',
    chief_complaint: 'Sudden, painful swelling in right calf after a 10-hour flight',
    vitals: { hr: 94, bp_sys: 135, bp_dia: 85, rr: 16, spo2: 97, spo2_support: 'room_air', temp: 37.0, temp_method: 'oral', pain_score: 0 },
    patient_context: {
      demographics: { age_years: 62, sex_at_birth: 'female' },
      clinical: { allergies: [{ substance: 'NKDA' }], medications: [], comorbidities: [] }
    },
    expect: { minDivergence: 1 }
  },
  {
    label: '✅ Laceration / Aligned (expect divergence ≤ 2)',
    clinician_name: 'verify_script',
    chief_complaint: 'Small laceration on left hand index finger, bleeding controlled',
    vitals: { hr: 78, bp_sys: 118, bp_dia: 76, rr: 14, spo2: 99, spo2_support: 'room_air', temp: 36.8, temp_method: 'oral', pain_score: 2 },
    patient_context: {
      demographics: { age_years: 28, sex_at_birth: 'male' },
      clinical: { allergies: [{ substance: 'NKDA' }], medications: [], comorbidities: [] }
    },
    expect: { maxDivergence: 2 }
  }
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(val, color) {
  const codes = { red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m', reset: '\x1b[0m', bold: '\x1b[1m' };
  return `${codes[color] || ''}${val}${codes.reset}`;
}

function divergenceLabel(d) {
  if (d === 0)  return fmt('✅ ALIGNED (Δ0)', 'green');
  if (d === 1)  return fmt('🟡 MINOR DISCREPANCY (Δ1)', 'yellow');
  if (d >= 2)   return fmt(`⚡ CONFLICT / SILENT FAILURE (Δ${d})`, 'red');
  return `Δ${d}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function runTest(tc) {
  console.log(`\n${fmt('─'.repeat(60), 'cyan')}`);
  console.log(fmt(tc.label, 'bold'));
  console.log(`  Complaint: ${tc.chief_complaint}`);
  console.log(`  Patient  : age ${tc.patient_context.demographics.age_years}, ${tc.patient_context.demographics.sex_at_birth}`);
  console.log(`  Vitals   : HR ${tc.vitals.hr}, BP ${tc.vitals.bp_sys}/${tc.vitals.bp_dia}, SpO₂ ${tc.vitals.spo2}%`);

  // 1. Create encounter
  const createRes = await fetch(`${BASE_URL}/v1/triage/encounters`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({
      chief_complaint: tc.chief_complaint,
      vitals: tc.vitals,
      patient_context: tc.patient_context,
      clinician_name: tc.clinician_name
    })
  });

  if (!createRes.ok) {
    const err = await createRes.text();
    console.error(fmt(`  ❌ Encounter creation failed (${createRes.status}): ${err}`, 'red'));
    return false;
  }

  const resJson = await createRes.json();
  const encounter = resJson.data || {};
  const clinical = encounter.clinical || {};
  const aiRec    = clinical.ai_recommendation  || {};
  const rulesRec = clinical.rules_recommendation || {};
  const divergence = clinical.acuity_divergence;

  console.log(`\n  ${fmt('API Response:', 'bold')}`);
  console.log(`    AI Acuity     : ${fmt(`L${aiRec.acuity}`, aiRec.acuity <= 2 ? 'red' : aiRec.acuity === 3 ? 'yellow' : 'green')}`);
  console.log(`    Rules Acuity  : ${fmt(`L${rulesRec.acuity}`, rulesRec.acuity <= 2 ? 'red' : rulesRec.acuity === 3 ? 'yellow' : 'green')}`);
  
  if (divergence == null) {
    console.log(fmt(`    acuity_divergence: MISSING — old image still running, rebuild needed`, 'red'));
    return false;
  }

  console.log(`    Divergence    : ${divergenceLabel(divergence)}`);

  if (rulesRec.reasons && rulesRec.reasons.length > 0) {
    console.log(`    Rules Reasons :`);
    rulesRec.reasons.forEach(r => console.log(`      • ${r}`));
  } else {
    console.log(fmt(`    rules_recommendation: MISSING — rebuild needed`, 'red'));
  }

  // 2. Validate expectations
  let passed = true;
  if (tc.expect.minDivergence != null && divergence < tc.expect.minDivergence) {
    console.log(fmt(`  ❌ FAIL: expected divergence ≥ ${tc.expect.minDivergence}, got ${divergence}`, 'red'));
    passed = false;
  }
  if (tc.expect.maxDivergence != null && divergence > tc.expect.maxDivergence) {
    console.log(fmt(`  ❌ FAIL: expected divergence ≤ ${tc.expect.maxDivergence}, got ${divergence}`, 'red'));
    passed = false;
  }
  if (passed) {
    console.log(fmt(`  ✅ PASS`, 'green'));
  }

  return passed;
}

async function main() {
  console.log(fmt('\n🔬 Fingerprint Divergence Signal Verification', 'bold'));
  console.log(`   Target: ${fmt(BASE_URL, 'cyan')}`);

  // Quick health check
  try {
    const health = await fetch(`${BASE_URL}/v1/triage/status`, { headers: HEADERS });
    const hData  = await health.json();
    console.log(`   Agent : ${hData.agent?.name || 'unknown'} (${hData.state || 'unknown'})`);
  } catch (e) {
    console.log(fmt(`   ⚠️  Health check failed — is the server running? (${e.message})`, 'yellow'));
  }

  const results = [];
  for (const tc of TEST_CASES) {
    results.push(await runTest(tc));
  }

  const passed = results.filter(Boolean).length;
  const total  = results.length;
  console.log(`\n${fmt('─'.repeat(60), 'cyan')}`);
  console.log(`${fmt(`Results: ${passed}/${total} passed`, passed === total ? 'green' : 'red')}`);

  if (passed < total) {
    console.log(fmt('\nIf acuity_divergence is missing: the old Docker image is running.', 'yellow'));
    console.log('Run on server:  git pull && docker compose up -d --build api');
    process.exit(1);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
