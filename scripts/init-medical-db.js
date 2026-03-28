const args = process.argv.slice(2);
if (args[0] === 'test') {
  require('dotenv').config({ path: '.env.test' });
} else {
  require('dotenv').config();
}
const { Pool } = require('pg');
const fs = require('fs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

const sql = `
-- Drop existing types if re-running (for dev)
DROP TABLE IF EXISTS agent_events CASCADE;
DROP TABLE IF EXISTS merkle_anchors CASCADE;
DROP TYPE IF EXISTS workflow_type_enum CASCADE;
DROP TYPE IF EXISTS clinician_action_enum CASCADE;
DROP TYPE IF EXISTS anchor_status_enum CASCADE;

-- Core Enum Types
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
    'autonomous'
);

CREATE TYPE anchor_status_enum AS ENUM ('pending', 'confirmed', 'failed');

-- Anchoring Table
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

-- Core Ledger Table
CREATE TABLE agent_events (
    id SERIAL PRIMARY KEY,
    event_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    session_id VARCHAR(100),
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    agent_fingerprint_id VARCHAR(66) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    
    workflow_type workflow_type_enum NOT NULL,
    policy_id VARCHAR(100),
    clinician_action clinician_action_enum,
    
    input_ref VARCHAR(255) NOT NULL,
    output_ref VARCHAR(255) NOT NULL,
    
    previous_event_hash VARCHAR(66),
    event_hash VARCHAR(66) NOT NULL,
    
    anchored_to_chain BOOLEAN DEFAULT false,
    merkle_root_id INTEGER REFERENCES merkle_anchors(id)
);

-- Indices for rapid querying
CREATE INDEX idx_events_fingerprint ON agent_events(agent_fingerprint_id);
CREATE INDEX idx_events_workflow ON agent_events(workflow_type);
CREATE INDEX idx_events_anchoring ON agent_events(anchored_to_chain, merkle_root_id);

-- Optional: Create app_user and enforce immutability
-- DO NOT RUN THESE in script natively unless we know app_user exists
-- REASSIGN OWNED BY postgres TO postgres;
-- REVOKE UPDATE, DELETE ON agent_events FROM public;
`;

async function initDb() {
  try {
    console.log("Creating medical MVP tables...");
    await pool.query(sql);
    console.log("Tables created successfully!");
  } catch (error) {
    console.error("Error creating tables:", error);
  } finally {
    pool.end();
  }
}

initDb();
