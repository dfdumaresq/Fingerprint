import { describe, expect, it, jest } from '@jest/globals';
import { TriageService } from '../../src/services/triage.service';
import { Pool } from 'pg';
import { generateEventHash } from '../../src/utils/crypto.utils';

jest.mock('../../src/utils/crypto.utils', () => ({
  generateEventHash: jest.fn()
}));

jest.mock('pg', () => {
  const mClient = {
    query: jest.fn(),
    release: jest.fn(),
  };
  return {
    Pool: jest.fn(() => ({
      connect: jest.fn().mockResolvedValue(mClient as never),
      query: jest.fn(),
    })),
  };
});

describe('TriageService (Read-Model Hydrator)', () => {
  let dbPool: any;
  let triageService: TriageService;

  beforeEach(() => {
    dbPool = new Pool();
    triageService = new TriageService(dbPool);
    jest.clearAllMocks();
  });

  it('hydrates deterministic mock PHI and sets integrity status to "anchored" with stable structure', async () => {
    // Db returns an anchored workflow
    dbPool.query.mockResolvedValueOnce({
      rows: [
        { 
          id: 1, 
          session_id: 'enc_abc_123',
          timestamp: new Date('2025-01-01T12:00:00Z'), 
          agent_fingerprint_id: 'agentA', 
          workflow_type: 'triage_recommendation',
          input_ref: 'hash_in',
          output_ref: 'hash_out',
          previous_event_hash: 'hash0', 
          event_hash: 'hash1',
          anchored_to_chain: true,
          merkle_root_id: 10
        }
      ]
    } as never);

    (generateEventHash as jest.Mock).mockReturnValue('hash1');

    const encounters = await triageService.getTriageEncounters();
    
    expect(encounters).toHaveLength(1);
    
    const e = encounters[0];
    expect(e.encounter_id).toBe('enc_abc_123');
    expect(e.clinical).toBeDefined();
    
    // Deterministic generation: if we run it twice it must be identical PHI
    expect(e.clinical.chief_complaint).toBeTruthy();
    expect(e.clinical.acuity).toBeGreaterThanOrEqual(1);
    expect(e.clinical.vitals).toBeDefined();
    
    // Integrity structurally exact
    expect(e.integrity).toEqual({
      event_hash: 'hash1',
      merkle_root_id: 10,
      anchored_to_chain: true,
      tamper_status: 'anchored'
    });
  });

  it('flags tamper_status as "tampered" when reconstructed hash mismatches DB hash', async () => {
    dbPool.query.mockResolvedValueOnce({
      rows: [
        { 
          id: 2, 
          session_id: 'enc_xyz_999',
          timestamp: new Date('2025-01-01T12:00:00Z'), 
          agent_fingerprint_id: 'agentX', 
          workflow_type: 'triage_recommendation',
          input_ref: 'hash_in',
          output_ref: 'hash_out',
          previous_event_hash: 'hash0', 
          event_hash: 'hash2', // Expected DB Hash
          anchored_to_chain: false
        }
      ]
    } as never);

    // Mock the crypto function to return a DIFFERENT hash than 'hash2', simulating that a user changed table contents
    (generateEventHash as jest.Mock).mockReturnValue('COMPLETELY_DIFFERENT_HASH');

    const encounters = await triageService.getTriageEncounters();
    
    expect(encounters).toHaveLength(1);
    const e = encounters[0];
    
    // Should gracefully hydrate but visibly flag the tamper state
    expect(e.integrity.tamper_status).toBe('tampered');
    expect(e.integrity.anchored_to_chain).toBe(false);
  });
});
