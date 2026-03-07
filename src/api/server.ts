// @ts-ignore
import express, { Request, Response, NextFunction } from 'express';
// @ts-ignore
import cors from 'cors';
import { Pool } from 'pg';
import Redis from 'ioredis';
import * as dotenv from 'dotenv';
import { ethers } from 'ethers';
// @ts-ignore
import swaggerUi from 'swagger-ui-express';
import * as yaml from 'yaml';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();

// Initialize DB and Redis (acting as the synchronized Datastore from the Indexer)
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const app = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.API_KEY || 'sk_test_123';

// --- Middleware ---
app.use(cors());
app.use(express.json());

// Serve Swagger UI
const openapiPath = path.join(__dirname, 'openapi.yaml');
const file = fs.readFileSync(openapiPath, 'utf8');
const swaggerDocument = yaml.parse(file);
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// API Key Authentication Middleware for /v1/* routes
const authenticate = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Missing Authorization header' } });
    return;
  }
  
  const token = authHeader.split(' ')[1];
  if (token !== API_KEY) {
    res.status(401).json({ error: { code: 'unauthorized', message: 'Invalid API key' } });
    return;
  }
  
  next();
};

app.use('/v1', authenticate);

// --- Routes ---

/**
 * GET /v1/agents
 * List all globally registered agents (with basic pagination via cursor in the future)
 */
app.get('/v1/agents', async (req: Request, res: Response) => {
  try {
    const limit = parseInt(req.query.limit as string) || 20;
    // For MVP, simplistic ordering by creation date
    const { rows } = await db.query(
      'SELECT fingerprint_hash, name, provider, is_revoked FROM agents ORDER BY created_at DESC LIMIT $1',
      [limit]
    );

    res.json({
      data: rows.map(r => ({
        fingerprintHash: r.fingerprint_hash,
        name: r.name,
        provider: r.provider,
        isRevoked: r.is_revoked,
      })),
      has_more: false,
      next_cursor: null,
    });
  } catch (error) {
    console.error('Error fetching agents:', error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to fetch agents data' } });
  }
});

/**
 * GET /v1/agents/:fingerprintHash
 * Fetch a specific agent's detailed profile
 */
app.get('/v1/agents/:fingerprintHash', async (req: Request, res: Response) => {
  try {
    const { fingerprintHash } = req.params;

    // 1. Check Redis Cache for ultra-fast response
    const cached = await redis.get(`agent:${fingerprintHash}`);
    if (cached) {
      res.json(JSON.parse(cached));
      return;
    }

    // 2. Fallback to Postgres if not in cache (and re-hydrate cache)
    const { rows } = await db.query('SELECT * FROM agents WHERE fingerprint_hash = $1', [fingerprintHash]);
    
    if (rows.length === 0) {
      res.status(404).json({ error: { code: 'agent_not_found', message: 'No agent found for the provided fingerprintHash.' } });
      return;
    }

    const row = rows[0];
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
      } : { hasTrait: false },
      indexer: { isStale: false, lagBlocks: 0 } // Mock indexer health for MVP
    };

    // Asynchronously update the cache
    redis.set(`agent:${fingerprintHash}`, JSON.stringify(agentProfile)).catch(console.error);

    res.json(agentProfile);
  } catch (error) {
    console.error('Error fetching agent:', error);
    res.status(500).json({ error: { code: 'internal_error', message: 'An internal error occurred' } });
  }
});

/**
 * POST /v1/agents/verify
 * The core endpoint for relying parties (e.g. merchants) to verify an AI agent's trustworthiness
 */
app.post('/v1/agents/verify', async (req: Request, res: Response) => {
  try {
    const { fingerprintHash, currentTraitPayload, context } = req.body;

    if (!fingerprintHash) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Missing fingerprintHash in request body' } });
      return;
    }

    // 1. Lookup Agent (prefer Redis)
    let agentProfile: any = null;
    const cached = await redis.get(`agent:${fingerprintHash}`);
    
    if (cached) {
      agentProfile = JSON.parse(cached);
    } else {
      const { rows } = await db.query('SELECT * FROM agents WHERE fingerprint_hash = $1', [fingerprintHash]);
      if (rows.length === 0) {
        res.status(404).json({ error: { code: 'agent_not_found', message: 'No agent found for the provided fingerprintHash.' } });
        return;
      }
      agentProfile = {
        fingerprintHash: rows[0].fingerprint_hash,
        name: rows[0].name,
        provider: rows[0].provider,
        isRevoked: rows[0].is_revoked,
        behavioralTrait: rows[0].latest_trait_hash ? {
          hasTrait: true,
          latestTraitHash: rows[0].latest_trait_hash
        } : undefined
      };
    }

    // 2. Base Rules Engine
    let trust_score = 100;
    let decision = 'accept';
    const signals: string[] = [];

    // Rule 1: Revocation
    if (agentProfile.isRevoked) {
      res.json({
        decision: 'deny',
        trust_score: 0,
        agent: {
          fingerprintHash: agentProfile.fingerprintHash,
          name: agentProfile.name,
          provider: agentProfile.provider,
          isRevoked: true
        },
        signals: ['agent_revoked'],
        indexer: { isStale: false, lagBlocks: 0 },
        recommendations: ['Agent has been revoked on-chain and must be blocked.']
      });
      return;
    }

    signals.push('contract_status_active');

    // Rule 2: Off-chain Behavioral Match Simulation
    // We hash the raw payload exactly as the solidity contract would and compare it to the registered hash.
    if (agentProfile.behavioralTrait?.hasTrait && currentTraitPayload) {
      const payloadHash = ethers.keccak256(ethers.toUtf8Bytes(currentTraitPayload));
      if (payloadHash === agentProfile.behavioralTrait.latestTraitHash) {
        signals.push('behavioral_match_success');
      } else {
        trust_score -= 50; 
        decision = 'challenge';
        signals.push('behavioral_mismatch');
      }
    }

    // Rule 3: Contextual Checks (Naive MVP logic)
    if (context && context.ip_address) {
      // In production, integrate with IP reputation databases or WAFs here
      signals.push('ip_reputation_clean');
    }

    // Final Decision Boundary
    if (trust_score < 60) {
      decision = 'challenge';
    }

    res.json({
      decision,
      trust_score,
      agent: {
        fingerprintHash: agentProfile.fingerprintHash,
        name: agentProfile.name,
        provider: agentProfile.provider,
        isRevoked: false
      },
      signals,
      indexer: { isStale: false, lagBlocks: 0 },
      recommendations: decision === 'challenge' ? ['Present step-up challenge or CAPTCHA.'] : []
    });

  } catch (error) {
    console.error('Error verifying agent:', error);
    res.status(500).json({ error: { code: 'internal_error', message: 'An internal error occurred during verification' } });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`Web2.5 Gateway API running on port ${PORT}`);
  console.log(`Requires Authorization: Bearer ${API_KEY}`);
});
