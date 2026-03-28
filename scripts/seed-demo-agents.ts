/**
 * scripts/seed-demo-agents.ts
 * Idempotently registers demo AI agents and behavioral traits into the local PostgreSQL database 
 * for UI and simulation testing. Skips agents that already exist.
 */
import { Pool } from 'pg';
import { hashMessage } from 'ethers';
import * as dotenv from 'dotenv';

dotenv.config();

const db = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint',
});

// Hardcoded deterministic hashes so the frontend matches the blockchain UI
const SEED_AGENTS = [
  {
    fingerprintHash: hashMessage("TriageBot-v2.1"),
    name: "TriageBot",
    provider: "OpenAI",
    version: "v2.1",
    registeredBy: "0xSeederAccount1234567890",
    traitHash: "0xtrait0000000000000000000000000000000000001",
    traitVersion: "beta-1.0"
  },
  {
    fingerprintHash: hashMessage("NoteGen-Pro"),
    name: "NoteGen-Pro",
    provider: "Anthropic",
    version: "pro-latest",
    registeredBy: "0xSeederAccount1234567890",
    
    // Intentionally null: Demonstrates an agent registered without a behavioral profile 
    // to test UI conditioned rendering (the badge)
    traitHash: null,
    traitVersion: null
  }
];

async function seedAgents() {
  console.log('🌱 Starting Idempotent Agent Seeding...');
  const client = await db.connect();

  try {
    for (const agent of SEED_AGENTS) {
      // Check if already registered
      const checkRes = await client.query('SELECT fingerprint_hash FROM agents WHERE fingerprint_hash = $1', [agent.fingerprintHash]);
      
      if (checkRes.rows.length > 0) {
        console.log(`⏩ [SKIPPED] Agent ${agent.name} (${agent.fingerprintHash.substring(0, 10)}...) already exists.`);
        continue;
      }

      console.log(`✨ [CREATED] Registering Agent ${agent.name}...`);
      
      const insertQuery = `
        INSERT INTO agents (
          fingerprint_hash, agent_id, name, provider, version, 
          registered_by, is_revoked, latest_trait_hash, trait_version, trait_updated_at, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, false, $7, $8, NOW(), NOW())
      `;
      
      await client.query(insertQuery, [
        agent.fingerprintHash,
        agent.fingerprintHash, // mock agent_id
        agent.name,
        agent.provider,
        agent.version,
        agent.registeredBy,
        agent.traitHash,
        agent.traitVersion
      ]);
      
      if (agent.traitHash) {
        console.log(`   └─ 🛡️ Seeded Behavioral Profile: ${agent.traitHash.substring(0, 10)}...`);
      }
    }
    
    console.log('✅ Seeding complete. Ready for simulator.');
  } catch (err) {
    console.error('❌ Error during database seeding:', err);
    process.exit(1);
  } finally {
    client.release();
    db.end();
  }
}

seedAgents();
