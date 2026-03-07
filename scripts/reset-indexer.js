const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
  await pool.query('DELETE FROM indexer_state WHERE chain_id = 11155111');
  console.log('Cleared Indexer DB Watermark');
  process.exit(0);
}
check();
