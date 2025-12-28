/**
 * Unit tests for Perturbation Detection
 */

import {
  analyzePerturbation,
  analyzeFromCanonicalization,
  isSuspicious,
  PerturbationAnalysis
} from '../../src/detection/perturbation.detector';
import { canonicalize } from '../../src/utils/canonicalization.utils';

describe('Perturbation Detection', () => {
  describe('analyzePerturbation', () => {
    it('should return low score for clean text', () => {
      const result = analyzePerturbation('hello world', 'hello world');
      
      expect(result.perturbationScore).toBe(0);
      expect(result.suspicious).toBe(false);
      expect(result.flags).toHaveLength(0);
    });

    it('should detect high edit distance', () => {
      const original = 'HELLO WORLD WITH LOTS OF CHANGES';
      const canonical = 'hello world with lots of changes';
      
      const result = analyzePerturbation(original, canonical, {
        maxEditDistance: 0.1,
        suspiciousThreshold: 0.5
      });
      
      expect(result.editDistance).toBeGreaterThan(0.1);
      expect(result.flags.some(f => f.type === 'high_edit_distance')).toBe(true);
    });

    it('should detect homograph characters', () => {
      // Using Cyrillic 'а' (U+0430) instead of Latin 'a'
      const textWithHomograph = 'h\u0430llo world'; // 'hаllo' with Cyrillic а
      const canonical = 'hallo world';
      
      const result = analyzePerturbation(textWithHomograph, canonical);
      
      expect(result.hasHomographs).toBe(true);
      expect(result.flags.some(f => f.type === 'homograph_attack')).toBe(true);
    });

    it('should detect invisible characters', () => {
      // Zero-width space in text
      const textWithInvisible = 'hello\u200Bworld';
      const canonical = 'helloworld';
      
      const result = analyzePerturbation(textWithInvisible, canonical);
      
      expect(result.hasInvisibleChars).toBe(true);
      expect(result.flags.some(f => f.type === 'invisible_characters')).toBe(true);
    });

    it('should detect encoding artifacts', () => {
      // Base64-like sequence - must be at least 20 chars to trigger detection
      const textWithBase64 = 'output: SGVsbG8gV29ybGQhIFRoaXMgaXMgYSBsb25nZXIgdGVzdA==';
      const canonical = 'output: hello world';
      
      const result = analyzePerturbation(textWithBase64, canonical);
      
      expect(result.hasEncodingArtifacts).toBe(true);
      expect(result.flags.some(f => f.type === 'encoding_artifacts')).toBe(true);
    });

    it('should detect URL encoding', () => {
      const textWithUrlEncoding = 'hello%20world%21';
      const canonical = 'hello%20world%21';
      
      const result = analyzePerturbation(textWithUrlEncoding, canonical);
      
      expect(result.hasEncodingArtifacts).toBe(true);
    });

    it('should detect excessive punctuation', () => {
      const textWithPunctuation = '!@#$%^&*()!@#$%';
      const canonical = '!@#$%^&*()!@#$%';
      
      const result = analyzePerturbation(textWithPunctuation, canonical);
      
      expect(result.flags.some(f => f.type === 'excessive_punctuation')).toBe(true);
    });

    it('should detect suspicious repetition', () => {
      const textWithRepetition = 'hellooooooooooooooooooo world';
      const canonical = 'hellooooooooooooooooooo world';
      
      const result = analyzePerturbation(textWithRepetition, canonical);
      
      expect(result.flags.some(f => f.type === 'suspicious_repetition')).toBe(true);
    });

    it('should flag suspicious inputs above threshold', () => {
      // Combine multiple suspicious patterns
      const suspicious = 'h\u0430llo\u200B!!!!!!!!!!!!';
      const canonical = 'hallo!';
      
      const result = analyzePerturbation(suspicious, canonical);
      
      expect(result.suspicious).toBe(true);
      expect(result.perturbationScore).toBeGreaterThan(0.5);
    });
  });

  describe('analyzeFromCanonicalization', () => {
    it('should work with canonicalization result', () => {
      const canonResult = canonicalize('HELLO\u200B WORLD');
      const perturbResult = analyzeFromCanonicalization(canonResult);
      
      expect(perturbResult.hasInvisibleChars).toBe(true);
    });
  });

  describe('isSuspicious', () => {
    it('should return false for normal text', () => {
      expect(isSuspicious('hello world')).toBe(false);
    });

    it('should return true for text with homographs', () => {
      expect(isSuspicious('h\u0430llo')).toBe(true); // Cyrillic а
    });

    it('should return true for text with invisible chars', () => {
      expect(isSuspicious('hello\u200Bworld')).toBe(true);
    });

    it('should return true for text with encoding artifacts', () => {
      expect(isSuspicious('hello%20world')).toBe(true);
    });
  });

  describe('Real-world evasion scenarios', () => {
    it('should detect Cyrillic homograph attack', () => {
      // Attacker replaces Latin 'a', 'e', 'o' with Cyrillic lookalikes
      const attack = 'Th\u0435 qu\u0438ck br\u043Ewn f\u043Ex'; // e, и, о, о
      const canonical = canonicalize(attack).canonical;
      const result = analyzePerturbation(attack, canonical);
      
      expect(result.hasHomographs).toBe(true);
      // Homographs alone contribute 0.25 score, below default 0.5 threshold
      expect(result.perturbationScore).toBeGreaterThan(0);
    });

    it('should detect zero-width character injection', () => {
      // Attacker injects zero-width spaces to break word matching
      const attack = 'hello\u200Bworld\u200Btest\u200Btext';
      const canonical = canonicalize(attack).canonical;
      const result = analyzePerturbation(attack, canonical);
      
      expect(result.hasInvisibleChars).toBe(true);
    });

    it('should handle mixed attack vectors', () => {
      // Combination of homographs + invisible chars + extra punctuation
      const attack = 'H\u0435ll\u043E\u200B!!!!! W\u043Erld';
      const canonical = canonicalize(attack).canonical;
      const result = analyzePerturbation(attack, canonical);
      
      expect(result.hasHomographs).toBe(true);
      expect(result.hasInvisibleChars).toBe(true);
      expect(result.perturbationScore).toBeGreaterThan(0);
    });
  });
});
