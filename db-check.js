const { Pool } = require('pg');
const dotenv = require('dotenv');
dotenv.config();

const DOCKER_DB =
  "postgresql://fingerprint:Rum^6buM%ZYaiC7L@localhost:5433/fingerprint";

const connectionString = process.env.DB_TARGET || DOCKER_DB;
const db = new Pool({ connectionString });

async function main() {
  const maskedDb = connectionString ? connectionString.replace(/:([^:@]+)@/, ':****@') : 'undefined';
  console.log('Connected to DB:', maskedDb);
  const { rows } = await db.query('SELECT fingerprint_hash, name, latest_trait_hash FROM agents');
  console.log('Postgres agents:', rows);
  
  const Redis = require('ioredis');
  const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');
  
  const keys = await redis.keys('agent:*');
  console.log('Redis agent keys count:', keys.length);
  for (const k of keys) {
    const val = await redis.get(k);
    let parsed;
    try { parsed = JSON.parse(val); } catch(e) {}
    console.log(`Redis [${k}]: hasBehavioralTrait =`, !!parsed?.behavioralTrait?.hasTrait || !!parsed?.responses);
  }
  
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
