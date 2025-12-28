/**
 * Unit tests for Behavioral Similarity Verification
 */

import {
  generateBehavioralTraitHash,
  verifyBehavioralSignature,
  ResponseSet,
  VERIFICATION_THRESHOLDS
} from '../../src/utils/behavioral.utils';
import { TestSuite } from '../../src/tests/behavioralTestSuite';

describe('Behavioral Similarity Verification', () => {
  const mockTestSuite: TestSuite = {
    version: '1.0.0',
    description: 'Mock test suite for similarity testing',
    prompts: [
      { id: 'p1', prompt: 'Tell me about yourself.', category: 'identity', description: 'Agent identity check' },
      { id: 'p2', prompt: 'What is 2+2?', category: 'reasoning', description: 'Basic reasoning check' }
    ]
  };

  const originalResponses: ResponseSet = {
    testSuiteVersion: '1.0.0',
    generatedAt: Date.now(),
    responses: [
      { promptId: 'p1', prompt: 'Tell me about yourself.', response: 'I am an AI assistant created by OpenAI.', timestamp: Date.now() },
      { promptId: 'p2', prompt: 'What is 2+2?', response: 'The answer is 4.', timestamp: Date.now() }
    ]
  };

  describe('generateBehavioralTraitHash with canonicalization', () => {
    it('should produce different hash when canonicalization is enabled', () => {
      const legacy = generateBehavioralTraitHash(originalResponses, false);
      const canonical = generateBehavioralTraitHash(originalResponses, true);
      
      expect(legacy.hash).not.toBe(canonical.hash);
      expect(canonical.isCanonical).toBe(true);
    });

    it('should be robust to formatting when using canonical hashing', () => {
      const formattedResponses: ResponseSet = {
        ...originalResponses,
        responses: [
          { ...originalResponses.responses[0], response: '  I AM AN AI ASSISTANT  CREATED BY OPENAI.  ' }, // Extra spaces and casing
          { ...originalResponses.responses[1], response: 'THE ANSWER IS 4.' } // Casing only
        ]
      };
      
      const hash1 = generateBehavioralTraitHash(originalResponses, true).hash;
      const hash2 = generateBehavioralTraitHash(formattedResponses, true).hash;
      
      expect(hash1).toBe(hash2);
    });
  });

  describe('verifyBehavioralSignature', () => {
    it('should pass for identical response sets', () => {
      const result = verifyBehavioralSignature(originalResponses, originalResponses, 'enforcement');
      
      expect(result.match).toBe(true);
      expect(result.similarity).toBe(1);
      expect(result.confidence).toBeGreaterThan(0.9);
    });

    it('should pass for slight variations in enforcement mode', () => {
      const slightVariation: ResponseSet = {
        ...originalResponses,
        responses: [
          { ...originalResponses.responses[0], response: 'I am an AI assistant created by OpenAI.' }, // Identical
          { ...originalResponses.responses[1], response: 'The answer is 4!' } // Just changed . to !
        ]
      };
      
      const result = verifyBehavioralSignature(originalResponses, slightVariation, 'enforcement');
      
      // Similarity should still be very high (>0.95)
      expect(result.match).toBe(true);
      expect(result.similarity).toBeGreaterThan(0.95);
    });

    it('should fail for moderate variations in enforcement mode but pass in triage', () => {
      const moderateVariation: ResponseSet = {
        ...originalResponses,
        responses: [
          { ...originalResponses.responses[0], response: 'I am an AI assistant made by OpenAI.' }, // 'created' -> 'made' (small change)
          { ...originalResponses.responses[1], response: 'The answer is 4.' }
        ]
      };
      
      const enforcementResult = verifyBehavioralSignature(originalResponses, moderateVariation, 'enforcement');
      const triageResult = verifyBehavioralSignature(originalResponses, moderateVariation, 'triage');
      
      // 'enforcement' (0.95) should fail, 'triage' (0.80) should pass
      expect(enforcementResult.match).toBe(false);
      expect(triageResult.match).toBe(true);
    });

    it('should detect and flag suspicious perturbations', () => {
      const suspiciousVariation: ResponseSet = {
        ...originalResponses,
        responses: [
          { ...originalResponses.responses[0], response: 'I \u0430m \u0430n AI \u0430ssist\u0430nt cr\u0435\u0430t\u0435d by Op\u0435nAI.' }, // Homograph attack
          { ...originalResponses.responses[1], response: 'The answer is 4.' }
        ]
      };
      
      const result = verifyBehavioralSignature(originalResponses, suspiciousVariation, 'triage');
      
      expect(result.perturbation.hasHomographs).toBe(true);
      expect(result.decision.reason).toContain('suspicious');
    });

    it('should fail if similarity is too low', () => {
      const differentModel: ResponseSet = {
        ...originalResponses,
        responses: [
          { ...originalResponses.responses[0], response: 'Hello! How can I help you today?' },
          { ...originalResponses.responses[1], response: 'Sure, 2 plus 2 is 4.' }
        ]
      };
      
      const result = verifyBehavioralSignature(originalResponses, differentModel, 'triage');
      
      expect(result.match).toBe(false);
      expect(result.similarity).toBeLessThan(0.8);
    });
  });
});
