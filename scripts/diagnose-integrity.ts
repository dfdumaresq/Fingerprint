import { Pool } from 'pg';
import * as dotenv from 'dotenv';
import { buildCanonicalPayload, generateEventHash, AgentEvent } from '../src/utils/crypto.utils';
import stringify from 'fast-json-stable-stringify';

dotenv.config();

const db = new Pool({ connectionString: process.env.DATABASE_URL });

interface FailureReport {
  event_id: number;
  timestamp: string;
  agent_id: string;
  classification: 'direct_payload_mismatch' | 'previous_hash_mismatch_only' | 'both_mismatches';
  segment_root_cause_candidate: boolean;
  category: 'demo_tamper' | 'non_demo_or_orphan';
  baseline_hash: string;
  current_hash: string;
  expected_previous_hash: string | null;
  actual_previous_hash: string | null;
  diff?: any;
}

async function diagnose() {
  const client = await db.connect();
  try {
    // 1. Fetch all events and backups
    const eventsRes = await client.query('SELECT * FROM agent_events ORDER BY agent_fingerprint_id, id ASC');
    const backupsRes = await client.query('SELECT * FROM demo_tamper_backups');
    
    const events = eventsRes.rows as AgentEvent[];
    const backups = new Map(backupsRes.rows.map(b => [b.event_id, b]));
    
    const reports: FailureReport[] = [];
    const lastHashes: Record<string, string> = {};
    
    let currentSegmentBroken = false;

    for (const event of events) {
      const agentId = event.agent_fingerprint_id;
      const expectedPrev = lastHashes[agentId] || null;
      
      // A. Recompute Payload Hash
      const reconstructedPayload = buildCanonicalPayload(event);
      const eventTime = new Date(event.timestamp);
      const currentHash = generateEventHash(reconstructedPayload, expectedPrev, eventTime.toISOString());
      
      const payloadMismatch = currentHash !== event.event_hash;
      const chainMismatch = event.previous_event_hash !== expectedPrev;
      
      if (payloadMismatch || chainMismatch) {
        // We found a failure
        let classification: FailureReport['classification'] = 'both_mismatches';
        if (payloadMismatch && !chainMismatch) classification = 'direct_payload_mismatch';
        if (!payloadMismatch && chainMismatch) classification = 'previous_hash_mismatch_only';
        
        const backup = backups.get(event.id);
        const category = backup ? 'demo_tamper' : 'non_demo_or_orphan';
        
        let diff: any = undefined;
        if (backup) {
          diff = {};
          if (backup.original_action !== event.clinician_action) {
            diff.clinician_action = { from: backup.original_action, to: event.clinician_action };
          }
          const originalDataStr = stringify(backup.original_data);
          const currentDataStr = stringify(event.clinical_data);
          if (originalDataStr !== currentDataStr) {
            diff.clinical_data = { changed: true }; // Simplified for CLI report
          }
        }

        reports.push({
          event_id: event.id,
          timestamp: eventTime.toISOString(),
          agent_id: agentId,
          classification,
          segment_root_cause_candidate: !currentSegmentBroken,
          category,
          baseline_hash: event.event_hash,
          current_hash: currentHash,
          expected_previous_hash: expectedPrev,
          actual_previous_hash: event.previous_event_hash,
          diff
        });
        
        currentSegmentBroken = true;
      } else {
        // Row is healthy, segment is restored (if it was broken)
        currentSegmentBroken = false;
      }
      
      // Update chain state for NEXT row
      lastHashes[agentId] = event.event_hash;
    }

    // 2. Format Output
    printReport(reports);
    
  } finally {
    client.release();
    await db.end();
  }
}

function printReport(reports: FailureReport[]) {
  if (reports.length === 0) {
    console.log('✅ ALL TESTS PASSED: Ledger is 100% healthy.');
    return;
  }

  console.log(`# Integrity Diagnostic Report (${reports.length} Faults Detected)\n`);

  const demoTampers = reports.filter(r => r.category === 'demo_tamper');
  const orphans = reports.filter(r => r.category === 'non_demo_or_orphan');

  console.log('## Demo-Backed Tampers');
  if (demoTampers.length === 0) console.log('None.');
  demoTampers.forEach(printEvent);

  console.log('\n## Non-Demo or Orphaned Tampers');
  if (orphans.length === 0) console.log('None.');
  orphans.forEach(printEvent);
}

function printEvent(r: FailureReport) {
  console.log(`\n- event_id: ${r.event_id} ${r.segment_root_cause_candidate ? '🚩 [ROOT CAUSE]' : ''}`);
  console.log(`  Classification: ${r.classification}`);
  console.log(`  Timestamp:      ${r.timestamp}`);
  console.log(`  Agent:          ${r.agent_id.substring(0, 10)}...`);
  console.log(`  Baseline Hash:  ${r.baseline_hash}`);
  console.log(`  Current Hash:   ${r.current_hash}`);
  if (r.expected_previous_hash !== r.actual_previous_hash) {
    console.log(`  Chain Link:     Expected ${r.expected_previous_hash?.substring(0,10)} but found ${r.actual_previous_hash?.substring(0,10)}`);
  }
  if (r.diff) {
    console.log(`  Diff:`);
    if (r.diff.clinician_action) {
      console.log(`    clinician_action: "${r.diff.clinician_action.from}" → "${r.diff.clinician_action.to}"`);
    }
    if (r.diff.clinical_data) {
      console.log(`    clinical_data: [Restructured/Modified]`);
    }
  }
}

diagnose().catch(console.error);
