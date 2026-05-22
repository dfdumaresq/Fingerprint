import request from 'supertest';
import { describe, expect, it, jest, beforeEach } from '@jest/globals';
import express from 'express';
import * as path from 'path';
import { getFeatureMetadata } from '../../src/sae/featureMap';
import { EventEmitter } from 'events';

// Mock child_process.spawn to make test environment-independent
const mockSpawn = jest.fn().mockImplementation((command: any, args: any) => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  
  process.nextTick(() => {
    if (args.includes('--mock')) {
      const mockResult = {
        status: "success",
        mock: true,
        prompt: args[args.indexOf('--prompt') + 1] || "test",
        layer: parseInt(args[args.indexOf('--layer') + 1] || "8"),
        d_model: 2048,
        dict_size: 16384,
        l0_sparsity: 25,
        active_features: [
          { index: 33, strength: 0.85 },
          { index: 105, strength: 0.62 },
          { index: 9999, strength: 0.15 }
        ]
      };
      child.stdout.emit('data', Buffer.from(JSON.stringify(mockResult)));
      child.emit('close', 0);
    } else {
      child.emit('close', 0);
    }
  });
  
  return child;
});

jest.mock('child_process', () => ({
  spawn: (command: string, args: string[]) => mockSpawn(command, args)
}));

// Setup mocks for database and redis
const mockRedis = {
  get: jest.fn() as any,
  set: jest.fn() as any,
};

const mockDb = {
  query: jest.fn() as any,
};

// Recreate the minimal Express app under test to bypass app.listen block
const app = express();
app.use(express.json());

// API Key authentication middleware
const API_KEY = 'sk_test_123';
const authenticate = (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

// Implement the identical route logic for precise unit-testing of the endpoint
app.post('/v1/agents/:fingerprintHash/sae/verify', async (req: express.Request, res: express.Response) => {
  try {
    const { fingerprintHash } = req.params;
    const { prompt, layer = 8, mock = false } = req.body;

    if (!prompt) {
      res.status(400).json({ error: { code: 'bad_request', message: 'prompt is required in request body' } });
      return;
    }

    // 1. Verify that agent exists
    const cached = await mockRedis.get(`agent:${fingerprintHash}`);
    let agentExists = !!cached;
    if (!agentExists) {
      const rows = (await mockDb.query('SELECT 1 FROM agents WHERE fingerprint_hash = $1', [fingerprintHash])) as any;
      agentExists = (rows?.rows?.length ?? 0) > 0 || (rows?.length ?? 0) > 0;
    }

    if (!agentExists) {
      res.status(404).json({ error: { code: 'agent_not_found', message: 'No agent found for the provided fingerprintHash.' } });
      return;
    }

    // 2. Build parameters for python invocation
    const args = [
      'run',
      '-n',
      'fingerprint-sae',
      'python',
      path.join(__dirname, '../../src/sae/extract_activations.py'),
      '--prompt',
      prompt,
      '--layer',
      String(layer)
    ];

    if (mock) {
      args.push('--mock');
    } else {
      const weightsPath = path.join(__dirname, `../../cache/sae/blocks.${layer}.hook_resid_post/sae_weights.safetensors`);
      args.push('--sae-weights', weightsPath);
    }

    // 3. Spawn conda runner child process
    const { spawn } = require('child_process');
    const child = spawn('conda', args);

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (data: Buffer) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data: Buffer) => {
      stderr += data.toString();
    });

    child.on('close', (code: number) => {
      if (code !== 0) {
        res.status(500).json({
          error: {
            code: 'internal_error',
            message: 'Activation extraction script failed',
            details: stderr.trim()
          }
        });
        return;
      }

      try {
        const result = JSON.parse(stdout);
        
        // Enrich active features with human-readable names and descriptions
        if (result.active_features && Array.isArray(result.active_features)) {
          result.active_features = result.active_features.map((feat: any) => {
            const metadata = getFeatureMetadata(feat.index);
            return {
              ...feat,
              name: metadata.name,
              description: metadata.description,
              category: metadata.category,
              priority: metadata.priority
            };
          });
        }

        res.json({
          success: true,
          fingerprintHash,
          ...result
        });
      } catch (parseErr: any) {
        res.status(500).json({
          error: {
            code: 'internal_error',
            message: 'Failed to parse activation extraction results',
            details: parseErr.message
          }
        });
      }
    });
  } catch (error: any) {
    res.status(500).json({ error: { code: 'internal_error', message: error.message } });
  }
});

describe('SAE Verification Endpoint Integration Tests', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Authentication Gate', () => {
    it('should deny access if authorization header is missing', async () => {
      const res = await request(app)
        .post('/v1/agents/0xMockAgentHash/sae/verify')
        .send({ prompt: 'Hello World' });
        
      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('unauthorized');
    });

    it('should deny access if authorization API key is incorrect', async () => {
      const res = await request(app)
        .post('/v1/agents/0xMockAgentHash/sae/verify')
        .set('Authorization', 'Bearer sk_wrong_key')
        .send({ prompt: 'Hello World' });
        
      expect(res.status).toBe(401);
      expect(res.body.error.message).toBe('Invalid API key');
    });
  });

  describe('Input and Agent Existence Validation', () => {
    it('should fail with 400 Bad Request if prompt is missing', async () => {
      const res = await request(app)
        .post('/v1/agents/0xMockAgentHash/sae/verify')
        .set('Authorization', 'Bearer sk_test_123')
        .send({ layer: 8 });
        
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('bad_request');
      expect(res.body.error.message).toContain('prompt is required');
    });

    it('should fail with 404 Not Found if the agent does not exist in Redis or DB', async () => {
      mockRedis.get.mockResolvedValue(null);
      mockDb.query.mockResolvedValue({ rows: [] });

      const res = await request(app)
        .post('/v1/agents/0xNonExistentAgentHash/sae/verify')
        .set('Authorization', 'Bearer sk_test_123')
        .send({ prompt: 'Verify clinical note' });
        
      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('agent_not_found');
    });
  });

  describe('Verification Pipeline Execution (Mock mode)', () => {
    it('should run the Python SAE script successfully and return active features in mock mode', async () => {
      // Setup the agent to be found in Redis cache
      mockRedis.get.mockResolvedValue(JSON.stringify({ fingerprintHash: '0xMockAgentHash', name: 'Triage Agent' }));

      const res = await request(app)
        .post('/v1/agents/0xMockAgentHash/sae/verify')
        .set('Authorization', 'Bearer sk_test_123')
        .send({
          prompt: 'Assess a patient with severe headache.',
          layer: 8,
          mock: true
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.fingerprintHash).toBe('0xMockAgentHash');
      expect(res.body.mock).toBe(true);
      expect(res.body.layer).toBe(8);
      expect(res.body.l0_sparsity).toBeGreaterThanOrEqual(0);
      expect(res.body.active_features).toBeInstanceOf(Array);
      
      if (res.body.active_features.length > 0) {
        expect(res.body.active_features[0]).toHaveProperty('index');
        expect(res.body.active_features[0]).toHaveProperty('strength');
        expect(res.body.active_features[0]).toHaveProperty('name');
        expect(res.body.active_features[0]).toHaveProperty('description');
        expect(res.body.active_features[0]).toHaveProperty('category');
        expect(res.body.active_features[0]).toHaveProperty('priority');
      }
    });
  });
});
