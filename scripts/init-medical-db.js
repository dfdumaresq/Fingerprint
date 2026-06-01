const args = process.argv.slice(2);
const isTest = args.includes('test');
const forceDrop = isTest || args.includes('--force') || args.includes('-f');

if (isTest) {
  require('dotenv').config({ path: '.env.test' });
} else {
  require('dotenv').config();
}
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

const dropSql = `
-- Drop existing types and tables if force dropping
DROP TABLE IF EXISTS agent_events CASCADE;
DROP TABLE IF EXISTS merkle_anchors CASCADE;
DROP TYPE IF EXISTS workflow_type_enum CASCADE;
DROP TYPE IF EXISTS clinician_action_enum CASCADE;
DROP TYPE IF EXISTS anchor_status_enum CASCADE;
`;

const schemaSql = `
-- Create Core Enum Types if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'workflow_type_enum') THEN
        CREATE TYPE workflow_type_enum AS ENUM (
            'triage_recommendation',
            'draft_clinical_note',
            'simulated_patient_interaction',
            'care_plan_decision',
            'system_alert',
            'clinician_action',
            'clinician_amendment',
            'behavior_rebaseline'
        );
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'clinician_action_enum') THEN
        CREATE TYPE clinician_action_enum AS ENUM (
            'accepted',
            'overridden',
            'ignored',
            'escalated',
            'autonomous',
            'downgraded',
            'rebaselined'
        );
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'anchor_status_enum') THEN
        CREATE TYPE anchor_status_enum AS ENUM ('pending', 'confirmed', 'failed');
    END IF;
END$$;

-- Anchoring Table
CREATE TABLE IF NOT EXISTS merkle_anchors (
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
CREATE TABLE IF NOT EXISTS agent_events (
    id SERIAL PRIMARY KEY,
    event_id UUID DEFAULT gen_random_uuid() UNIQUE NOT NULL,
    session_id VARCHAR(255),
    timestamp TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    
    agent_fingerprint_id VARCHAR(66) NOT NULL,
    model_version VARCHAR(50) NOT NULL,
    
    workflow_type workflow_type_enum NOT NULL,
    policy_id VARCHAR(512),
    clinician_action clinician_action_enum,
    
    input_ref VARCHAR(255) NOT NULL,
    output_ref VARCHAR(255) NOT NULL,
    
    previous_event_hash VARCHAR(66),
    event_hash VARCHAR(66) NOT NULL,
    
    amends_event_id UUID,
    reason_code VARCHAR(255),
    reason_text TEXT,
    clinical_data JSONB,
    
    anchored_to_chain BOOLEAN DEFAULT false,
    merkle_root_id INTEGER REFERENCES merkle_anchors(id)
);

-- Indices for rapid querying
CREATE INDEX IF NOT EXISTS idx_events_fingerprint ON agent_events(agent_fingerprint_id);
CREATE INDEX IF NOT EXISTS idx_events_workflow ON agent_events(workflow_type);
CREATE INDEX IF NOT EXISTS idx_events_anchoring ON agent_events(anchored_to_chain, merkle_root_id);

-- Create the immutability trigger function
CREATE OR REPLACE FUNCTION prevent_anchored_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.anchored_to_chain = true THEN
    -- Allow ONLY the anchoring metadata columns to change (merkle_root_id, anchored_to_chain, etc.)
    -- All content and clinical provenance fields are protected:
    IF NEW.event_hash             IS DISTINCT FROM OLD.event_hash
    OR NEW.session_id             IS DISTINCT FROM OLD.session_id
    OR NEW.clinician_action       IS DISTINCT FROM OLD.clinician_action
    OR NEW.input_ref              IS DISTINCT FROM OLD.input_ref
    OR NEW.output_ref             IS DISTINCT FROM OLD.output_ref
    OR NEW.policy_id              IS DISTINCT FROM OLD.policy_id
    OR NEW.model_version          IS DISTINCT FROM OLD.model_version
    OR NEW.workflow_type          IS DISTINCT FROM OLD.workflow_type
    OR NEW.previous_event_hash    IS DISTINCT FROM OLD.previous_event_hash
    OR NEW.agent_fingerprint_id   IS DISTINCT FROM OLD.agent_fingerprint_id
    OR NEW.timestamp              IS DISTINCT FROM OLD.timestamp
    OR NEW.amends_event_id        IS DISTINCT FROM OLD.amends_event_id
    OR NEW.reason_code            IS DISTINCT FROM OLD.reason_code
    OR NEW.reason_text            IS DISTINCT FROM OLD.reason_text
    OR NEW.clinical_data          IS DISTINCT FROM OLD.clinical_data
    THEN
      RAISE EXCEPTION 'IMMUTABLE: Cannot modify content, provenance, or clinical payload of anchored event (id=%)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_anchored_mutation ON agent_events;
CREATE TRIGGER trg_prevent_anchored_mutation
BEFORE UPDATE ON agent_events
FOR EACH ROW EXECUTE FUNCTION prevent_anchored_mutation();
`;

async function initDb() {
  try {
    if (forceDrop) {
      console.log("Force dropping existing tables and enums...");
      await pool.query(dropSql);
    }
    console.log("Initializing non-destructive database schema...");
    await pool.query(schemaSql);
    console.log("Database initialized successfully!");
    
    // Automatically seed scenarios
    const { execSync } = require('child_process');
    console.log("Seeding clinical scenarios...");
    const cmd = isTest ? 'npx ts-node scripts/seed-scenarios.ts test' : 'npx ts-node scripts/seed-scenarios.ts';
    execSync(cmd, { stdio: 'inherit' });
  } catch (error) {
    console.error("Error creating tables or seeding:", error);
  } finally {
    pool.end();
  }
}

initDb();

