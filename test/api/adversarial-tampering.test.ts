import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { AnchorService } from '../../src/services/anchor.service';
import { EventService } from '../../src/services/event.service';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/fingerprint_test';

describe('Adversarial Tampering - DB Ledger Integrity', () => {
  let dbPool: Pool;
  let client: any;
  let anchorService: AnchorService;
  let eventService: EventService;
  const agentId = 'adversarial-agent-123';

  beforeAll(() => {
    dbPool = new Pool({ connectionString: testDbUrl });
  });

  afterAll(async () => {
    await dbPool.end();
  });

  beforeEach(async () => {
    client = await dbPool.connect();
    
    // TRUNCATE to avoid state-leakage from parallel test suites
    await client.query('TRUNCATE TABLE agent_events CASCADE');
    
    anchorService = new AnchorService(dbPool);
    // Explicitly pass the connected transaction client to the Service to maintain the transaction envelope
    // Note: The EventService is built assuming pool semantics. We override `.connect()` locally 
    // to force it to use our transaction client!
    const transactionalPool = {
      connect: async () => {
        return {
          query: client.query.bind(client),
          release: () => {} // NOOP so it doesn't close out our transaction
        };
      },
      query: client.query.bind(client)
    } as unknown as Pool;
    
    eventService = new EventService(transactionalPool);

    await client.query('BEGIN');
    
    // Seed valid chain
    for(let i=0; i<5; i++) {
        await eventService.ingestEvent({
            agent_fingerprint_id: agentId,
            model_version: 'test-1.0',
            workflow_type: 'triage_recommendation',
            clinician_action: 'accepted',
            input_ref: `input-${i}`,
            output_ref: `output-${i}`
        });
        // small sleep to ensure strictly increasing timestamps
        await new Promise(r => setTimeout(r, 10));
    }
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  it('Control: valid chain should pass Health Audit unconditionally', async () => {
    // Override anchor service db temporarily inside the transaction
    (anchorService as any).db = client;
    const health = await anchorService.verifyDatabaseIntegrity();
    expect(health.is_healthy).toBe(true);
    expect(health.total_events_checked).toBeGreaterThanOrEqual(5);
  });

  it('Tamper Test 1: Content Update (clinician_action)', async () => {
    // Attack: Change action from accepted to overridden directly in DB
    const res = await client.query('SELECT id, event_hash FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY timestamp ASC LIMIT 1 OFFSET 2', [agentId]);
    const tamperedId = res.rows[0].id;

    await client.query("UPDATE agent_events SET clinician_action = 'overridden' WHERE id = $1", [tamperedId]);

    (anchorService as any).db = client;
    const health = await anchorService.verifyDatabaseIntegrity();
    
    expect(health.is_healthy).toBe(false);
    expect(health.failingEventIds).toContain(tamperedId);
  });

  it('Tamper Test 2: Chain Deletion', async () => {
    // Attack: Delete middle event
    const res = await client.query('SELECT id FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY timestamp ASC LIMIT 1 OFFSET 2', [agentId]);
    const deletedId = res.rows[0].id;

    const nextRes = await client.query('SELECT id FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY timestamp ASC LIMIT 1 OFFSET 3', [agentId]);
    const nextId = nextRes.rows[0].id;

    await client.query("DELETE FROM agent_events WHERE id = $1", [deletedId]);

    (anchorService as any).db = client;
    const health = await anchorService.verifyDatabaseIntegrity();
    
    expect(health.is_healthy).toBe(false);
    expect(health.impactedEventIds).toContain(nextId);
  });

  it('Tamper Test 3: Temporal Forgery', async () => {
    // Attack: Insert event out of temporal order (back-dated)
    // First, let's grab the hash of the second event to forge a fake branch
    const res = await client.query('SELECT event_hash, timestamp FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY timestamp ASC LIMIT 1 OFFSET 1', [agentId]);
    const prevHash = res.rows[0].event_hash;
    
    // Create an event backdated 1 minute before the first event!
    const forgeDate = new Date(res.rows[0].timestamp.getTime() - 60000).toISOString();
    
    // Create a forged Keccak256 hash
    const fakeHash = '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470';
    
    // We expect temporal_violation or broken_chain
    await client.query(`
      INSERT INTO agent_events (
        event_id, agent_fingerprint_id, timestamp, workflow_type, model_version, input_ref, output_ref, clinician_action, previous_event_hash, event_hash
      ) VALUES (
        gen_random_uuid(), $1, $2, 'triage_recommendation', 'test-1.0', 'forged-in', 'forged-out', 'accepted', $3, $4
      ) RETURNING id
    `, [agentId, forgeDate, prevHash, fakeHash]);

    (anchorService as any).db = client;
    const health = await anchorService.verifyDatabaseIntegrity();
    
    expect(health.is_healthy).toBe(false);
    expect(health.failingEventIds.length).toBeGreaterThan(0);
  });
});
