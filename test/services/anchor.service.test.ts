import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { AnchorService } from '../../src/services/anchor.service';
import { Pool } from 'pg';
import { ethers } from 'ethers';

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

describe('AnchorService', () => {
  let dbPool: any;
  let client: any;
  let anchorService: AnchorService;

  beforeEach(() => {
    dbPool = new Pool();
    client = dbPool.connect();
    anchorService = new AnchorService(dbPool);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Merkle Root Generation via anchorPendingEvents', () => {
    it('should generate a valid Merkle Root for pending events', async () => {
      const mockLeaves = [
        { id: 1, event_hash: ethers.id('leaf1') },
        { id: 2, event_hash: ethers.id('leaf2') },
        { id: 3, event_hash: ethers.id('leaf3') }
        // 3 leaves means the algorithm must duplicate the last leaf dynamically
      ];

      client.query.mockResolvedValueOnce({ rows: [] } as never); // BEGIN
      client.query.mockResolvedValueOnce({ rows: mockLeaves } as never); // SELECT FOR UPDATE
      client.query.mockResolvedValueOnce({ rows: [{ id: 101 }] } as never); // INSERT MERKLE ANCHOR
      client.query.mockResolvedValueOnce({ rows: [] } as never); // UPDATE EVENTS
      client.query.mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await anchorService.anchorPendingEvents();
      
      expect(result.count).toBe(3);
      expect(result.merkleRoot).toBeDefined();
      
      // Keccak256 output is a 66-character bytes32 string (0x + 64 hex chars)
      expect(result.merkleRoot).toMatch(/^0x[a-f0-9]{64}$/i);
    });

    it('should handle zero pending events gracefully', async () => {
      client.query.mockResolvedValueOnce({ rows: [] } as never); // BEGIN
      client.query.mockResolvedValueOnce({ rows: [] } as never); // SELECT (empty)
      client.query.mockResolvedValueOnce({ rows: [] } as never); // COMMIT

      const result = await anchorService.anchorPendingEvents();
      
      expect(result.count).toBe(0);
      expect(result.message).toBe('No pending events to anchor.');
    });
  });

  describe('Database Integrity Constraints via verifyDatabaseIntegrity', () => {
    it('should report healthy if the hash-chain is mathematically sound', async () => {
      // Mock db returns correctly chained events
      dbPool.query.mockResolvedValueOnce({
        rows: [
          { id: 1, agent_fingerprint_id: 'agentA', previous_event_hash: null, event_hash: 'hash1' },
          { id: 2, agent_fingerprint_id: 'agentA', previous_event_hash: 'hash1', event_hash: 'hash2' },
          { id: 3, agent_fingerprint_id: 'agentB', previous_event_hash: null, event_hash: 'hashB1' },
        ]
      } as never);

      const health = await anchorService.verifyDatabaseIntegrity();
      
      expect(health.total_events_checked).toBe(3);
      expect(health.faults_detected).toBe(0);
      expect(health.is_healthy).toBe(true);
    });

    it('should catch manipulation and report unhealthy if a link in the chain is broken', async () => {
      // Mock db returns a broken chain (DB manipulation occurred!)
      dbPool.query.mockResolvedValueOnce({
        rows: [
          { id: 1, agent_fingerprint_id: 'agentX', previous_event_hash: null, event_hash: 'hash1' },
          // The database expected prev: 'hash1', but hacker altered the next row to point to 'TAMPERED_HASH'
          { id: 2, agent_fingerprint_id: 'agentX', previous_event_hash: 'TAMPERED_HASH', event_hash: 'hash2' }, 
        ]
      } as never);

      const health = await anchorService.verifyDatabaseIntegrity();
      
      expect(health.faults_detected).toBe(1);
      expect(health.is_healthy).toBe(false);
    });
  });
});
