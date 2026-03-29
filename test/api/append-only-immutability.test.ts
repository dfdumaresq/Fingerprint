import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import { Pool } from 'pg';
import { EventService } from '../../src/services/event.service';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/fingerprint_test';

describe('Append-Only Immutability - Anchored Event Protection', () => {
  let dbPool: Pool;
  let client: any;
  let eventService: EventService;
  const agentId = 'immutability-test-agent';

  beforeAll(() => {
    dbPool = new Pool({ connectionString: testDbUrl });
  });

  afterAll(async () => {
    await dbPool.end();
  });

  beforeEach(async () => {
    client = await dbPool.connect();

    // Wrap EventService in our transaction
    const transactionalPool = {
      connect: async () => ({
        query: client.query.bind(client),
        release: () => {},
      }),
      query: client.query.bind(client),
    } as unknown as Pool;

    eventService = new EventService(transactionalPool);

    await client.query('BEGIN');

    // Seed two events
    await eventService.ingestEvent({
      agent_fingerprint_id: agentId,
      model_version: 'test-1.0',
      workflow_type: 'triage_recommendation',
      input_ref: 'input-0',
      output_ref: 'output-0',
    });
    await new Promise(r => setTimeout(r, 10));
    await eventService.ingestEvent({
      agent_fingerprint_id: agentId,
      model_version: 'test-1.0',
      workflow_type: 'triage_recommendation',
      clinician_action: 'accepted',
      input_ref: 'input-1',
      output_ref: 'output-1',
    });
  });

  afterEach(async () => {
    await client.query('ROLLBACK');
    client.release();
  });

  // ── Helper: anchor all pending events for this agent ──
  async function anchorEvents() {
    await client.query(
      `UPDATE agent_events SET anchored_to_chain = true WHERE agent_fingerprint_id = $1`,
      [agentId]
    );
  }

  // ── Helper: get the id of the first event ──
  async function getFirstEventId(): Promise<number> {
    const res = await client.query(
      `SELECT id FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY id ASC LIMIT 1`,
      [agentId]
    );
    return res.rows[0].id;
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Anchoring metadata UPDATE should succeed
  // ═══════════════════════════════════════════════════════════════════════════

  it('should ALLOW setting anchored_to_chain and merkle_root_id on a pending event', async () => {
    const eventId = await getFirstEventId();

    // This is what AnchorService.anchorPendingEvents() does — must always work
    // (merkle_root_id left NULL here to avoid FK constraint; real anchoring creates the anchor row first)
    await expect(
      client.query(
        `UPDATE agent_events SET anchored_to_chain = true WHERE id = $1`,
        [eventId]
      )
    ).resolves.not.toThrow();

    const check = await client.query(`SELECT anchored_to_chain FROM agent_events WHERE id = $1`, [eventId]);
    expect(check.rows[0].anchored_to_chain).toBe(true);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Content mutation on anchored row should be BLOCKED
  // ═══════════════════════════════════════════════════════════════════════════

  it('should BLOCK updating clinician_action on an anchored event', async () => {
    await anchorEvents();
    const eventId = await getFirstEventId();

    await expect(
      client.query(`UPDATE agent_events SET clinician_action = 'escalated' WHERE id = $1`, [eventId])
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it('should BLOCK updating event_hash on an anchored event', async () => {
    await anchorEvents();
    const eventId = await getFirstEventId();

    await expect(
      client.query(`UPDATE agent_events SET event_hash = '0xdeadbeef' WHERE id = $1`, [eventId])
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it('should BLOCK updating model_version on an anchored event', async () => {
    await anchorEvents();
    const eventId = await getFirstEventId();

    await expect(
      client.query(`UPDATE agent_events SET model_version = 'tampered-2.0' WHERE id = $1`, [eventId])
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it('should BLOCK updating input_ref on an anchored event', async () => {
    await anchorEvents();
    const eventId = await getFirstEventId();

    await expect(
      client.query(`UPDATE agent_events SET input_ref = 'tampered-input' WHERE id = $1`, [eventId])
    ).rejects.toThrow(/IMMUTABLE/);
  });

  it('should BLOCK updating timestamp on an anchored event', async () => {
    await anchorEvents();
    const eventId = await getFirstEventId();

    await expect(
      client.query(`UPDATE agent_events SET timestamp = NOW() - INTERVAL '1 day' WHERE id = $1`, [eventId])
    ).rejects.toThrow(/IMMUTABLE/);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Content mutation on PENDING row should still be allowed
  // ═══════════════════════════════════════════════════════════════════════════

  it('should ALLOW updating clinician_action on a PENDING (unanchored) event', async () => {
    // Do NOT anchor — explicitly fetch an unanchored row
    const res = await client.query(
      `SELECT id FROM agent_events WHERE agent_fingerprint_id = $1 AND anchored_to_chain = false ORDER BY id ASC LIMIT 1`,
      [agentId]
    );
    const eventId = res.rows[0].id;

    await expect(
      client.query(`UPDATE agent_events SET clinician_action = 'escalated' WHERE id = $1`, [eventId])
    ).resolves.not.toThrow();

    const check = await client.query(`SELECT clinician_action FROM agent_events WHERE id = $1`, [eventId]);
    expect(check.rows[0].clinician_action).toBe('escalated');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Re-anchoring (idempotent) should succeed
  // ═══════════════════════════════════════════════════════════════════════════

  it('should ALLOW re-setting anchored_to_chain on an already-anchored event (no-op)', async () => {
    await anchorEvents();
    const eventId = await getFirstEventId();

    // Setting anchored_to_chain=true again (same value) — trigger allows it
    await expect(
      client.query(`UPDATE agent_events SET anchored_to_chain = true WHERE id = $1`, [eventId])
    ).resolves.not.toThrow();
  });
});
