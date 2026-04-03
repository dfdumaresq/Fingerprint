import { Pool } from 'pg';
import { EventService } from '../../src/services/event.service';
import { TriageService } from '../../src/services/triage.service';
import { generateEventHash, buildCanonicalPayload } from '../../src/utils/crypto.utils';

describe('Regulatory-Grade Provenance Integration', () => {
  let pool: Pool;
  let eventService: EventService;
  let triageService: TriageService;

  beforeAll(() => {
    require('dotenv').config({ path: '.env.test' });
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    eventService = new EventService(pool);
    triageService = new TriageService(pool);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should create a cryptographically linked DAG of decisions with reason codes', async () => {
    const sessionId = `reg_test_${Date.now()}`;
    
    // 1. Create Initial AI Recommendation
    const initialEvent = await eventService.ingestEvent({
      agent_fingerprint_id: 'triage_agent_001',
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      policy_id: 'live::Chest Pain::80::120/80::2::ACS risk',
      session_id: sessionId,
      input_ref: 'ref_1',
      output_ref: 'ref_2',
      reason_code: 'initial_decision'
    });

    expect(initialEvent.event_hash).toBeDefined();

    // 2. Log First Clinician Action (Accept)
    // This should link to the AI event
    const action1 = await triageService.logClinicianAction(
      sessionId, 
      'accepted', 
      'initial_decision', 
      'Looks correct based on vitals'
    );
    expect(action1.is_amendment).toBe(false);

    // 3. Log an Amendment (Escalate)
    // This should link to the 'Accept' event
    const action2 = await triageService.logClinicianAction(
      sessionId, 
      'escalated', 
      'senior_review', 
      'Senior MD requested escalation for cardiology consult'
    );
    expect(action2.is_amendment).toBe(true);

    // 4. Verify the chain in the DB
    const res = await pool.query(
      'SELECT * FROM agent_events WHERE session_id = $1 ORDER BY id ASC',
      [sessionId]
    );

    expect(res.rows.length).toBe(3);
    const [rowAi, rowAccept, rowEscalate] = res.rows;

    // AI Row
    expect(rowAi.workflow_type).toBe('triage_recommendation');
    expect(rowAi.amends_event_id).toBeNull();

    // Accept Row
    expect(rowAccept.clinician_action).toBe('accepted');
    expect(rowAccept.amends_event_id).toBe(rowAi.event_id);
    expect(rowAccept.reason_code).toBe('initial_decision');

    // Escalate Row
    expect(rowEscalate.clinician_action).toBe('escalated');
    expect(rowEscalate.amends_event_id).toBe(rowAccept.event_id);
    expect(rowEscalate.reason_code).toBe('senior_review');

    // 5. Verify the lineage structure from the API logic
    const lineage = await triageService.getEncounterHistory(sessionId);
    expect(lineage.nodes.length).toBe(3);
    expect(lineage.edges.length).toBe(2); // (Accept -> AI) and (Escalate -> Accept)
    
    expect(lineage.edges).toContainEqual({
      from: rowEscalate.event_id,
      to: rowAccept.event_id,
      type: 'amends'
    });
  });

  it('should detect tampering specifically in the reason code', async () => {
    const sessionId = `tamper_test_${Date.now()}`;
    
    // Create an event
    const event = await eventService.ingestEvent({
      agent_fingerprint_id: 'triage_agent_001',
      model_version: 'rules_test',
      workflow_type: 'clinician_amendment',
      session_id: sessionId,
      input_ref: 'ref_1',
      output_ref: 'ref_2',
      reason_code: 'senior_review',
      reason_text: 'Validated by Dr. Smith'
    });

    // We can check if the calculated hash matches the stored hash.
    const dbRow = (await pool.query('SELECT * FROM agent_events WHERE event_id = $1', [event.event_id])).rows[0];
    
    // Use the official canonical reconstruction logic
    const canonicalPayload = buildCanonicalPayload(dbRow);

    const validHash = generateEventHash(canonicalPayload, dbRow.previous_event_hash, new Date(dbRow.timestamp).toISOString());
    expect(validHash).toBe(dbRow.event_hash);

    // Tamper with the reason_code
    dbRow.reason_code = 'clerical_error';
    const tamperedPayload = buildCanonicalPayload(dbRow);
    const tamperedHash = generateEventHash(tamperedPayload, dbRow.previous_event_hash, new Date(dbRow.timestamp).toISOString());
    expect(tamperedHash).not.toBe(dbRow.event_hash);
  });
});
