import { ethers } from 'ethers';
import { Pool } from 'pg';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import AIFingerprintABI from '../artifacts/contracts/AIFingerprint.sol/AIFingerprint.json';

dotenv.config();

// 1. Initialize Connections
const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_URL);
const contractAddress = process.env.REACT_APP_SEPOLIA_CONTRACT_ADDRESS || '';
const chainId = parseInt(process.env.REACT_APP_SEPOLIA_CHAIN_ID || '11155111', 10);

const contract = new ethers.Contract(contractAddress, AIFingerprintABI.abi, provider);

const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Connect to local or remote Redis
const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const BATCH_SIZE = 1000; // Increased batch size for faster catch-up
const STARTING_BLOCK = 10398000; // Closer to the actual contract deployment block on Sepolia

/**
 * Main Indexer Sync Loop
 */
async function syncEvents() {
  console.log(`Starting AI Fingerprint Indexer on Chain ID: ${chainId}...`);
  console.log(`Listening to Contract: ${contractAddress}`);

  while (true) {
    try {
      const currentBlock = await provider.getBlockNumber();
      
      const { rows } = await db.query('SELECT last_processed_block FROM indexer_state WHERE chain_id = $1', [chainId]);
      let fromBlock = rows[0]?.last_processed_block 
        ? parseInt(rows[0].last_processed_block) + 1 
        : STARTING_BLOCK;
      
      let toBlock = Math.min(fromBlock + BATCH_SIZE, currentBlock);
      
      if (fromBlock > toBlock) {
        // Fully Synced! Wait 12s for the next block.
        await new Promise(resolve => setTimeout(resolve, 12000));
        continue;
      }

      console.log(`Syncing blocks ${fromBlock} to ${toBlock}...`);
      
      // Fetch events matching any of the AIFingerprint events we care about
      const filter = {
        address: contractAddress,
        fromBlock,
        toBlock
      };
      
      const logs = await provider.getLogs(filter);
      
      for (const log of logs) {
        let parsedLog;
        try {
          parsedLog = contract.interface.parseLog({ topics: [...log.topics], data: log.data });
        } catch (e) {
          // Ignore logs that don't match our ABI (e.g. Proxy upgrade events)
          continue;
        }
        if (!parsedLog) continue;

        await processEvent(parsedLog, log.blockNumber, log.transactionHash);
      }
      
      // Update Watermark
      await db.query(`
        INSERT INTO indexer_state (chain_id, last_processed_block, last_processed_tx_hash) 
        VALUES ($1, $2, $3)
        ON CONFLICT (chain_id) DO UPDATE SET 
          last_processed_block = excluded.last_processed_block,
          last_processed_tx_hash = excluded.last_processed_tx_hash,
          updated_at = NOW()
      `, [chainId, toBlock, logs.length > 0 ? logs[logs.length-1].transactionHash : null]);
      
      await redis.hset('system:health', 'lastProcessedBlock', toBlock);
      await redis.hset('system:health', 'chainHead', currentBlock);

      // Sleep a bit to avoid RPC rate limits (e.g. 1 request per second for free tiers)
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (error) {
      console.error('Indexer Loop Failed. Retrying in 5s...', error);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

/**
 * Event Processors
 */
async function processEvent(parsedLog: ethers.LogDescription, blockNumber: number, txHash: string) {
  const { name, args } = parsedLog;
  console.log(`Processing Event: ${name} [Tx: ${txHash}]`);

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    switch (name) {
      case 'FingerprintRegistered':
        // string fingerprintHash, string id, string name, string provider, string version, address registeredBy, uint256 createdAt
        await client.query(`
          INSERT INTO agents (fingerprint_hash, agent_id, name, provider, version, registered_by, created_at)
          VALUES ($1, $2, $3, $4, $5, $6, to_timestamp($7))
          ON CONFLICT (fingerprint_hash) DO UPDATE SET
            agent_id = EXCLUDED.agent_id,
            name = EXCLUDED.name,
            provider = EXCLUDED.provider,
            version = EXCLUDED.version,
            registered_by = EXCLUDED.registered_by,
            updated_at = NOW()
        `, [args.fingerprintHash || args[0], args.id || args[1], args.name || args[2], args.provider || args[3], args.version || args[4], (args.registeredBy || args[5]).toLowerCase(), Number(args.createdAt || args[6])]);
        
        await updateCache(args.fingerprintHash || args[0], client);
        break;

      case 'BehavioralTraitRegistered':
      case 'BehavioralTraitUpdated':
        // args for Registered: fingerprintHash, traitHash, traitVersion, registeredBy, registeredAt 
        // args for Updated: fingerprintHash, oldTraitHash, newTraitHash, traitVersion, updatedBy, updatedAt 
        const isUpdate = name === 'BehavioralTraitUpdated';
        const fpHash = args[0];
        const latestHash = isUpdate ? args[2] : args[1];
        const traitVersion = isUpdate ? args[3] : args[2];
        const traitUpdatedAt = isUpdate ? args[5] : args[4];

        await client.query(`
          UPDATE agents 
          SET latest_trait_hash = $1, trait_version = $2, trait_updated_at = to_timestamp($3), updated_at = NOW()
          WHERE fingerprint_hash = $4
        `, [latestHash, traitVersion, Number(traitUpdatedAt), fpHash]);
        
        await updateCache(fpHash, client);
        break;

      case 'FingerprintRevoked':
        // string fingerprintHash, address revokedBy, uint256 revokedAt
        await client.query(`
          UPDATE agents 
          SET is_revoked = TRUE, revoked_by = $1, revoked_at = to_timestamp($2), updated_at = NOW()
          WHERE fingerprint_hash = $3
        `, [args[1].toLowerCase(), Number(args[2]), args[0]]);
        
        await updateCache(args[0], client);
        break;
        
      case 'FingerprintOwnershipTransferred':
         // string fingerprintHash, address previousOwner, address newOwner, uint256 transferredAt
         await client.query(`
          UPDATE agents 
          SET registered_by = $1, updated_at = NOW()
          WHERE fingerprint_hash = $2
        `, [args[2].toLowerCase(), args[0]]);
        
        await updateCache(args[0], client);
        break;
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Re-reads the unified agent row from Postgres and pushes the JSON hydration to Redis
 */
async function updateCache(fingerprintHash: string, client: any) {
  const { rows } = await client.query('SELECT * FROM agents WHERE fingerprint_hash = $1', [fingerprintHash]);
  if (rows.length === 0) return;
  
  const row = rows[0];
  
  // Conform to the strict TypeScript `AgentProfile` interface for the Next.js API
  const agentProfile = {
    fingerprintHash: row.fingerprint_hash,
    agent_id: row.agent_id,
    name: row.name,
    provider: row.provider,
    version: row.version,
    registeredBy: row.registered_by,
    createdAt: row.created_at.toISOString(),
    isRevoked: row.is_revoked,
    behavioralTrait: row.latest_trait_hash ? {
      hasTrait: true,
      latestTraitHash: row.latest_trait_hash,
      traitVersion: row.trait_version,
      lastUpdatedAt: row.trait_updated_at ? row.trait_updated_at.toISOString() : null
    } : { hasTrait: false }
  };

  try {
    await redis.set(`agent:${fingerprintHash}`, JSON.stringify(agentProfile));
    console.log(`[Cache Updated] agent:${fingerprintHash}`);
  } catch (err) {
    console.error(`[Cache Error] Failed to update Redis for agent:${fingerprintHash}`, err);
  }
}

// Start Worker
syncEvents();
