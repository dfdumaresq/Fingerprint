import { Pool } from 'pg';
import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import stringify from 'fast-json-stable-stringify';
import { generateEventHash, buildCanonicalPayload } from '../utils/crypto.utils';

export interface ClinicalEventPayload {
  agent_fingerprint_id: string;
  model_version: string;
  workflow_type: string;
  policy_id?: string;
  session_id?: string;
  clinician_action?: string;
  input_ref: string;
  output_ref: string;
  
  // Provenance Fields
  amends_event_id?: string;
  reason_code?: string;
  reason_text?: string;
  
  // Structured clinical payload (Zero-PHI)
  clinical_data?: any;
}

export class EventService {
  private db: Pool;

  constructor(dbPool: Pool) {
    this.db = dbPool;
  }

  /**
   * Ingest a new medical AI event into the append-only ledger
   */
  async ingestEvent(payload: ClinicalEventPayload) {
    // Determine if we should use a fresh pool connection or an injected transactional client
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;
    
    try {
      if (shouldRelease) await client.query('BEGIN');

      // 1. Find the latest event for this agent to chain off of
      const lastEventRes = await client.query(
        'SELECT event_hash FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [payload.agent_fingerprint_id]
      );
      
      const previousHash = lastEventRes.rows.length > 0 ? lastEventRes.rows[0].event_hash : null;

      // 2. Server asserts the timestamp (normalized to ms for cross-platform hash stability)
      const now = new Date();
      const timestamp = new Date(Math.floor(now.getTime() / 1000) * 1000); // Strip ms if needed? No, JS uses ms.
      // Actually, just using a stable ISO string is best.
      const timestampStr = now.toISOString();

      // 3. Compute immutable Event Hash (server-authoritative)
      // Pass the full payload to ensure aliases and refined null-omission are handled centrally.
      const hashPayload = buildCanonicalPayload(payload);

      const eventHash = generateEventHash(hashPayload, previousHash, timestampStr);

      // 4. Insert into append-only log (use the EXACT string used for hash)
      const insertQuery = `
        INSERT INTO agent_events (
          event_id, session_id, timestamp, 
          agent_fingerprint_id, model_version, 
          workflow_type, policy_id, clinician_action, 
          input_ref, output_ref, 
          previous_event_hash, event_hash,
          amends_event_id, reason_code, reason_text,
          clinical_data
        ) VALUES (
          $1, $2, $3, 
          $4, $5, 
          $6, $7, $8, 
          $9, $10, 
          $11, $12,
          $13, $14, $15,
          $16
        ) RETURNING id, event_id, event_hash, timestamp, previous_event_hash
      `;
      
      const eventId = randomUUID();
      
      const result = await client.query(insertQuery, [
        eventId, payload.session_id, timestampStr, // Use string
        payload.agent_fingerprint_id, payload.model_version,
        payload.workflow_type, payload.policy_id, payload.clinician_action,
        payload.input_ref, payload.output_ref,
        previousHash, eventHash,
        payload.amends_event_id, payload.reason_code, payload.reason_text,
        payload.clinical_data
      ]);

      if (shouldRelease) await client.query('COMMIT');
      
      return result.rows[0];
    } catch (e) {
      if (shouldRelease) await client.query('ROLLBACK');
      throw e;
    } finally {
      if (shouldRelease) client.release();
    }
  }

  /**
   * Fetch recent medical events for the audit dashboard
   */
  async getEvents(filters: { agent_fingerprint_id?: string, days_back?: number }) {
    let query = 'SELECT * FROM agent_events WHERE 1=1';
    const params: any[] = [];
    
    if (filters.agent_fingerprint_id) {
      params.push(filters.agent_fingerprint_id);
      query += ` AND agent_fingerprint_id = $${params.length}`;
    }
    
    if (filters.days_back) {
      params.push(filters.days_back);
      query += ` AND timestamp >= NOW() - ($${params.length} * INTERVAL '1 day')`;
    }
    
    query += ' ORDER BY timestamp DESC LIMIT 100';
    
    const res = await this.db.query(query, params);
    return res.rows;
  }
}

