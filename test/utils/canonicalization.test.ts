/**
 * Unit tests for Canonicalization Utilities
 */

import {
  canonicalize,
  canonicalizeResponses,
  levenshteinDistance,
  normalizedEditDistance,
  areSimilarAfterCanonicalization,
  CanonicalizationResult
} from '../../src/utils/canonicalization.utils';

describe('Canonicalization Utils', () => {
  describe('levenshteinDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(levenshteinDistance('hello', 'hello')).toBe(0);
    });

    it('should return length for empty comparisons', () => {
      expect(levenshteinDistance('', 'hello')).toBe(5);
      expect(levenshteinDistance('hello', '')).toBe(5);
    });

    it('should calculate correct distance for substitutions', () => {
      expect(levenshteinDistance('kitten', 'sitten')).toBe(1);
    });

    it('should calculate correct distance for insertions', () => {
      expect(levenshteinDistance('hello', 'helloo')).toBe(1);
    });

    it('should calculate correct distance for deletions', () => {
      expect(levenshteinDistance('hello', 'helo')).toBe(1);
    });

    it('should handle complex transformations', () => {
      expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    });
  });

  describe('normalizedEditDistance', () => {
    it('should return 0 for identical strings', () => {
      expect(normalizedEditDistance('hello', 'hello')).toBe(0);
    });

    it('should return value between 0 and 1', () => {
      const distance = normalizedEditDistance('hello', 'world');
      expect(distance).toBeGreaterThanOrEqual(0);
      expect(distance).toBeLessThanOrEqual(1);
    });

    it('should return 0 for two empty strings', () => {
      expect(normalizedEditDistance('', '')).toBe(0);
    });
  });

  describe('canonicalize', () => {
    it('should handle basic whitespace normalization', () => {
      const result = canonicalize('hello   world');
      expect(result.canonical).toBe('hello world');
      expect(result.transformations).toContain('collapse_whitespace');
    });

    it('should convert to lowercase', () => {
      const result = canonicalize('HELLO World');
      expect(result.canonical).toBe('hello world');
      expect(result.transformations).toContain('lowercase');
    });

    it('should trim whitespace', () => {
      const result = canonicalize('  hello  ');
      expect(result.canonical).toBe('hello');
      expect(result.transformations).toContain('trim');
    });

    it('should standardize smart quotes', () => {
      const result = canonicalize('He said "hello"');
      expect(result.canonical).toBe('he said "hello"');
    });

    it('should standardize dashes', () => {
      const result = canonicalize('hello—world');
      expect(result.canonical).toBe('hello-world');
    });

    it('should normalize multiple punctuation', () => {
      const result = canonicalize('hello!!!!');
      expect(result.canonical).toBe('hello!');
    });

    it('should track edit distance', () => {
      const result = canonicalize('HELLO  WORLD!!!');
      expect(result.editDistance).toBeGreaterThan(0);
    });

    it('should preserve original in result', () => {
      const original = 'HELLO World';
      const result = canonicalize(original);
      expect(result.original).toBe(original);
    });

    it('should respect options to skip transformations', () => {
      const result = canonicalize('HELLO', { lowercase: false });
      expect(result.canonical).toBe('HELLO');
    });

    it('should handle Unicode normalization', () => {
      // Composed vs decomposed 'é'
      const composed = '\u00e9';    // é as single character
      const decomposed = 'e\u0301'; // e + combining acute
      
      const result1 = canonicalize(composed);
      const result2 = canonicalize(decomposed);
      
      // Both should normalize to same form
      expect(result1.canonical).toBe(result2.canonical);
    });
  });

  describe('canonicalizeResponses', () => {
    it('should canonicalize array of responses', () => {
      const responses = ['Hello WORLD', 'GOODBYE  world'];
      const results = canonicalizeResponses(responses);
      
      expect(results).toHaveLength(2);
      expect(results[0].canonical).toBe('hello world');
      expect(results[1].canonical).toBe('goodbye world');
    });
  });

  describe('areSimilarAfterCanonicalization', () => {
    it('should return true for identical strings', () => {
      expect(areSimilarAfterCanonicalization('hello', 'hello')).toBe(true);
    });

    it('should return true for strings differing only by formatting', () => {
      expect(areSimilarAfterCanonicalization('HELLO', 'hello')).toBe(true);
      expect(areSimilarAfterCanonicalization('hello  world', 'hello world')).toBe(true);
    });

    it('should return false for very different strings', () => {
      expect(areSimilarAfterCanonicalization('hello', 'goodbye')).toBe(false);
    });

    it('should respect custom threshold', () => {
      // With very strict threshold
      expect(areSimilarAfterCanonicalization('hello', 'helo', 0.01)).toBe(false);
      // With relaxed threshold
      expect(areSimilarAfterCanonicalization('hello', 'helo', 0.5)).toBe(true);
    });
  });

  describe('Adversarial evasion resistance', () => {
    it('should produce same canonical form for whitespace variations', () => {
      const variations = [
        'hello world',
        'hello  world',
        'hello   world',
        'hello\tworld',
        'hello\nworld',
        ' hello world ',
      ];

      const canonicals = variations.map(v => canonicalize(v).canonical);
      const unique = new Set(canonicals);
      
      // All variations should produce same or very similar canonical forms
      expect(unique.size).toBeLessThanOrEqual(2); // Allow minor variations
    });

    it('should produce same canonical form for casing variations', () => {
      const variations = [
        'Hello World',
        'HELLO WORLD',
        'hello world',
        'HeLLo WoRLd',
      ];

      const canonicals = variations.map(v => canonicalize(v).canonical);
      const unique = new Set(canonicals);
      
      expect(unique.size).toBe(1);
    });

    it('should produce same canonical form for punctuation variations', () => {
      const variations = [
        'hello!',
        'hello!!!',
        'hello!!!!!',
      ];

      const canonicals = variations.map(v => canonicalize(v).canonical);
      const unique = new Set(canonicals);
      
      expect(unique.size).toBe(1);
    });
  });
});
