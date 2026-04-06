import { Pool } from 'pg';
import { ethers } from 'ethers';
import { generateEventHash, buildCanonicalPayload, AgentEvent } from '../utils/crypto.utils';

export class AnchorService {
  private db: Pool | any;

  constructor(dbPool: Pool | any) {
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
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db; 
    const shouldRelease = isPool;
    
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
      const validEvents = (events as AgentEvent[]).filter((e: AgentEvent) => isValidHash(e.event_hash));
      const quarantined = (events as AgentEvent[]).filter((e: AgentEvent) => !isValidHash(e.event_hash));

      if (quarantined.length > 0) {
        console.warn(`[AnchorService] Quarantined ${quarantined.length} event(s) with invalid hashes: IDs [${quarantined.map((e: AgentEvent) => e.id).join(', ')}]`);
      }

      if (validEvents.length === 0) {
        await client.query('ROLLBACK');
        return { message: 'All pending events are quarantined (invalid hashes). Run a health check.', count: 0, quarantined: quarantined.length };
      }

      // 3. Build Merkle Root from valid events only
      const leaves = validEvents.map((e: AgentEvent) => e.event_hash);
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
      if (shouldRelease) client.release();
    }
  }


  /**
   * Health/Audit endpoint: Verify local database integrity
   */
  async verifyDatabaseIntegrity(): Promise<{ 
    is_healthy: boolean, 
    total_events_checked: number,
    faults_detected: number,
    failingEventIds: number[],
    impactedEventIds: number[]
  }> {
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;

    try {
      const res = await client.query('SELECT * FROM agent_events ORDER BY id ASC');
      const events = res.rows;
      
      const chains: Record<string, string> = {}; 
      const lastDates: Record<string, Date> = {}; 
      
      const failingEventIds: number[] = [];
      const impactedEventIds: number[] = [];
      const agentChainBroken: Record<string, boolean> = {};

      for (const event of events) {
        const agentId = event.agent_fingerprint_id;
        const expectedPrev = chains[agentId] || null;
        let isDirectFailure = false;
        
        // Check 1: Temporal monotonicity
        const eventTime = new Date(event.timestamp);
        
        if (lastDates[agentId] && eventTime < lastDates[agentId]) {
          isDirectFailure = true;
          failingEventIds.push(event.id);
        }
        lastDates[agentId] = eventTime;

        // Check 3: Recompute Content Hash (Hash Mismatch)
        const reconstructedPayload = buildCanonicalPayload(event);
        const trueHash = generateEventHash(reconstructedPayload, expectedPrev, eventTime.toISOString());
        
        if (trueHash !== event.event_hash) {
          if (!isDirectFailure) {
            isDirectFailure = true;
            failingEventIds.push(event.id);
          }
        }

        // Check 4: Broken Chain / Propagation Check
        if (!isDirectFailure) {
          if (event.previous_event_hash !== expectedPrev) {
            impactedEventIds.push(event.id);
            agentChainBroken[agentId] = true;
          } else if (agentChainBroken[agentId]) {
            impactedEventIds.push(event.id);
          }
        } else {
          // If this row was a direct failure (temporal or hash), it also breaks the chain for followers
          agentChainBroken[agentId] = true;
        }

        chains[agentId] = event.event_hash;
      }

      const totalFaults = failingEventIds.length + impactedEventIds.length;
      return { 
        is_healthy: totalFaults === 0, 
        total_events_checked: events.length, 
        faults_detected: totalFaults,
        failingEventIds,
        impactedEventIds
      };
    } finally {
      if (shouldRelease) client.release();
    }
  }
}
