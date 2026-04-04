import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { TriageService } from '../../src/services/triage.service';
import { EventService } from '../../src/services/event.service';
import { AnchorService } from '../../src/services/anchor.service';
import { TRIAGE_AGENT } from '../../src/config/agents';
import { generateEventHash, buildCanonicalPayload } from '../../src/utils/crypto.utils';

const MOCK_FINGERPRINT = '0x28f2ed93f69f9f78460fe13bfcba66eb77018034146aa4a76c0a2d1630db4a97';

describe('One-Click Audit Pack Export', () => {
  let pool: Pool;
  let triageService: TriageService;
  let eventService: EventService;
  let anchorService: AnchorService;

  beforeAll(() => {
    require('dotenv').config({ path: '.env.test' });
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    triageService = new TriageService(pool);
    eventService = new EventService(pool);
    anchorService = new AnchorService(pool);
  });

  beforeEach(async () => {
    // Ensure an active agent exists for the slug in config
    await pool.query('DELETE FROM agents WHERE agent_id = $1', [TRIAGE_AGENT.slug]);
    await pool.query(`
      INSERT INTO agents (fingerprint_hash, agent_id, name, provider, version, registered_by, created_at, is_revoked)
      VALUES ($1, $2, $3, $4, $5, $6, NOW(), false)
    `, [MOCK_FINGERPRINT, TRIAGE_AGENT.slug, 'Test Triage Bot', 'ollama', '1.0.0', '0x123']);
  });

  afterAll(async () => {
    await pool.end();
  });

  it('should generate a verifiable Audit Pack with anchoring proofs', async () => {
    const sessionId = `audit_test_${Date.now()}`;
    
    // 1. Create a chain of events (AI -> Accept -> Amend)
    const aiEvent = await eventService.ingestEvent({
      agent_fingerprint_id: MOCK_FINGERPRINT,
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId,
      input_ref: 'ref_1',
      output_ref: 'ref_2',
      clinical_data: { 
        schemaVersion: 1, 
        vitals: { hr: 80, bp_sys: 120, bp_dia: 80, rr: 16, spo2: 98, temp: 37.0, pain_score: 0 },
        history: { allergies: [], medications: [], pmh: [] },
        chief_complaint: 'Testing Audit Pack',
        age: 45,
        gender: 'M',
        state: 'in_progress'
      }
    });

    await triageService.logClinicianAction(sessionId, 'accepted', 'initial_decision', 'MD Accept');
    await triageService.logClinicianAction(sessionId, 'escalated', 'senior_review', 'MD Senior Review');

    // 2. Mock Anchoring for at least one event
    await anchorService.anchorPendingEvents();

    // 3. Generate Audit Pack
    const pack = await triageService.getAuditPack(sessionId);

    // 4. Verification
    // 4. Verification
    expect(pack.pack_version).toBe('1.0.0-regulatory');
    expect(pack.session!.id).toBe(sessionId);
    expect(pack.session!.effective_state).toBe('escalated');
    
    expect(pack.evidence!.nodes.length).toBe(3);
    expect(pack.evidence!.edges.length).toBe(2);

    // Check verification certificate
    expect(pack.verification_certificate!.audit_status).toBe('verified');
    expect(pack.verification_certificate!.explanation).toContain('Audit Pack was generated from the append-only clinical AI event ledger');

    // Check anchoring data
    const anchoredNode = pack.evidence!.nodes.find((n: any) => n.anchoring.status === 'anchored');
    expect(anchoredNode).toBeDefined();
    if (anchoredNode) {
      expect(anchoredNode.anchoring.merkle_root).toBeDefined();
      expect(anchoredNode.anchoring.tx_hash).toBeDefined();
    }
  });

  it('should flag a failed audit if hashes are tampered with', async () => {
    const sessionId = `tamper_audit_${Date.now()}`;
    
    const event = await eventService.ingestEvent({
      agent_fingerprint_id: MOCK_FINGERPRINT,
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId,
      input_ref: 'ref_1',
      output_ref: 'ref_2',
      clinical_data: { 
        schemaVersion: 1, 
        vitals: { hr: 90, bp_sys: 140, bp_dia: 90, rr: 18, spo2: 97, temp: 37.2, pain_score: 2 },
        history: { allergies: [], medications: [], pmh: [] },
        chief_complaint: 'Tamper Test',
        age: 30,
        gender: 'F',
        state: 'in_progress'
      }
    });

    // Manually corrupt the record in the DB (only possible if we bypass triggers or mutate unanchored rows)
    // Here we'll just test that the service correctly detects it.
    await pool.query('UPDATE agent_events SET reason_code = $1 WHERE session_id = $2', ['clerical_error', sessionId]);

    const pack = await triageService.getAuditPack(sessionId);
    expect(pack.verification_certificate!.audit_status).toBe('failed');
    expect(pack.verification_certificate!.faults.length).toBeGreaterThan(0);
    expect(pack.verification_certificate!.faults[0]).toContain('Integrity Failure');
  });

  it('should maintain hash consistency for events with missing optional fields (Regression Test)', async () => {
    const sessionId = `consistency_test_${Date.now()}`;
    
    // Ingest event with NO clinician_action, NO session_id passed in payload
    // These will be null in the DB, and should be skipped by reconstructed logic
    const event = await eventService.ingestEvent({
      agent_fingerprint_id: MOCK_FINGERPRINT,
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId + '_1',
      input_ref: 'ref_1',
      output_ref: 'ref_2'
      // policy_id is missing (undefined)
    });

    const pack = await triageService.getAuditPack(sessionId + '_1'); 
    expect(pack.verification_certificate!.audit_status).toBe('verified');
    expect(pack.verification_certificate!.faults.length).toBe(0);

    // Test 2: Field is EXPLICITLY null in the DB
    const event2 = await eventService.ingestEvent({
      agent_fingerprint_id: MOCK_FINGERPRINT,
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId + '_2',
      input_ref: 'ref_1',
      output_ref: 'ref_2'
      // explicitly miss policy_id
    });

    const pack2 = await triageService.getAuditPack(sessionId + '_2');
    expect(pack2.verification_certificate!.audit_status).toBe('verified');
  });

  it('should correctly verify legacy records created before the clinical_data upgrade', async () => {
    const sessionId = `legacy_clinical_${Date.now()}`;
    
    // 1. Manually insert a record that looks like it came from the system WITHOUT clinical_data
    // In our current hash logic, missing clinical_data is treated as null
    // But Phase 1 (Regulatory) fields ARE included as null to maintain v1 stability
    const payload = {
      agent_fingerprint_id: MOCK_FINGERPRINT,
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId,
      input_ref: 'ref_legacy_v0',
      output_ref: 'ref_legacy_out',
      policy_id: null,
      clinician_action: null,
      amends_event_id: null,
      reason_code: null,
      reason_text: null
    };
    
    const timestamp = new Date();
    const timestampStr = timestamp.toISOString();
    // Use buildCanonicalPayload to ensure the reference hash matches our standardized contract
    const canonicalPayload = buildCanonicalPayload(payload);
    const legacyHash = generateEventHash(canonicalPayload, null, timestampStr);

    await pool.query(`
      INSERT INTO agent_events (
        event_id, session_id, timestamp, 
        agent_fingerprint_id, model_version, 
        workflow_type, input_ref, output_ref, 
        event_hash, previous_event_hash,
        clinical_data,
        policy_id, clinician_action, amends_event_id, reason_code, reason_text
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `, [
      randomUUID(), sessionId, timestampStr, 
      payload.agent_fingerprint_id, payload.model_version,
      payload.workflow_type, payload.input_ref, payload.output_ref,
      legacyHash, null, null, // clinical_data is null
      null, null, null, null, null // Era 1 fields are null
    ]);

    const pack = await triageService.getAuditPack(sessionId);
    expect(pack.verification_certificate!.audit_status).toBe('verified');
  });
});
