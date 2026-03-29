import { Pool } from 'pg';
import { ethers } from 'ethers';
import { generateEventHash } from '../utils/crypto.utils';

export interface TriageEncounter {
  encounter_id: string;
  db_row_id: number;
  arrival_time: string;
  clinician_action: string | null;
  agent_id: string;
  
  // Hydrated PHI Mock Data
  clinical: {
    acuity: number;
    chief_complaint: string;
    vitals: {
      heart_rate: number;
      blood_pressure: string;
    };
    state: string;
  };
  
  // Strict Cryptographic Layer
  integrity: {
    event_hash: string;
    merkle_root_id: number | null;
    anchored_to_chain: boolean;
    tamper_status: 'pending' | 'anchored' | 'tampered';
  };
}

/**
 * MOCK TRIAGE HYDRATOR
 * Deterministically generates simulated PHI strictly for UI demonstration purposes.
 * This ensures the underlying cryptographically-secured ledger never actually stores cleartext PHI.
 */
function getMockClinicalData(sessionId: string) {
  // Deterministic seed by hashing the session id
  const hash = ethers.id(sessionId || 'unknown'); 
  const seedNum = parseInt(hash.substring(2, 10), 16);
  
  const ACUITY = [1, 2, 3, 4, 5];
  const COMPLAINTS = ['Chest Pain', 'Laceration', 'Shortness of Breath', 'Abdominal Pain', 'Fever', 'Headache', 'Dizziness', 'Sprain'];
  const DISPOSITIONS = ['waiting', 'in_room', 'completed', 'waiting']; // Weight 'waiting' higher
  
  const acuity = ACUITY[seedNum % ACUITY.length];
  const complaint = COMPLAINTS[seedNum % COMPLAINTS.length];
  
  const hr = 60 + (acuity * 8) + (seedNum % 25);
  const bp = `${95 + (acuity * 5) + (seedNum % 30)}/${60 + (seedNum % 20)}`;
  const state = DISPOSITIONS[(seedNum >> 2) % DISPOSITIONS.length];

  return { acuity, chief_complaint: complaint, vitals: { heart_rate: hr, blood_pressure: bp }, state };
}

export class TriageService {
  private db: Pool;

  constructor(dbPool: Pool) {
    this.db = dbPool;
  }

  /**
   * Fetch the hydrated triage read-model for clinicians.
   */
  async getTriageEncounters(filters: { state?: string, acuity?: number } = {}): Promise<TriageEncounter[]> {
    const res = await this.db.query(
      `SELECT * FROM agent_events WHERE workflow_type = 'triage_recommendation' ORDER BY timestamp DESC`
    );
    
    // Naive fetch for the previous hashes so we can independently verify row integrity on read
    // For a prod system with millions of rows this would be constrained, but for MVP it's perfect.
    // We only need the expectedPrev from the DB if we want full broken_chain validation, 
    // but here we just validate content manipulation to compute 'tampered'.
    
    const encounters: TriageEncounter[] = res.rows.map(event => {
      const sessionId = event.session_id || `enc_${event.id}`;
      const mockPhi = getMockClinicalData(sessionId);
      
      // Inline Tamper Check: Re-hash the payload content exactly as the auditor would!
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
      
      const trueHash = generateEventHash(reconstructedPayload, event.previous_event_hash, new Date(event.timestamp).toISOString());
      
      let tamperStatus: 'pending' | 'anchored' | 'tampered' = event.anchored_to_chain ? 'anchored' : 'pending';
      if (trueHash !== event.event_hash) {
        tamperStatus = 'tampered'; // Real-time detection of DB manipulation!
      }

      return {
        encounter_id: sessionId,
        db_row_id: event.id,
        arrival_time: new Date(event.timestamp).toISOString(),
        clinician_action: event.clinician_action,
        agent_id: event.agent_fingerprint_id,
        clinical: mockPhi,
        integrity: {
          event_hash: event.event_hash,
          merkle_root_id: event.merkle_root_id,
          anchored_to_chain: event.anchored_to_chain,
          tamper_status: tamperStatus,
        }
      };
    });

    // Apply filters post-hydration so we can filter by the mock deterministic data
    let filtered = encounters;
    if (filters.state) {
      filtered = filtered.filter(e => e.clinical.state === filters.state);
    }
    if (filters.acuity) {
      filtered = filtered.filter(e => e.clinical.acuity === Number(filters.acuity));
    }

    return filtered;
  }
}
