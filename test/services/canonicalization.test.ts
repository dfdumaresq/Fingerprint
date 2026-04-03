import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { EventService } from '../../src/services/event.service';
import { AnchorService } from '../../src/services/anchor.service';
import dotenv from 'dotenv';
import { generateEventHash } from '../../src/utils/crypto.utils';

dotenv.config({ path: '.env.test' });

const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/fingerprint_test';

describe('Hash Canonicalization - EventService vs AnchorService', () => {
  /**
   * ARCHITECTURAL NOTE ON CANONICALIZATION (v1.0-stabilized):
   * 
   * Our hashing contract distinguishes between top-level SQL columns and JSONB fields:
   * 1. Top-level Columns (policy_id, etc.): Postgres flattens both `undefined` and `null` to SQL NULL.
   *    To ensure stable DB-to-Hash round-trips, we treat BOTH as OMITTED in the canonical payload.
   * 2. JSONB Fields (clinical_data): JSON can distinguish between a missing key and an explicit null.
   *    We preserve this fidelity: missing = omit, null = include.
   */

  let dbPool: Pool;
  let client: any;
  let eventService: EventService;
  let anchorService: AnchorService;

  beforeAll(() => {
    dbPool = new Pool({ connectionString: testDbUrl });
  });

  afterAll(async () => {
    await dbPool.end();
  });

  beforeEach(async () => {
    client = await dbPool.connect();
    await client.query('TRUNCATE TABLE agent_events CASCADE');

    const transactionalPool = {
      connect: async () => ({
        query: client.query.bind(client),
        release: () => {}
      }),
      query: client.query.bind(client)
    } as unknown as Pool;

    eventService = new EventService(transactionalPool);
    anchorService = new AnchorService(transactionalPool);
    (anchorService as any).db = client;
    
    await client.query('BEGIN');
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

 it('should stably canonicalize payloads where optional fields are explicitly null (scalar columns)', async () => {
  const payload = {
    agent_fingerprint_id: 'test-agent-canonical',
    model_version: '1.0',
    workflow_type: 'triage_recommendation',
    input_ref: 'input-1',
    output_ref: 'output-1',
    policy_id: null as any, // Explicitly null
    session_id: null as any,
    clinician_action: null as any,
    amends_event_id: null as any,
    reason_code: null as any,
    reason_text: null as any,
  };

  const client = await dbPool.connect();

  const db = {
    query: client.query.bind(client),
    release: client.release.bind(client), // optional, just to make it client-shaped
  };

  const eventService = new EventService(db as any);
  const anchorService = new AnchorService(db as any);

  try {
    // 1. Ingest event
    await eventService.ingestEvent(payload);

    // 1.5 Confirm the inserted row is actually visible in this test transaction
    const countRes = await client.query(
      'SELECT COUNT(*) AS count FROM agent_events WHERE agent_fingerprint_id = $1',
      [payload.agent_fingerprint_id],
    );
    expect(Number(countRes.rows[0].count)).toBe(1);

    // 2. Fetch directly from DB
    const res = await client.query(
      'SELECT * FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY id DESC LIMIT 1',
      [payload.agent_fingerprint_id],
    );
    const dbRow = res.rows[0];

    // 3. Verify exactly what postgres stored
    expect(dbRow.policy_id).toBeNull();

    // 4. Verify AnchorService reconstructs the payload deterministically (omitting the nulls)
    const health = await anchorService.verifyDatabaseIntegrity();
    expect(health.is_healthy).toBe(true);
  } finally {
    client.release();
  }
});

  it('should stably canonicalize payloads where optional fields are omitted (undefined)', async () => {
    // Only pass the minimal required fields
    const payload = {
      agent_fingerprint_id: 'test-agent-minimal',
      model_version: '1.0',
      workflow_type: 'triage_recommendation',
      input_ref: 'input-minimal',
      output_ref: 'output-minimal',
    };

    // 1. Ingest event
    await eventService.ingestEvent(payload);

    // 2. Fetch directly from DB
    const res = await client.query('SELECT * FROM agent_events WHERE agent_fingerprint_id = $1 LIMIT 1', [payload.agent_fingerprint_id]);
    const dbRow = res.rows[0];

    // 3. Generate reference hash from exact undefined omissions
    const expectedReferencePayload: any = {
      agent_fingerprint_id: payload.agent_fingerprint_id,
      model_version: payload.model_version,
      workflow_type: payload.workflow_type,
      input_ref: payload.input_ref,
      output_ref: payload.output_ref,
      // Omit all optional fields
    };
    
    const trueHash = generateEventHash(expectedReferencePayload, null, dbRow.timestamp.toISOString());
    
    // The DB row's event_hash matches the hash of an object WITH OMITTED session_id/clinical_data keys
    expect(dbRow.event_hash).toBe(trueHash);

    // 4. Verify AnchorService is healthy
    const health = await anchorService.verifyDatabaseIntegrity();
    expect(health.is_healthy).toBe(true);
  });
});
