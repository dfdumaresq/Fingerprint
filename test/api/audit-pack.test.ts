import { Pool } from 'pg';
import { TriageService } from '../../src/services/triage.service';
import { EventService } from '../../src/services/event.service';
import { AnchorService } from '../../src/services/anchor.service';

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

  afterAll(async () => {
    await pool.end();
  });

  it('should generate a verifiable Audit Pack with anchoring proofs', async () => {
    const sessionId = `audit_test_${Date.now()}`;
    
    // 1. Create a chain of events (AI -> Accept -> Amend)
    const aiEvent = await eventService.ingestEvent({
      agent_fingerprint_id: 'triage_agent_001',
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId,
      input_ref: 'ref_1',
      output_ref: 'ref_2'
    });

    await triageService.logClinicianAction(sessionId, 'accepted', 'initial_decision', 'MD Accept');
    await triageService.logClinicianAction(sessionId, 'escalated', 'senior_review', 'MD Senior Review');

    // 2. Mock Anchoring for at least one event
    await anchorService.anchorPendingEvents();

    // 3. Generate Audit Pack
    const pack = await triageService.getAuditPack(sessionId);

    // 4. Verification
    expect(pack.pack_version).toBe('1.0.0-regulatory');
    expect(pack.session.id).toBe(sessionId);
    expect(pack.session.effective_state).toBe('escalated');
    
    expect(pack.evidence.nodes.length).toBe(3);
    expect(pack.evidence.edges.length).toBe(2);

    // Check verification certificate
    expect(pack.verification_certificate.audit_status).toBe('verified');
    expect(pack.verification_certificate.explanation).toContain('Audit Pack was generated from the append-only clinical AI event ledger');

    // Check anchoring data
    const anchoredNode = pack.evidence.nodes.find(n => n.anchoring.status === 'anchored');
    expect(anchoredNode).toBeDefined();
    if (anchoredNode) {
      expect(anchoredNode.anchoring.merkle_root).toBeDefined();
      expect(anchoredNode.anchoring.tx_hash).toBeDefined();
    }
  });

  it('should flag a failed audit if hashes are tampered with', async () => {
    const sessionId = `tamper_audit_${Date.now()}`;
    
    const event = await eventService.ingestEvent({
      agent_fingerprint_id: 'triage_agent_001',
      model_version: 'rules_test',
      workflow_type: 'triage_recommendation',
      session_id: sessionId,
      input_ref: 'ref_1',
      output_ref: 'ref_2'
    });

    // Manually corrupt the record in the DB (only possible if we bypass triggers or mutate unanchored rows)
    // Here we'll just test that the service correctly detects it.
    await pool.query('UPDATE agent_events SET reason_code = $1 WHERE session_id = $2', ['clerical_error', sessionId]);

    const pack = await triageService.getAuditPack(sessionId);
    expect(pack.verification_certificate.audit_status).toBe('failed');
    expect(pack.verification_certificate.faults.length).toBeGreaterThan(0);
    expect(pack.verification_certificate.faults[0]).toContain('Integrity Failure');
  });
});
