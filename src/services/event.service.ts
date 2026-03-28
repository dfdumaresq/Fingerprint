import { Pool } from 'pg';
import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import stringify from 'fast-json-stable-stringify';
import { generateEventHash } from '../utils/crypto.utils';

export interface ClinicalEventPayload {
  agent_fingerprint_id: string;
  model_version: string;
  workflow_type: string;
  policy_id?: string;
  session_id?: string;
  clinician_action?: string;
  input_ref: string;
  output_ref: string;
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
    // Start transaction strictly to ensure isolated previous_hash lookup
    const client = await this.db.connect();
    
    try {
      await client.query('BEGIN');

      // 1. Find the latest event for this agent to chain off of
      // FOR UPDATE locks this row so concurrent requests for same agent don't fork the chain
      const lastEventRes = await client.query(
        'SELECT event_hash FROM agent_events WHERE agent_fingerprint_id = $1 ORDER BY id DESC LIMIT 1 FOR UPDATE',
        [payload.agent_fingerprint_id]
      );
      
      const previousHash = lastEventRes.rows.length > 0 ? lastEventRes.rows[0].event_hash : null;

      // 2. Server asserts the timestamp
      const timestamp = new Date();
      
      // 3. Compute immutable Event Hash (server-authoritative)
      const eventHash = generateEventHash(payload, previousHash, timestamp.toISOString());

      // 4. Insert into append-only log
      const insertQuery = `
        INSERT INTO agent_events (
          event_id, session_id, timestamp, 
          agent_fingerprint_id, model_version, 
          workflow_type, policy_id, clinician_action, 
          input_ref, output_ref, 
          previous_event_hash, event_hash
        ) VALUES (
          $1, $2, $3, 
          $4, $5, 
          $6, $7, $8, 
          $9, $10, 
          $11, $12
        ) RETURNING event_id, event_hash, timestamp, previous_event_hash
      `;
      
      const eventId = randomUUID();
      
      const result = await client.query(insertQuery, [
        eventId, payload.session_id, timestamp,
        payload.agent_fingerprint_id, payload.model_version,
        payload.workflow_type, payload.policy_id, payload.clinician_action,
        payload.input_ref, payload.output_ref,
        previousHash, eventHash
      ]);

      await client.query('COMMIT');
      
      return result.rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
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
      query += ` AND timestamp >= NOW() - INTERVAL '${filters.days_back} days'`;
    }
    
    query += ' ORDER BY timestamp DESC LIMIT 100';
    
    const res = await this.db.query(query, params);
    return res.rows;
  }
}

