require('dotenv').config();
const { Pool } = require('pg');

// Initialize the Postgres connection pool
// This will automatically look for the PGUSER, PGPASSWORD, PGHOST, PGDATABASE, PGPORT
// or the DATABASE_URL environment variable.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Required only if connecting to modern cloud providers like Neon/Supabase:
  // ssl: {
  //   rejectUnauthorized: false
  // }
});

async function main() {
  console.log('Connecting to PostgreSQL database...');
  let client;

  try {
    // Connect to the DB
    client = await pool.connect();
    
    // Execute a simple query
    const res = await client.query('SELECT NOW() as current_time, version() as pg_version');
    
    console.log('✅ Connection Successful!');
    console.log('-------------------------');
    console.log(`Time: ${res.rows[0].current_time}`);
    console.log(`Version: ${res.rows[0].pg_version}`);
    console.log('-------------------------');

    // Optional: Scaffold the MVP table if you want to test writes instantly
    console.log('Attempting to create "hello_world" test table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS hello_world (
        id SERIAL PRIMARY KEY,
        message VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      );
    `);
    
    await client.query("INSERT INTO hello_world (message) VALUES ('Agent Indexer Ready')");
    
    const countRes = await client.query('SELECT COUNT(*) FROM hello_world');
    console.log(`Test table rows: ${countRes.rows[0].count}`);

  } catch (err) {
    console.error('❌ Connection Failed:', err.message);
  } finally {
    if (client) {
        client.release();
    }
    await pool.end();
    console.log('Connection closed.');
  }
}

main();
