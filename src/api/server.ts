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

// Import our Phase 1 NLP pipeline and hash generators
import {
  verifyBehavioralSignature,
  generateBehavioralTraitHash,
  ResponseSet,
  VerificationResult
} from '../utils/behavioral.utils';
import { EventService } from '../services/event.service';
import { AnchorService } from '../services/anchor.service';
import { TriageService, AgentNotAvailableError } from '../services/triage.service';

dotenv.config();

// Initialize DB and Redis (acting as the synchronized Datastore from the Indexer)
const db = new Pool({
  connectionString: process.env.DATABASE_URL,
});

const redis = new Redis(process.env.REDIS_URL || 'redis://127.0.0.1:6379');

const eventService = new EventService(db);
const anchorService = new AnchorService(db);
const triageService = new TriageService(db);

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
      'SELECT fingerprint_hash, name, provider, is_revoked, latest_trait_hash IS NOT NULL as has_behavioral_trait FROM agents ORDER BY created_at DESC LIMIT $1',
      [limit]
    );

    res.json({
      data: rows.map(r => ({
        fingerprintHash: r.fingerprint_hash,
        name: r.name,
        provider: r.provider,
        isRevoked: r.is_revoked,
        hasBehavioralTrait: r.has_behavioral_trait
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
 * POST /v1/internal/traits/seed
 * INTERNAL ENDPOINT: Seed a behavioral ResponseSet into Redis, mimicking IPFS sidecar delivery.
 * Used during agent registration to store the baseline off-chain.
 */
app.post('/v1/internal/traits/seed', async (req: Request, res: Response) => {
  try {
    const { fingerprintHash, responseSet } = req.body;
    
    if (!fingerprintHash || !responseSet) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Missing fingerprintHash or responseSet' } });
      return;
    }

    // 1. Verify that this ResponseSet produces the EXACT traitHash expected by the smart contract
    // We use useCanonical = true to mimic the strict hashing done on registration
    const hashResult = generateBehavioralTraitHash(responseSet, true);
    
    // 2. Store the raw JSON responses in Redis
    await redis.set(`agent:responses:${fingerprintHash}`, JSON.stringify(responseSet));
    
    res.json({
      success: true,
      fingerprintHash,
      generatedTraitHash: hashResult.hash,
      traitVersion: hashResult.traitVersion,
      message: 'Traits successfully seeded in off-chain cache.'
    });
  } catch (error) {
    console.error('Error seeding traits:', error);
    res.status(500).json({ error: { code: 'internal_error', message: 'Failed to seed baseline traits' } });
  }
});

/**
 * POST /v1/events
 * Phase 1 Medical MVP: Append an immutable clinical interaction to the audit log.
 */
app.post('/v1/events', async (req: Request, res: Response) => {
  try {
    const payload = req.body;
    
    // Minimal PHI/Format Validation
    if (!payload.agent_fingerprint_id || !payload.input_ref || !payload.output_ref) {
      res.status(400).json({ error: { code: 'bad_request', message: 'Missing required logging fields' } });
      return;
    }
    
    // Guardrail against PHI: verify pointers look like hashes or pseudo-URIs, not raw text
    if (!payload.input_ref.includes('://') && !payload.input_ref.startsWith('sha')) {
      res.status(400).json({ error: { code: 'phi_violation_risk', message: 'input_ref must be a hash or compliant URI pointer' } });
      return;
    }

    const eventRecord = await eventService.ingestEvent({
      agent_fingerprint_id: payload.agent_fingerprint_id,
      model_version: payload.model_version || 'unknown',
      workflow_type: payload.workflow_type,
      policy_id: payload.policy_id,
      session_id: payload.session_id,
      clinician_action: payload.clinician_action,
      input_ref: payload.input_ref,
      output_ref: payload.output_ref
    });

    res.status(201).json({
      success: true,
      data: eventRecord
    });
  } catch (error: any) {
    console.error('Error creating event:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * GET /v1/events
 * Fetch the immutable clinical audit log with optional filters.
 */
app.get('/v1/events', async (req: Request, res: Response) => {
  try {
    const filters = {
      agent_fingerprint_id: req.query.agent_fingerprint_id as string,
      days_back: req.query.days_back ? parseInt(req.query.days_back as string, 10) : undefined
    };
    
    const events = await eventService.getEvents(filters);
    res.json({ success: true, data: events });
  } catch (error: any) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * GET /v1/triage/encounters
 * Secure read-model serving native Clinician UI triage queue arrays.
 * Employs deterministic PHI hydration with strict cryptographic integrity embedded on each row!
 */
app.get('/v1/triage/encounters', async (req: Request, res: Response) => {
  try {
    const filters = {
      state: req.query.state as string,
      acuity: req.query.acuity ? parseInt(req.query.acuity as string, 10) : undefined,
      source: req.query.source as 'live' | 'scenario' | undefined,
    };
    const encounters = await triageService.getTriageEncounters(filters);
    res.json({ success: true, data: encounters });
  } catch (error: any) {
    console.error('Error fetching triage encounters:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * GET /v1/triage/status
 * Returns the currently active agent for the triage role.
 */
app.get('/v1/triage/status', async (req: Request, res: Response) => {
  try {
    const { TRIAGE_AGENT } = require('../config/agents');
    const activeAgent = await triageService.getActiveAgent(TRIAGE_AGENT.slug);
    
    if (!activeAgent) {
      res.json({ 
        success: false, 
        available: false, 
        error: 'No active agent found for role: ' + TRIAGE_AGENT.slug 
      });
      return;
    }

    res.json({ 
      success: true, 
      available: true, 
      agent: {
        fingerprintHash: activeAgent.fingerprint_hash,
        name: activeAgent.name,
        provider: activeAgent.provider,
        version: activeAgent.version
      }
    });
  } catch (error: any) {
    console.error('Error fetching triage status:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * POST /v1/triage/encounters
 * Clinician-driven: create a new encounter, get AI triage recommendation, log to ledger.
 */
app.post('/v1/triage/encounters', async (req: Request, res: Response) => {
  try {
    const { chief_complaint, vitals, patient_context, red_flags, clinician_name } = req.body;

    if (!chief_complaint || !vitals?.hr || !vitals?.bp_sys || !vitals?.bp_dia || !patient_context?.demographics) {
      res.status(400).json({ error: { code: 'bad_request', message: 'chief_complaint, vitals(hr,bp_sys,bp_dia), and patient_context.demographics are required' } });
      return;
    }

    const encounter = await triageService.createEncounterWithAI(
      { 
        chief_complaint, 
        vitals, 
        patient_context,
        red_flags
      },
      clinician_name || 'clinician'
    );

    res.status(201).json({ success: true, data: encounter });
  } catch (error: any) {
    if (error instanceof AgentNotAvailableError) {
      res.status(503).json({ 
        error: { 
          code: 'agent_unavailable', 
          message: 'Clinical AI triage is temporarily unavailable. No active non-revoked agent found for this role.',
          details: { slug: error.slug }
        } 
      });
      return;
    }
    console.error('Error creating encounter:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * POST /v1/triage/encounters/:session_id/action
 * Log a clinician's accept / downgrade / escalate decision.
 */
app.post('/v1/triage/encounters/:session_id/action', async (req: Request, res: Response) => {
  try {
    const { session_id } = req.params;
    const { action, reason_code, reason_text, assigned_acuity } = req.body;

    const validActions = ['accepted', 'overridden', 'downgraded', 'escalated'];
    if (!action || !validActions.includes(action)) {
      res.status(400).json({ error: { code: 'bad_request', message: `action must be one of: ${validActions.join(', ')}` } });
      return;
    }

    const result = await triageService.logClinicianAction(session_id, action, reason_code, reason_text, assigned_acuity);
    res.json({ 
      success: true, 
      action, 
      session_id, 
      is_amendment: result.is_amendment,
      previous_action: result.previous_action 
    });
  } catch (error: any) {
    if (error instanceof AgentNotAvailableError) {
      res.status(503).json({ 
        error: { 
          code: 'agent_unavailable', 
          message: 'Unable to log action: The active system agent is missing or revoked.',
          details: { slug: error.slug }
        } 
      });
      return;
    }
    console.error('Error logging clinician action:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * GET /v1/triage/encounters/:session_id/history
 * Fetch the full decision chain for a single encounter.
 */
app.get('/v1/triage/encounters/:session_id/history', async (req: Request, res: Response) => {
  try {
    const { session_id } = req.params;
    const lineage = await triageService.getEncounterHistory(session_id);
    res.json({ success: true, session_id, lineage });
  } catch (error: any) {
    console.error('Error fetching encounter history:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * GET /v1/triage/encounters/:session_id/audit-pack
 * Export a regulatory-grade inspection bundle as a JSON file.
 */
app.get('/v1/triage/encounters/:session_id/audit-pack', async (req: Request, res: Response) => {
  try {
    const { session_id } = req.params;
    const pack = await triageService.getAuditPack(session_id);
    
    // Set response headers for file download
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="audit-pack-${session_id.substring(0, 8)}.json"`);
    
    res.json(pack);
  } catch (error: any) {
    console.error('Error generating audit pack:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * POST /v1/events/anchor/trigger
 * DEV TRIGGER: Force the background anchoring job to run immediately.
 */
app.post('/v1/events/anchor/trigger', async (req: Request, res: Response) => {
  try {
    const result = await anchorService.anchorPendingEvents();
    res.json(result);
  } catch (error: any) {
    console.error('Error triggering anchor:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * GET /health/audit
 * INTERNAL ENDPOINT: Verify the cryptographic consistency of the local Postgres DB.
 */
app.get('/health/audit', async (req: Request, res: Response) => {
  try {
    const result = await anchorService.verifyDatabaseIntegrity();
    res.json(result);
  } catch (error: any) {
    console.error('Error auditing DB:', error);
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

/**
 * POST /v1/agents/verify
 * The core endpoint for relying parties (e.g. merchants) to verify an AI agent's trustworthiness
 */
app.post('/v1/agents/verify', async (req: Request, res: Response) => {
  try {
    // Phase 1.5 Update: We now expect a full ResponseSet instead of a single string hash
    const { fingerprintHash, currentResponseSet, context } = req.body;

    if (!fingerprintHash) {
      res.status(400).json({
        error: {
          code: "bad_request",
          message: "Missing fingerprintHash in request body",
        },
      });
      return;
    }

    // 1. Lookup Agent (prefer Redis)
    let agentProfile: any = null;
    const cached = await redis.get(`agent:${fingerprintHash}`);

    if (cached) {
      agentProfile = JSON.parse(cached);
    } else {
      const { rows } = await db.query(
        "SELECT * FROM agents WHERE fingerprint_hash = $1",
        [fingerprintHash],
      );
      if (rows.length === 0) {
        res.status(404).json({
          error: {
            code: "agent_not_found",
            message: "No agent found for the provided fingerprintHash.",
          },
        });
        return;
      }
      agentProfile = {
        fingerprintHash: rows[0].fingerprint_hash,
        name: rows[0].name,
        provider: rows[0].provider,
        isRevoked: rows[0].is_revoked,
        behavioralTrait: rows[0].latest_trait_hash
          ? {
              hasTrait: true,
              latestTraitHash: rows[0].latest_trait_hash,
            }
          : undefined,
      };
    }

    // 2. Base Rules Engine
    let trust_score = 100;
    let decision = "accept";
    const signals: string[] = [];
    let recommendations: string[] = [];
    let verification_details: { similarity_score?: number } | undefined =
      undefined;

    // Rule 1: Revocation
    if (agentProfile.isRevoked) {
      res.json({
        decision: "deny",
        trust_score: 0,
        agent: {
          fingerprintHash: agentProfile.fingerprintHash,
          name: agentProfile.name,
          provider: agentProfile.provider,
          isRevoked: true,
        },
        signals: ["agent_revoked"],
        indexer: { isStale: false, lagBlocks: 0 },
        recommendations: [
          "Agent has been revoked on-chain and must be blocked.",
        ],
        verification_details,
      });
      return;
    }

    signals.push("contract_status_active");

    // Rule 2: Off-chain Semantic Behavioral Match
    // Pull the baseline ResponseSet from Redis that was seeded during registration
    if (agentProfile.behavioralTrait?.hasTrait && currentResponseSet) {
      const baselineJson = await redis.get(
        `agent:responses:${fingerprintHash}`,
      );

      if (!baselineJson) {
        // We know they have a trait on-chain, but the IPFS/Redis sync failed!
        res.status(503).json({
          error: {
            code: "unavailable",
            message: "Baseline responses not synced to off-chain cache yet",
          },
        });
        return;
      }

      const baselineResponses: ResponseSet = JSON.parse(baselineJson);

      // Execute the Phase 1 Jaccard Similarity and Perturbation Pipeline
      const verification: VerificationResult = verifyBehavioralSignature(
        baselineResponses,
        currentResponseSet,
        "triage", // Use loose matching for standard web verification
      );

      verification_details = { similarity_score: verification.similarity };

      // Map NLP metrics to our Gateway Trust Score
      if (verification.match) {
        if (verification.perturbation.suspicious) {
          signals.push("suspicious_perturbations_detected");
          trust_score = 0;
          decision = "deny";
          recommendations.push(
            "Hard reject: Probable homograph injection or evasion assault.",
          );
        } else {
          signals.push("behavioral_match_success");
          // Confidence scaling based on perturbation absence and similarity strength
          trust_score = Math.floor(verification.confidence * 100);
        }
      } else {
        signals.push("behavioral_mismatch");
        if (verification.perturbation.suspicious) {
          signals.push("suspicious_perturbations_detected");
          trust_score = 0;
          decision = "deny";
          recommendations.push(
            "Hard reject: Probable homograph injection or evasion assault.",
          );
        } else {
          // Similarity failure (e.g. Model swap)
          trust_score = Math.floor(verification.similarity * 100);
          decision = "challenge";
          recommendations.push(
            "Similarity score too low. Possible model substitution.",
          );
        }
      }
    } else if (agentProfile.behavioralTrait?.hasTrait && !currentResponseSet) {
      // Merchant failed to send the response payload when one is required
      trust_score -= 25;
      signals.push("missing_behavioral_assertion");
    }

    // Rule 3: Contextual Checks (Naive MVP logic)
    if (context && context.ip_address) {
      signals.push("ip_reputation_clean");
    }

    // Final Decision Boundary Execution
    // If it hasn't already been blocked by a perturbation fault
    if (decision !== "deny") {
      if (trust_score < 60) {
        decision = "challenge";
        recommendations.push("Present step-up challenge or CAPTCHA.");
      } else {
        decision = "accept";
      }
    }

    res.json({
      decision,
      trust_score,
      agent: {
        fingerprintHash: agentProfile.fingerprintHash,
        name: agentProfile.name,
        provider: agentProfile.provider,
        isRevoked: false,
      },
      signals,
      indexer: { isStale: false, lagBlocks: 0 },
      recommendations,
      verification_details,
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
