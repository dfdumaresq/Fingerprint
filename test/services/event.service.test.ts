import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { EventService, ClinicalEventPayload } from '../../src/services/event.service';
import { Pool } from 'pg';

jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  const mPool = {
    connect: jest.fn(() => mClient),
    query: jest.fn(),
  };
  return { Pool: jest.fn(() => mPool) };
});

jest.mock('uuid', () => ({
  v4: () => 'mock-uuid-1234'
}));

describe('EventService', () => {
  let dbPool: any;
  let client: any;
  let eventService: EventService;

  beforeEach(() => {
    dbPool = new Pool();
    client = dbPool.connect();
    eventService = new EventService(dbPool);
    
    // Freeze time so we can test deterministic hashing
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-03-28T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
  });

  const basePayload: ClinicalEventPayload = {
    agent_fingerprint_id: '0x123abc',
    model_version: 'v1.0',
    workflow_type: 'triage_recommendation',
    input_ref: 'ipfs://QmInput',
    output_ref: 'ipfs://QmOutput'
  };

  describe('ingestEvent (Hash-Chaining & Canonicalization)', () => {

    it('should generate identical hashes for identically semantic payloads regardless of key order', async () => {
      // Mock db returns no previous events
      client.query.mockResolvedValueOnce({ rows: [] } as never); // BEGIN
      client.query.mockResolvedValueOnce({ rows: [] } as never); // SELECT FOR UPDATE
      client.query.mockResolvedValueOnce({ rows: [{ event_hash: 'hash1' }] } as never); // INSERT
      client.query.mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      // Payload A
      await eventService.ingestEvent(basePayload);
      
      const insertCallA = client.query.mock.calls[2] as any;
      const eventHashA = insertCallA[1][11]; // eventHash is index 11

      // Reset client mock for payload B
      client.query.mockClear();
      client.query.mockResolvedValueOnce({ rows: [] } as never);
      client.query.mockResolvedValueOnce({ rows: [] } as never);
      client.query.mockResolvedValueOnce({ rows: [{ event_hash: 'hash2' }] } as never);
      client.query.mockResolvedValueOnce({ rows: [] } as never);

      // Payload B: Same data, different physical key order (via Object.keys creation)
      const reorderedPayload = {
        output_ref: 'ipfs://QmOutput',
        model_version: 'v1.0',
        input_ref: 'ipfs://QmInput',
        workflow_type: 'triage_recommendation',
        agent_fingerprint_id: '0x123abc'
      };

      await eventService.ingestEvent(reorderedPayload as ClinicalEventPayload);
      
      const insertCallB = client.query.mock.calls[2] as any;
      const eventHashB = insertCallB[1][11];

      // Exact match guarantees canonicalization works
      expect(eventHashA).toEqual(eventHashB);
    });

    it('should chain accurately to the previous event hash', async () => {
      const PREV_HASH = '0xabc123';
      const CURRENT_TIME = new Date('2026-03-28T12:00:00.000Z');

      client.query.mockResolvedValueOnce({ rows: [] } as never); // BEGIN
      client.query.mockResolvedValueOnce({ rows: [{ event_hash: PREV_HASH }] } as never); // SELECT FOR UPDATE
      client.query.mockResolvedValueOnce({ rows: [{ event_hash: 'new_hash' }] } as never); // INSERT
      client.query.mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      await eventService.ingestEvent(basePayload);

      const insertCall = client.query.mock.calls[2] as any;
      const insertedPrevHash = insertCall[1][10]; // previousHash is index 10

      expect(insertedPrevHash).toBe(PREV_HASH);
    });
    
    it('should rollback transaction if insertion fails', async () => {
      client.query.mockResolvedValueOnce({ rows: [] } as never); // BEGIN
      client.query.mockResolvedValueOnce({ rows: [] } as never); // SELECT
      client.query.mockRejectedValueOnce(new Error('DB Constraint Failure')); // INSERT Failure
      client.query.mockResolvedValueOnce({ rows: [] } as never); // ROLLBACK
      
      await expect(eventService.ingestEvent(basePayload)).rejects.toThrow('DB Constraint Failure');
      
      expect(client.query).toHaveBeenNthCalledWith(4, 'ROLLBACK');
      expect(client.release).toHaveBeenCalled();
    });
  });

});
