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

      // 2. Quarantine events with invalid hashes (tampered/corrupted records)
      // A valid event_hash is a 0x-prefixed 32-byte hex string (66 chars)
      const isValidHash = (h: string) => /^0x[0-9a-fA-F]{64}$/.test(h);
      const validEvents   = events.filter(e => isValidHash(e.event_hash));
      const quarantined   = events.filter(e => !isValidHash(e.event_hash));

      if (quarantined.length > 0) {
        console.warn(`[AnchorService] Quarantined ${quarantined.length} event(s) with invalid hashes: IDs [${quarantined.map(e => e.id).join(', ')}]`);
      }

      if (validEvents.length === 0) {
        await client.query('ROLLBACK');
        return { message: 'All pending events are quarantined (invalid hashes). Run a health check.', count: 0, quarantined: quarantined.length };
      }

      // 3. Build Merkle Root from valid events only
      const leaves = validEvents.map(e => e.event_hash);
      const merkleRoot = this.buildMerkleRoot(leaves);

      // 4. Mock Smart Contract Call (Phase 1)
      console.log(`[AnchorService] Simulating Sepolia Smart Contract call: anchorEvents('${merkleRoot}')`);
      const mockTxHash = `0x${ethers.hexlify(ethers.randomBytes(32)).substring(2)}`;
      
      // 5. Save to merkle_anchors
      const anchorInsert = await client.query(
        `INSERT INTO merkle_anchors (merkle_root, event_count, tx_hash, status) 
         VALUES ($1, $2, $3, 'confirmed') RETURNING id`,
        [merkleRoot, validEvents.length, mockTxHash]
      );
      const anchorId = anchorInsert.rows[0].id;

      // 6. Update only valid events to anchored
      const validIds = validEvents.map(e => e.id);
      await client.query(
        'UPDATE agent_events SET anchored_to_chain = true, merkle_root_id = $1 WHERE id = ANY($2)',
        [anchorId, validIds]
      );

      await client.query('COMMIT');
      return { 
        message: 'Anchored successfully.', 
        count: validEvents.length,
        quarantined: quarantined.length,
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
  async verifyDatabaseIntegrity(): Promise<{ 
    is_healthy: boolean, 
    first_bad_id?: number, 
    reason?: 'hash_mismatch' | 'broken_chain' | 'temporal_violation', 
    total_events_checked: number,
    faults_detected: number
  }> {
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
        return { 
          is_healthy: false, 
          first_bad_id: event.id, 
          reason: 'temporal_violation', 
          total_events_checked: events.length,
          faults_detected: 1 
        };
      }
      lastDates[agentId] = eventTime;

      // Check 2: Broken Chain Check
      if (event.previous_event_hash !== expectedPrev) {
        return { 
          is_healthy: false, 
          first_bad_id: event.id, 
          reason: 'broken_chain', 
          total_events_checked: events.length,
          faults_detected: 1 
        };
      }
      
      // Check 3: Recompute Content Hash (Hash Mismatch)
      const reconstructedPayload: any = {
        agent_fingerprint_id: event.agent_fingerprint_id,
        model_version: event.model_version,
        workflow_type: event.workflow_type,
        input_ref: event.input_ref,
        output_ref: event.output_ref
      };
      
      if (event.policy_id !== null) reconstructedPayload.policy_id = event.policy_id;
      if (event.session_id !== null) reconstructedPayload.session_id = event.session_id;
      if (event.clinician_action !== null) reconstructedPayload.clinician_action = event.clinician_action;
      
      const trueHash = generateEventHash(reconstructedPayload, expectedPrev, eventTime.toISOString());
      if (trueHash !== event.event_hash) {
         return { 
           is_healthy: false, 
           first_bad_id: event.id, 
           reason: 'hash_mismatch', 
           total_events_checked: events.length,
           faults_detected: 1 
         };
      }

      chains[agentId] = event.event_hash;
    }

    return { is_healthy: true, total_events_checked: events.length, faults_detected: 0 };
  }
}
