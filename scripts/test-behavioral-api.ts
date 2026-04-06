import { ethers } from 'ethers';
import axios from 'axios';
import { Client } from 'pg';
import { generateBehavioralTraitHash } from '../src/utils/behavioral.utils';
import { REASONING_TEST_SUITE_V1 } from '../src/tests/behavioralTestSuite';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const API_KEY = process.env.API_KEY || 'sk_test_123'; // Default for testing if not in .env

// Axios instance with auth
const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Authorization': `Bearer ${API_KEY}`,
    'Content-Type': 'application/json'
  }
});

async function runTest() {
  console.log('🧪 Starting Phase 1.5 Web2.5 Gateway Integration Test');
  console.log(`Connecting to API at: ${API_BASE_URL}`);

  // 1. Generate a mock fingerprint hash for an agent
  const mockAgentWallet = ethers.Wallet.createRandom();
  const fingerprintHash = ethers.keccak256(ethers.toUtf8Bytes(mockAgentWallet.address + Date.now().toString()));
  console.log(`\n🔑 Generated mock Agent fingerprintHash: ${fingerprintHash}`);

  // 2. Generate a baseline ResponseSet
  console.log('\n📝 Generating Baseline ResponseSet...');
  const baselineResponses = {
    testSuiteVersion: REASONING_TEST_SUITE_V1.version,
    responses: REASONING_TEST_SUITE_V1.prompts.map(prompt => ({
      promptId: prompt.id,
      prompt: prompt.prompt,
      response: `This is a baseline response to: ${prompt.prompt}`,
      timestamp: Date.now()
    })),
    generatedAt: Date.now()
  };

  const traitResult = generateBehavioralTraitHash(baselineResponses);
  console.log(`Calculated Baseline Trait Hash: ${traitResult.hash}`);

  // 3. Inject Agent into Database to pass 404 check
  console.log('\n🗄️ Step 1: Injecting mock Agent into Database...');
  const db = new Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/fingerprint'
  });
  await db.connect();
  try {
    const mockAgentId = Date.now().toString();
    await db.query(`
      INSERT INTO agents (
        agent_id, fingerprint_hash, name, provider, version, 
        registered_by, created_at, is_revoked, latest_trait_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (fingerprint_hash) DO NOTHING
    `, [
      mockAgentId, fingerprintHash, 'Test Agent', 'Test Provider', '1.0.0',
      '0x1234567890123456789012345678901234567890', new Date(), false, traitResult.hash
    ]);
    console.log('✅ Mock Agent injected successfully.');
  } catch (err: any) {
    console.error('❌ Failed to inject mock Agent:', err.message);
    await db.end();
    return;
  }

  // 4. Test Seeding the Sidecar (POST /v1/internal/traits/seed)
  console.log('\n🌱 Step 2: Seeding baseline to Redis Sidecar...');
  try {
    const seedRes = await api.post('/v1/internal/traits/seed', {
      fingerprintHash,
      responseSet: traitResult.responseSet
    });
    console.log('✅ Seed successful:', seedRes.data);
  } catch (err: any) {
    console.error('❌ Seeding failed:', err.response?.data || err.message);
    return;
  }

  // 4. Test Verification - Exact Match
  console.log('\n🔍 Step 2: Testing Verification with Exact Match...');
  try {
    const verifyRes = await api.post('/v1/agents/verify', {
      fingerprintHash,
      currentResponseSet: traitResult.responseSet,
      context: {
        ip_address: '127.0.0.1'
      }
    });
    console.log('✅ Exact Match Result:', {
      decision: verifyRes.data.decision,
      trust_score: verifyRes.data.trust_score,
      signals: verifyRes.data.signals
    });
  } catch (err: any) {
    console.error('❌ Verification failed:', err.response?.data || err.message);
  }

  // 5. Test Verification - Semantic Variation (Should pass with high trust)
  console.log('\n🤖 Step 3: Testing Verification with Semantic Variation...');
  const semanticResponses = {
    testSuiteVersion: REASONING_TEST_SUITE_V1.version,
    responses: baselineResponses.responses.map(r => ({
      promptId: r.promptId,
      prompt: r.prompt,
      // Add some extra words but keep meaning similar
      response: r.response + ' I am highly confident in this answer.',
      timestamp: Date.now()
    })),
    generatedAt: Date.now()
  };
  const semanticTraitResult = generateBehavioralTraitHash(semanticResponses);

  try {
    const semanticRes = await api.post('/v1/agents/verify', {
      fingerprintHash,
      currentResponseSet: semanticTraitResult.responseSet,
      context: {
        ip_address: '127.0.0.1'
      }
    });
    console.log('✅ Semantic Variation Result:', {
      decision: semanticRes.data.decision,
      trust_score: semanticRes.data.trust_score,
      signals: semanticRes.data.signals
    });
  } catch (err: any) {
    console.error('❌ Verification failed:', err.response?.data || err.message);
  }

  // 6. Test Verification - Homograph Attack (Should fail and flag)
  console.log('\n🚨 Step 4: Testing Verification with Homograph Evasion Attempt...');
  const homographResponses = {
    testSuiteVersion: REASONING_TEST_SUITE_V1.version,
    responses: baselineResponses.responses.map(r => ({
      promptId: r.promptId,
      prompt: r.prompt,
      // Replace 'a' with Cyrillic 'а'
      response: r.response.replace(/a/g, '\u0430'),
      timestamp: Date.now()
    })),
    generatedAt: Date.now()
  };
  const homographTraitResult = generateBehavioralTraitHash(homographResponses);

  try {
    const homographRes = await api.post('/v1/agents/verify', {
      fingerprintHash,
      currentResponseSet: homographTraitResult.responseSet,
      context: {
        ip_address: '127.0.0.1'
      }
    });
    console.log('✅ Evasion Attempt Result:', {
      decision: homographRes.data.decision,
      trust_score: homographRes.data.trust_score,
      signals: homographRes.data.signals
    });
  } catch (err: any) {
    console.error('❌ Verification failed:', err.response?.data || err.message);
  }

  // Cleanup Database
  console.log('\n🧹 Cleaning up Database...');
  await db.query('DELETE FROM agents WHERE fingerprint_hash = $1', [fingerprintHash]);
  await db.end();

  console.log('\n🏁 Phase 1.5 Testing Complete.');
}

runTest().catch(console.error);
