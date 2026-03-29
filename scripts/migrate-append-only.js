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
-- 1. Add 'clinician_amendment' to the workflow_type enum
ALTER TYPE workflow_type_enum ADD VALUE IF NOT EXISTS 'clinician_amendment';

-- 2. Create the immutability trigger function
CREATE OR REPLACE FUNCTION prevent_anchored_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.anchored_to_chain = true THEN
    -- Allow ONLY the anchoring metadata columns to change
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
    THEN
      RAISE EXCEPTION 'IMMUTABLE: Cannot modify content of anchored event (id=%)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 3. Drop the trigger if it already exists (idempotent re-run)
DROP TRIGGER IF EXISTS trg_prevent_anchored_mutation ON agent_events;

-- 4. Create the trigger
CREATE TRIGGER trg_prevent_anchored_mutation
BEFORE UPDATE ON agent_events
FOR EACH ROW EXECUTE FUNCTION prevent_anchored_mutation();
`;

async function migrate() {
  try {
    console.log("Applying migration: append-only immutability trigger...");
    await pool.query(sql);
    console.log("✅ Migration complete:");
    console.log("   - Added 'clinician_amendment' to workflow_type_enum");
    console.log("   - Created prevent_anchored_mutation() trigger");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
  } finally {
    pool.end();
  }
}

migrate();
