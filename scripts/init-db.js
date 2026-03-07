require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

async function initDb() {
  console.log('Connecting to PostgreSQL to scaffold tables...');
  let client;

  try {
    client = await pool.connect();
    
    console.log('Creating "agents" table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS agents (
          fingerprint_hash VARCHAR(66) PRIMARY KEY,
          agent_id VARCHAR(255) NOT NULL,
          name VARCHAR(255) NOT NULL,
          provider VARCHAR(255) NOT NULL,
          version VARCHAR(50) NOT NULL,
          registered_by VARCHAR(42) NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE NOT NULL,
          
          -- Revocation State
          is_revoked BOOLEAN DEFAULT FALSE,
          revoked_at TIMESTAMP WITH TIME ZONE,
          revoked_by VARCHAR(42),
          
          -- Behavioral Trait State
          latest_trait_hash VARCHAR(66),
          trait_version VARCHAR(100),
          trait_updated_at TIMESTAMP WITH TIME ZONE,
          
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    console.log('Creating "agents" indexes...');
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agents_provider ON agents(provider);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agents_registered_by ON agents(registered_by);`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_agents_is_revoked ON agents(is_revoked);`);

    console.log('Creating "indexer_state" table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS indexer_state (
          chain_id INTEGER PRIMARY KEY,
          last_processed_block BIGINT NOT NULL,
          last_processed_tx_hash VARCHAR(66),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);

    console.log('✅ Database Initialization Complete!');

  } catch (err) {
    console.error('❌ Database Initialization Failed:', err.message);
  } finally {
    if (client) {
        client.release();
    }
    await pool.end();
  }
}

initDb();
