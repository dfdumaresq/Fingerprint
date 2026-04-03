import { ethers } from 'ethers';
import stringify from 'fast-json-stable-stringify';

/**
 * Deterministically constructs a standard canonical payload representing minimum required clinical fields.
 * 
 * NOTE ON NULL SEMANTICS:
 * - Top-level scalar fields (policy_id, clinician_action, etc.): Both `undefined` and `null` are OMITTED.
 *   This is due to PostgreSQL flattening both states to a single SQL NULL, making the distinction 
 *   unrecoverable during verification.
 * - JSONB fields (clinical_data): Fidelity is preserved. Missing keys are omitted; explicit nulls are included.
 */
export function buildCanonicalPayload(event: any): any {
  const canonical: any = {};
  
  // 1. Top-level Scalar Fields (Postgres columns)
  // Both undefined and null are treated as OMITTED to ensure DB-to-Hash stability.
  const scalarFields = [
    'agent_fingerprint_id', 'model_version', 'workflow_type',
    'input_ref', 'output_ref', 'policy_id', 'session_id',
    'clinician_action', 'amends_event_id', 'reason_code',
    'reason_text'
  ];

  for (const field of scalarFields) {
    // Check both snake_case (DB/API) and common legacy aliases
    const camelField = field.replace(/_([a-z])/g, g => g[1].toUpperCase());
    const legacyField = field === 'agent_fingerprint_id' ? 'agentId' : 
                       field === 'model_version' ? 'modelVersion' : undefined;
    
    const value = event[field] !== undefined ? event[field] : 
                 (event[camelField] !== undefined ? event[camelField] : (legacyField ? event[legacyField] : undefined));
    
    if (value !== undefined && value !== null) {
      canonical[field] = value;
    }
  }

  // 2. Structured Clinical Data (JSONB)
  // For the TOP-LEVEL column, we treat null as omitted to match PostgreSQL behavior.
  // Fidelity is still preserved INSIDE the object if one is provided.
  const clinicalData = event.clinical_data !== undefined ? event.clinical_data : event.clinicalData;
  if (clinicalData !== undefined && clinicalData !== null) {
    canonical.clinical_data = clinicalData;
  }
  
  return canonical;
}

/**
 * Deterministically hash an event payload following our canonicalization spec
 * Uses fast-json-stable-stringify to ensure alphabetical key ordering
 */
export function generateEventHash(payload: any, previousHash: string | null, timestamp: string | Date): string {
  const tsStr = (typeof timestamp === 'string') 
    ? new Date(timestamp).toISOString() 
    : timestamp.toISOString();

  const canonical = {
    ...payload,
    timestamp: tsStr,
    previous_event_hash: previousHash
  };
  
  const serialized = stringify(canonical);

  return ethers.keccak256(ethers.toUtf8Bytes(serialized));
}
