import { Pool } from "pg";
import Redis from "ioredis";
import * as dotenv from "dotenv";

dotenv.config();

// 1. Check for Fingerprint Hash argument
const fingerprintHash = process.argv[2];

if (!fingerprintHash) {
  console.error("❌ Error: Missing fingerprint hash argument.");
  console.error("Usage: npm run prune:agent <fingerprintHash>");
  process.exit(1);
}

// 2. Initialize Connections
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const redis = new Redis(process.env.REDIS_URL || "redis://127.0.0.1:6379");

async function pruneAgent() {
  console.log(`\n🧹 Starting Prune Operation for Agent: ${fingerprintHash}`);

  // Confirm execution logic (useful if user runs by accident)
  // Optional: Add a readline prompt here if you prefer interactive confirmation
  const readline = require("readline");

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  rl.question('Do you want to proceed? (y/n) ', async (answer: string) => {
    if (answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
        console.log('Proceeding with Pruning Operation');
        await doPrune();
    } else {
        console.log('Operation cancelled')
    }

    // Critical: Close the readline interface so the Node script can exit!
    rl.close();
    process.exit(0);    
  });

}

async function doPrune() {
    const client = await db.connect();
    try {
        await client.query("BEGIN");

        // 3. Delete from PostgreSQL
        console.log("-> Searching PostgreSQL...");
        const result = await client.query(
            "DELETE FROM agents WHERE fingerprint_hash = $1",
            [fingerprintHash]
        );

        if (result.rowCount === 0) {
            console.log("   [i] No agent found in Postgres with that hash.");
        } else {
            console.log(`   [✓] Deleted agent from Postgres.`);
        }

        // 4. Delete from Redis Cache
        console.log("-> Searching Redis Cache...");
        const redisKey = `agent:${fingerprintHash}`;
        const redisResult = await redis.del(redisKey);

        if (redisResult === 0) {
            console.log("   [i] No agent found in Redis cache with that hash.");
        } else {
            console.log(`   [✓] Deleted agent from Redis cache.`);
        }

        await client.query("COMMIT");
        console.log("\n✅ Prune operation completed successfully.");
    } catch (err) {
        await client.query("ROLLBACK");
        console.error(
            "\n❌ Prune operation failed. Rolled back Postgres changes.",
            err
        );
    } finally {
        client.release();
        redis.quit();
        db.end();
    }
}

pruneAgent();
