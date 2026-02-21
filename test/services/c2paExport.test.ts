/**
 * Functional tests for C2PA Manifest Exporting
 */

import { C2PAService } from '../../src/services/c2pa.service';
import { Agent } from '../../src/types';
import { VerificationResult } from '../../src/utils/behavioral.utils';
import { webcrypto } from 'node:crypto';

// Polyfill WebCrypto for Node环境
if (!global.crypto) {
  global.crypto = webcrypto as any;
}

// Mock LocalStorage for Node environment
const mockStorage: Record<string, string> = {};
global.localStorage = {
  getItem: (key: string) => mockStorage[key] || null,
  setItem: (key: string, value: string) => { mockStorage[key] = value; },
  removeItem: (key: string) => { delete mockStorage[key]; },
  clear: () => { for (const k in mockStorage) delete mockStorage[k]; },
  length: 0,
  key: (i: number) => Object.keys(mockStorage)[i] || null
};

describe('C2PA Functional Exporting', () => {
  let c2paService: C2PAService;
  const testAgent: Agent = {
    id: 'agent-123',
    name: 'Test Agent',
    provider: 'OpenAI',
    version: 'GPT-4o',
    fingerprintHash: '0xabc',
    createdAt: Date.now()
  };

  beforeEach(() => {
    c2paService = new C2PAService();
  });

  it('should generate a valid Identity Manifest JSON', async () => {
    // 1. Initialize identity
    await c2paService.initializeIdentity(testAgent.id);

    // 2. Generate manifest
    const manifest = await c2paService.generateIdentityManifest(testAgent);
    
    // 3. Export to JSON
    const exportedJson = c2paService.exportManifest(manifest);
    const parsed = JSON.parse(exportedJson);

    expect(parsed["@context"]).toBe("https://c2pa.org/schemas/v1");
    expect(parsed.assertions[0].label).toBe("com.fingerprint.identity.v1");
    expect(parsed.signature).toBeDefined();
  });

  it('should generate and verify a Verification Certificate', async () => {
    const mockResult: VerificationResult = {
      match: true,
      similarity: 0.99,
      confidence: 0.98,
      mode: 'enforcement',
      perturbation: {
        perturbationScore: 0.01,
        hasHomographs: false,
        hasInvisibleChars: false,
        hasEncodingArtifacts: false,
        suspicious: false,
        flags: [],
        editDistance: 1
      },
      decision: { reason: 'Perfect match', threshold: 0.95 },
      traitVersion: 'v1.0'
    };

    await c2paService.initializeIdentity(testAgent.id);
    const manifest = await c2paService.generateVerificationManifest(testAgent.id, mockResult);
    
    // Self-verification
    const isValid = await c2paService.verifyExternalManifest(manifest);
    expect(isValid).toBe(true);

    const exported = c2paService.exportManifest(manifest);
    expect(exported).toContain('com.fingerprint.verification.v1');
    expect(exported).toContain('similarity_score": 0.99');
  });
});
