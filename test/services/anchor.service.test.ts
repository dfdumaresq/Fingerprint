import { describe, expect, it, beforeEach, jest, afterEach } from '@jest/globals';
import { AnchorService } from '../../src/services/anchor.service';
import { Pool } from 'pg';
import { ethers } from 'ethers';
import { generateEventHash, buildCanonicalPayload } from '../../src/utils/crypto.utils';

jest.mock('../../src/utils/crypto.utils', () => {
  const actual = jest.requireActual('../../src/utils/crypto.utils') as any;
  return {
    ...actual,
    generateEventHash: jest.fn(actual.generateEventHash)
  };
});
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
        { id: 1, event_hash: ethers.keccak256(ethers.toUtf8Bytes('leaf1')) },
        { id: 2, event_hash: ethers.keccak256(ethers.toUtf8Bytes('leaf2')) },
        { id: 3, event_hash: ethers.keccak256(ethers.toUtf8Bytes('leaf3')) }
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
      // Mock data that passes validation
      const e1 = { 
        agent_fingerprint_id: 'agentA', 
        model_version: '1.0', 
        workflow_type: 'triage_recommendation',
        input_ref: 'in1',
        output_ref: 'out1',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        previous_event_hash: null 
      };
      const h1 = generateEventHash(buildCanonicalPayload(e1), null, e1.timestamp.toISOString());
      
      const e2 = { 
        agent_fingerprint_id: 'agentA', 
        model_version: '1.0', 
        workflow_type: 'triage_recommendation',
        input_ref: 'in2',
        output_ref: 'out2',
        timestamp: new Date('2025-01-01T10:01:00Z'),
        previous_event_hash: h1 
      };
      const h2 = generateEventHash(buildCanonicalPayload(e2), h1, e2.timestamp.toISOString());

      client.query.mockResolvedValueOnce({
        rows: [
          { ...e1, id: 1, event_hash: h1, timestamp: e1.timestamp },
          { ...e2, id: 2, event_hash: h2, timestamp: e2.timestamp },
        ]
      } as never);

      const health = await anchorService.verifyDatabaseIntegrity();
      
      expect(health.total_events_checked).toBe(2);
      expect(health.is_healthy).toBe(true);
    });

    it('should catch manipulation and report unhealthy if a link in the chain is broken', async () => {
      // Mock data where Row 1 is valid, but Row 2 has a broken previous_event_hash
      const e1 = { 
        agent_fingerprint_id: 'agentX', 
        model_version: '1.0', 
        workflow_type: 'triage_recommendation',
        input_ref: 'in1',
        output_ref: 'out1',
        timestamp: new Date('2025-01-01T10:00:00Z'),
        previous_event_hash: null 
      };
      const h1 = generateEventHash(buildCanonicalPayload(e1), null, e1.timestamp.toISOString());

      client.query.mockResolvedValueOnce({
        rows: [
          { ...e1, id: 1, event_hash: h1, timestamp: e1.timestamp },
          { 
            id: 2, agent_fingerprint_id: 'agentX', model_version: '1.0', workflow_type: 'triage_recommendation',
            input_ref: 'in2', output_ref: 'out2',
            timestamp: new Date('2025-01-01T10:01:00Z'), previous_event_hash: 'TAMPERED_HASH', event_hash: 'hash2' 
          }, 
        ]
      } as never);

      const health = await anchorService.verifyDatabaseIntegrity();
      
      expect(health.is_healthy).toBe(false);
      expect(health.impactedEventIds).toContain(2);
    });

    it('should detect a broken cryptographic chain (temporal violation)', async () => {
      // Mock data where Row 2 is BEFORE Row 1
      const e1 = { 
        agent_fingerprint_id: 'agentT', 
        model_version: '1.0', 
        workflow_type: 'triage_recommendation',
        input_ref: 'in1',
        output_ref: 'out1',
        timestamp: new Date('2025-01-01T10:05:00Z'),
        previous_event_hash: null 
      };
      const h1 = generateEventHash(buildCanonicalPayload(e1), null, e1.timestamp.toISOString());

      client.query.mockResolvedValueOnce({
        rows: [
          { ...e1, id: 1, event_hash: h1, timestamp: e1.timestamp },
          { 
            id: 2, agent_fingerprint_id: 'agentT', model_version: '1.0', workflow_type: 'triage_recommendation',
            input_ref: 'in2', output_ref: 'out2',
            timestamp: new Date('2025-01-01T10:00:00Z'), previous_event_hash: h1, event_hash: 'hash2' 
          }, 
        ]
      } as never);

      const health = await anchorService.verifyDatabaseIntegrity();
      expect(health.is_healthy).toBe(false);
      expect(health.failingEventIds).toContain(2);
    });
  });
});
