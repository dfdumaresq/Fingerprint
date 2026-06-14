import request from 'supertest';
import { describe, expect, it, beforeEach, afterEach, beforeAll, afterAll } from '@jest/globals';
import express, { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { TriageService } from '../../src/services/triage.service';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

const testDbUrl = process.env.DATABASE_URL || 'postgresql://localhost:5432/fingerprint_test';
const API_KEY = 'sk_test_123';

describe('Dynamic Agent Activation API integration tests', () => {
  let dbPool: Pool;
  let triageService: TriageService;
  let app: express.Express;

  beforeAll(async () => {
    dbPool = new Pool({ connectionString: testDbUrl });
    triageService = new TriageService(dbPool);

    // Initialize express app under test
    app = express();
    app.use(express.json());

    // 1. Correlation/Request ID Middleware
    app.use((req: Request, res: Response, next: NextFunction) => {
      const requestId = (req.headers['x-request-id'] as string) || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      req.headers['x-request-id'] = requestId;
      res.setHeader('X-Request-ID', requestId);
      next();
    });

    // 2. Authentication Middleware
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

    // 3. Define routes matching server.ts exactly
    app.get('/v1/agents/activation-history', async (req: Request, res: Response) => {
      try {
        const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
        const history = await triageService.getActivationAuditTrail(limit);
        res.json({ success: true, data: history });
      } catch (error: any) {
        res.status(500).json({ error: { code: 'internal_error', message: error.message } });
      }
    });

    app.post('/v1/agents/activate', async (req: Request, res: Response) => {
      try {
        const { fingerprintHash, reason } = req.body;
        if (!fingerprintHash) {
          res.status(400).json({ error: { code: 'bad_request', message: 'fingerprintHash is required' } });
          return;
        }

        const requestId = req.headers['x-request-id'] as string;
        const source = (req.headers['x-source'] as string) || 'ui';

        const actor = {
          type: 'system',
          userId: 'system_dashboard',
          displayName: 'System Dashboard',
          role: 'System Service',
        };

        const result = await triageService.activateAgentWithAudit({
          targetFingerprintHash: fingerprintHash,
          actor,
          source,
          requestId,
          reason,
        });

        res.status(200).json({
          success: true,
          data: {
            eventId: result.eventId,
            occurredAt: result.occurredAt,
            requestId,
            message: `Agent successfully activated by ${actor.displayName}.`,
            agent: result.agent
          },
        });
      } catch (error: any) {
        res.status(500).json({ error: { code: 'internal_error', message: error.message } });
      }
    });

    // Global Error Handler
    app.use((err: any, req: Request, res: Response, next: NextFunction) => {
      const requestId = req.headers['x-request-id'] as string;
      if (requestId) {
        res.setHeader('X-Request-ID', requestId);
      }
      res.status(500).json({
        error: {
          code: 'internal_error',
          message: err.message || 'An unexpected error occurred.',
          requestId
        }
      });
    });
  });

  afterAll(async () => {
    await dbPool.end();
  });

  const agent1Hash = '0x1111111111111111111111111111111111111111111111111111111111111111';
  const agent2Hash = '0x2222222222222222222222222222222222222222222222222222222222222222';
  const revokedAgentHash = '0x3333333333333333333333333333333333333333333333333333333333333333';

  beforeEach(async () => {
    // Clean tables and seed test agents
    await dbPool.query('TRUNCATE audit.agent_activation_events RESTART IDENTITY CASCADE');
    await dbPool.query('DELETE FROM agents');

    await dbPool.query(`
      INSERT INTO agents (fingerprint_hash, agent_id, name, provider, version, registered_by, created_at, is_active, is_revoked)
      VALUES 
        ($1, 'agent-1', 'Agent One', 'ollama', '1.0.0', '0x123', NOW(), false, false),
        ($2, 'agent-2', 'Agent Two', 'ollama', '1.0.0', '0x123', NOW(), false, false),
        ($3, 'agent-revoked', 'Revoked Agent', 'ollama', '1.0.0', '0x123', NOW(), false, true)
    `, [agent1Hash, agent2Hash, revokedAgentHash]);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 1: Successful Activation Audit
  // ═══════════════════════════════════════════════════════════════════════════
  it('should successfully activate an agent, update is_active in DB, and write a success audit row', async () => {
    const res = await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ fingerprintHash: agent1Hash, reason: 'Activating Agent One for production' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.eventId).toBeDefined();
    expect(res.body.data.requestId).toBeDefined();
    expect(res.body.data.agent.slug).toBe('agent-1');

    // Verify DB update: agent-1 is active, agent-2 is not
    const agent1Check = await dbPool.query('SELECT is_active FROM agents WHERE fingerprint_hash = $1', [agent1Hash]);
    const agent2Check = await dbPool.query('SELECT is_active FROM agents WHERE fingerprint_hash = $1', [agent2Hash]);
    expect(agent1Check.rows[0].is_active).toBe(true);
    expect(agent2Check.rows[0].is_active).toBe(false);

    // Verify DB audit log
    const auditRes = await dbPool.query('SELECT * FROM audit.agent_activation_events WHERE id = $1', [res.body.data.eventId]);
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].outcome).toBe('success');
    expect(auditRes.rows[0].actor_id).toBe('system_dashboard');
    expect(auditRes.rows[0].target_fingerprint_hash).toBe(agent1Hash);
    expect(auditRes.rows[0].reason).toBe('Activating Agent One for production');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 2: Failed Activation Rollback & Audit
  // ═══════════════════════════════════════════════════════════════════════════
  it('should roll back changes when trying to activate a revoked agent, and write a failure audit row', async () => {
    const res = await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ fingerprintHash: revokedAgentHash, reason: 'Trying to activate revoked agent' });

    expect(res.status).toBe(500); // throws error due to target being revoked

    // Verify DB state is still false (rolled back)
    const agentRevokedCheck = await dbPool.query('SELECT is_active FROM agents WHERE fingerprint_hash = $1', [revokedAgentHash]);
    expect(agentRevokedCheck.rows[0].is_active).toBe(false);

    // Verify failure audit log exists
    const auditRes = await dbPool.query("SELECT * FROM audit.agent_activation_events WHERE outcome = 'failure'");
    expect(auditRes.rows.length).toBe(1);
    expect(auditRes.rows[0].target_fingerprint_hash).toBe(revokedAgentHash);
    expect(auditRes.rows[0].reason).toBe('Trying to activate revoked agent');
    expect(auditRes.rows[0].metadata.error).toContain('Cannot activate revoked agent');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 3: Audit Ordering
  // ═══════════════════════════════════════════════════════════════════════════
  it('should return the activation history ordered by occurred_at DESC (newest first)', async () => {
    // Log success 1
    await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ fingerprintHash: agent1Hash, reason: 'Activate 1' });

    // Wait a brief moment to ensure separate timestamps
    await new Promise(resolve => setTimeout(resolve, 50));

    // Log success 2
    await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .send({ fingerprintHash: agent2Hash, reason: 'Activate 2' });

    const res = await request(app)
      .get('/v1/agents/activation-history')
      .set('Authorization', `Bearer ${API_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.length).toBe(2);

    // Newest first
    expect(res.body.data[0].target_fingerprint_hash).toBe(agent2Hash);
    expect(res.body.data[1].target_fingerprint_hash).toBe(agent1Hash);
  });

  // ═══════════════════════════════════════════════════════════════════════════
  // TEST 4: Header Correlation
  // ═══════════════════════════════════════════════════════════════════════════
  it('should propagate X-Request-ID on both success and error responses', async () => {
    // 1. Success case
    const successRes = await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Request-ID', 'custom-success-id')
      .send({ fingerprintHash: agent1Hash, reason: 'test success request header' });

    expect(successRes.headers['x-request-id']).toBe('custom-success-id');

    // 2. Client error case (Missing parameter)
    const clientErrorRes = await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Request-ID', 'custom-client-error-id')
      .send({ reason: 'missing fingerprintHash' });

    expect(clientErrorRes.headers['x-request-id']).toBe('custom-client-error-id');
    expect(clientErrorRes.status).toBe(400);

    // 3. Server error case (Activation of revoked agent)
    const serverErrorRes = await request(app)
      .post('/v1/agents/activate')
      .set('Authorization', `Bearer ${API_KEY}`)
      .set('X-Request-ID', 'custom-server-error-id')
      .send({ fingerprintHash: revokedAgentHash, reason: 'test server error request header' });

    expect(serverErrorRes.headers['x-request-id']).toBe('custom-server-error-id');
    expect(serverErrorRes.status).toBe(500);
  });
});
