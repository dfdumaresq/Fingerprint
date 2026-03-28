import { Pool } from 'pg';
import { ethers } from 'ethers';
import { generateEventHash } from '../utils/crypto.utils';

export class AnchorService {
  private db: Pool;

  constructor(dbPool: Pool) {
    this.db = dbPool;
  }

  /**
   * Helper to hash two child nodes in the Merkle tree
   */
  private hashPair(a: string, b: string): string {
    // Sort to ensure deterministic hashing regardless of order
    const [first, second] = [a, b].sort();
    return ethers.solidityPackedKeccak256(['bytes32', 'bytes32'], [first, second]);
  }

  /**
   * Builds a simple Merkle Root from an array of event hashes
   */
  private buildMerkleRoot(leaves: string[]): string {
    if (leaves.length === 0) return ethers.ZeroHash;
    if (leaves.length === 1) return leaves[0];

    const nextLayer: string[] = [];
    for (let i = 0; i < leaves.length; i += 2) {
      if (i + 1 === leaves.length) {
        // Odd number of leaves, duplicate the last one
        nextLayer.push(this.hashPair(leaves[i], leaves[i]));
      } else {
        nextLayer.push(this.hashPair(leaves[i], leaves[i + 1]));
      }
    }

    return this.buildMerkleRoot(nextLayer);
  }

  /**
   * Background task: Anchor all unanchored events to the blockchain
   */
  async anchorPendingEvents() {
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // 1. Fetch pending events
      const res = await client.query(
        'SELECT id, event_hash FROM agent_events WHERE anchored_to_chain = false FOR UPDATE SKIP LOCKED'
      );

      const events = res.rows;
      if (events.length === 0) {
        await client.query('COMMIT');
        return { message: 'No pending events to anchor.', count: 0 };
      }

      // 2. Build Merkle Root
      const leaves = events.map(e => e.event_hash);
      const merkleRoot = this.buildMerkleRoot(leaves);

      // 3. Mock Smart Contract Call (Phase 1)
      console.log(`[AnchorService] Simulating Sepolia Smart Contract call: anchorEvents('${merkleRoot}')`);
      const mockTxHash = `0x${ethers.hexlify(ethers.randomBytes(32)).substring(2)}`;
      
      // 4. Save to merkle_anchors
      const anchorInsert = await client.query(
        `INSERT INTO merkle_anchors (merkle_root, event_count, tx_hash, status) 
         VALUES ($1, $2, $3, 'confirmed') RETURNING id`,
        [merkleRoot, events.length, mockTxHash]
      );
      const anchorId = anchorInsert.rows[0].id;

      // 5. Update events to anchored
      const eventIds = events.map(e => e.id);
      await client.query(
        'UPDATE agent_events SET anchored_to_chain = true, merkle_root_id = $1 WHERE id = ANY($2)',
        [anchorId, eventIds]
      );

      await client.query('COMMIT');
      return { 
        message: 'Anchored successfully.', 
        count: events.length, 
        merkleRoot, 
        txHash: mockTxHash 
      };
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  /**
   * Health/Audit endpoint: Verify local database integrity
   */
  async verifyDatabaseIntegrity(): Promise<{ ok: boolean, firstBadId?: number, reason?: 'hash_mismatch' | 'broken_chain' | 'temporal_violation', total_events: number }> {
    const res = await this.db.query('SELECT * FROM agent_events ORDER BY agent_fingerprint_id, timestamp ASC');
    const events = res.rows;
    
    const chains: Record<string, string> = {}; // track latest hash per agent
    const lastDates: Record<string, Date> = {}; // track latest temporal clock
    
    for (const event of events) {
      const agentId = event.agent_fingerprint_id;
      const expectedPrev = chains[agentId] || null;
      
      // Check 1: Temporal monotonicity
      const eventTime = new Date(event.timestamp);
      if (lastDates[agentId] && eventTime < lastDates[agentId]) {
        return { ok: false, firstBadId: event.id, reason: 'temporal_violation', total_events: events.length };
      }
      lastDates[agentId] = eventTime;

      // Check 2: Broken Chain Check
      if (event.previous_event_hash !== expectedPrev) {
        return { ok: false, firstBadId: event.id, reason: 'broken_chain', total_events: events.length };
      }
      
      // Check 3: Recompute Content Hash (Hash Mismatch)
      const reconstructedPayload: any = {
        agent_fingerprint_id: event.agent_fingerprint_id,
        model_version: event.model_version,
        workflow_type: event.workflow_type,
        input_ref: event.input_ref,
        output_ref: event.output_ref
      };
      
      // Map postgres null fields back to undefined so stringify drops them exactly like the original JSON payload did
      if (event.policy_id !== null) reconstructedPayload.policy_id = event.policy_id;
      if (event.session_id !== null) reconstructedPayload.session_id = event.session_id;
      if (event.clinician_action !== null) reconstructedPayload.clinician_action = event.clinician_action;
      
      const trueHash = generateEventHash(reconstructedPayload, expectedPrev, eventTime.toISOString());
      if (trueHash !== event.event_hash) {
         return { ok: false, firstBadId: event.id, reason: 'hash_mismatch', total_events: events.length };
      }

      chains[agentId] = event.event_hash;
    }

    return { ok: true, total_events: events.length };
  }
}
