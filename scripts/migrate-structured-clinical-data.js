const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

const sql = `
-- 1. Add structured 'clinical_data' JSONB column to agent_events
ALTER TABLE agent_events ADD COLUMN IF NOT EXISTS clinical_data JSONB;

-- 2. Update the immutability trigger to protect the new clinical_data column
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
    -- PROTECT NEW CLINICAL DATA:
    OR NEW.clinical_data          IS DISTINCT FROM OLD.clinical_data
    THEN
      RAISE EXCEPTION 'IMMUTABLE: Cannot modify content, provenance, or clinical payload of anchored event (id=%)', OLD.id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger trg_prevent_anchored_mutation is already attached, no need to recreate
-- but we update the function it calls above.
`;

async function migrate() {
  try {
    console.log("Applying migration: Structured Clinical Payload (JSONB)...");
    await pool.query(sql);
    console.log("✅ Migration complete:");
    console.log("   - Added 'clinical_data' JSONB column");
    console.log("   - Updated prevent_anchored_mutation() to protect clinical_data");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    pool.end();
  }
}

migrate();
