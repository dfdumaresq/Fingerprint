const args = process.argv.slice(2);
if (args[0] === 'test') {
  require('dotenv').config({ path: '.env.test' });
} else {
  require('dotenv').config();
}
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/fingerprint',
});

const sql = `
  ALTER TYPE workflow_type_enum ADD VALUE IF NOT EXISTS 'key_rotation';
  ALTER TYPE clinician_action_enum ADD VALUE IF NOT EXISTS 'rekey';
`;

async function migrate() {
  try {
    console.log("Applying migration: Add 'key_rotation' to workflow_type_enum and 'rekey' to clinician_action_enum...");
    await pool.query(sql);
    console.log("✅ Migration complete.");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
  } finally {
    pool.end();
  }
}

migrate();
