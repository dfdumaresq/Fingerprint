const args = process.argv.slice(2);
if (args[0] === 'test') {
  require('dotenv').config({ path: '.env.test' });
} else {
  require('dotenv').config();
}
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

const sql = `
-- 1. Create the amendment reason enum
DO $$ BEGIN
    CREATE TYPE amendment_reason_enum AS ENUM (
        'initial_decision',
        'new_lab_data',
        'senior_review',
        'deterioration',
        'imaging_result',
        'clerical_error',
        'other'
    );
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- 2. Add provenance columns to agent_events
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS amends_event_id UUID REFERENCES agent_events(event_id);
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS reason_code amendment_reason_enum DEFAULT 'initial_decision';
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS reason_text TEXT;

-- 3. Update the immutability trigger to protect the new provenance fields
CREATE OR REPLACE FUNCTION prevent_anchored_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.anchored_to_chain = true THEN
    -- Allow ONLY the anchoring metadata columns to change (merkle_root_id, anchored_to_chain, etc.)
    -- Protections:
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
    -- NEW PROVENANCE FIELDS:
    OR NEW.amends_event_id        IS DISTINCT FROM OLD.amends_event_id
    OR NEW.reason_code            IS DISTINCT FROM OLD.reason_code
    OR NEW.reason_text            IS DISTINCT FROM OLD.reason_text
    THEN
      RAISE EXCEPTION 'IMMUTABLE: Cannot modify content or provenance of anchored event (id=%)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger trg_prevent_anchored_mutation is already attached, no need to recreate unless we want to be safe
DROP TRIGGER IF EXISTS trg_prevent_anchored_mutation ON agent_events;
CREATE TRIGGER trg_prevent_anchored_mutation
BEFORE UPDATE ON agent_events
FOR EACH ROW EXECUTE FUNCTION prevent_anchored_mutation();
`;

async function migrate() {
  try {
    console.log("Applying migration: Regulatory-Grade Decision Provenance...");
    await pool.query(sql);
    console.log("✅ Migration complete:");
    console.log("   - Created amendment_reason_enum");
    console.log("   - Added amends_event_id, reason_code, reason_text");
    console.log("   - Updated prevent_anchored_mutation() trigger");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    pool.end();
  }
}

migrate();
