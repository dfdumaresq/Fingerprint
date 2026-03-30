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
-- Add 'clinician_action' to the workflow_type enum
ALTER TYPE workflow_type_enum ADD VALUE IF NOT EXISTS 'clinician_action';
`;

async function migrate() {
  try {
    console.log("Applying migration: Add 'clinician_action' to workflow_type_enum...");
    await pool.query(sql);
    console.log("✅ Migration complete.");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
    process.exit(1);
  } finally {
    pool.end();
  }
}

migrate();
