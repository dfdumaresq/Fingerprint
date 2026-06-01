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
CREATE TABLE IF NOT EXISTS baseline_fixtures (
    id               SERIAL PRIMARY KEY,
    fingerprint_hash VARCHAR(66)   NOT NULL,
    agent_name       VARCHAR(255),
    suite_version    VARCHAR(50)   NOT NULL,
    responses        JSONB         NOT NULL,
    saved_at         TIMESTAMPTZ   DEFAULT NOW() NOT NULL,
    UNIQUE (fingerprint_hash, suite_version)
);

CREATE INDEX IF NOT EXISTS idx_fixtures_hash ON baseline_fixtures(fingerprint_hash);
`;

async function migrate() {
  try {
    console.log("Applying migration: Create 'baseline_fixtures' table...");
    await pool.query(sql);
    console.log("✅ Migration complete.");
  } catch (error) {
    console.error("❌ Migration failed:", error.message);
  } finally {
    pool.end();
  }
}

migrate();
