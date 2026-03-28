# Phase 1: Medical Event Logging Spec & Data Model

To achieve a true "audit-ready" layer for medical AI interventions, we must build an immutable, append-only event trail. Rather than storing sensitive Protected Health Information (PHI) directly on-chain or even in our logging server, our system stores cryptographic pointers and contexts off-chain, using Merkle Root checkpoints pushed to the blockchain to guarantee tamper-evidence.

## 1. Immutable Event Schema (PostgreSQL)

This schema represents the core append-only ledger for AI interactions in clinical workflows. Every row points to the previous event hash, forming a local hash-chain before bulk Merkle anchoring.

```sql
CREATE TYPE workflow_type_enum AS ENUM (
    'triage_recommendation',
    'draft_clinical_note',
    'simulated_patient_interaction',
    'care_plan_decision',
    'system_alert'
);

CREATE TYPE clinician_action_enum AS ENUM (
    'accepted',
    'overridden',
    'ignored',
    'escalated',
    'autonomous' -- No clinician in the loop
);

CREATE TABLE agent_events (
    id SERIAL PRIMARY KEY,
    event_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    session_id VARCHAR(100),           -- Correlate multiple events in one clinical episode
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    -- Identity Links
    agent_fingerprint_id VARCHAR(66) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    
    -- Clinical Context
    workflow_type workflow_type_enum NOT NULL,
    policy_id VARCHAR(100),
    clinician_action clinician_action_enum,
    
    -- Data Pointers (Zero PHI: content hashes or de-identified URIs)
    input_ref VARCHAR(255) NOT NULL,
    output_ref VARCHAR(255) NOT NULL,
    
    -- Cryptographic Hash Chain
    previous_event_hash VARCHAR(66),
    event_hash VARCHAR(66) NOT NULL,
    
    -- Anchoring State
    anchored_to_chain BOOLEAN DEFAULT false,
    merkle_root_id INTEGER REFERENCES merkle_anchors(id)
);

CREATE INDEX idx_events_fingerprint ON agent_events(agent_fingerprint_id);
CREATE INDEX idx_events_workflow ON agent_events(workflow_type);
CREATE INDEX idx_events_anchoring ON agent_events(anchored_to_chain, merkle_root_id);

-- Enforce Immutability at the DB Level (Example)
-- REVOKE UPDATE, DELETE ON agent_events FROM application_user;
```

### Merkle Anchoring Table

```sql
CREATE TYPE anchor_status_enum AS ENUM ('pending', 'confirmed', 'failed');

CREATE TABLE merkle_anchors (
    id SERIAL PRIMARY KEY,
    merkle_root VARCHAR(66) UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    event_count INTEGER NOT NULL,
    chain_name VARCHAR(50) DEFAULT 'sepolia',
    contract_address VARCHAR(66),
    tx_hash VARCHAR(66),
    status anchor_status_enum DEFAULT 'pending'
);
```

## 2. Event Logging API Endpoints

### `POST /v1/events`
Ingest a new clinical AI action. The server strictly computes the `timestamp` (UTC), `previous_event_hash`, and `event_hash` to prevent forged history from the client.

**Example Payload:**
```json
{
  "agent_fingerprint_id": "0x123abc...",
  "model_version": "llama-3-medical-v1",
  "workflow_type": "draft_clinical_note",
  "policy_id": "ubc_discharge_protocol_v3",
  "session_id": "enc_88392",
  "clinician_action": "autonomous",
  "input_ref": "sha256:8b1a9953c...",
  "output_ref": "sha256:72c111000..."
}
```

### `GET /v1/events`
Query the audit log.

**Query Parameters:**
- `fingerprint_hash`: Filter by specific AI agent
- `workflow_type`: Filter by task
- `action_filter`: Filter by `accepted`, `overridden`, `ignored`, etc.
- `from_timestamp` / `to_timestamp`: Time-bounded audits.
- `anchored`: Boolean to distinguish anchored vs. floating events.
- `limit`, `cursor`: Pagination.

### `GET /v1/events/:event_id/proof` (Future)
Returns canonical event JSON, `event_hash`, Merkle proof path, Merkle root, and reference to on-chain tx.

## 3. The Off-chain Integrity Model

1. **Ingestion Hash-Chaining**: Uses a strict canonicalization procedure (alphabetical JSON key ordering, normalized nulls) for hashing.
2. **Periodic Merkle Anchoring**: Cron grabs unanchored events. If an anchor `status='failed'`, the events are re-pooled for the next batch.
3. **Verification**: A standalone CLI verifier will be provided to independently recalculate hash chains and Merkle sibling paths.
