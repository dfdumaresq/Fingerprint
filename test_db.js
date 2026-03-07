const { Pool } = require('pg');
require('dotenv').config();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
async function check() {
  const { rows } = await pool.query('SELECT * FROM agents ORDER BY created_at DESC LIMIT 5');
  console.log('Latest Agents:', rows);
  process.exit(0);
}
check();
