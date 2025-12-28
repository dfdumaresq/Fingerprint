/**
 * Perturbation Detection
 * 
 * Analyzes inputs for signs of evasion attempts (compression artifacts,
 * suspicious encoding, homograph attacks, etc.)
 * Part of the safety-grade robustness layer.
 */

import { CanonicalizationResult, levenshteinDistance, normalizedEditDistance } from '../utils/canonicalization.utils';

/**
 * Types of perturbation patterns detected
 */
export type PerturbationType = 
  | 'high_edit_distance'
  | 'encoding_artifacts'
  | 'homograph_attack'
  | 'invisible_characters'
  | 'excessive_punctuation'
  | 'suspicious_repetition';

/**
 * Individual perturbation flag with details
 */
export interface PerturbationFlag {
  type: PerturbationType;
  severity: 'low' | 'medium' | 'high';
  description: string;
  evidence?: string;
}

/**
 * Complete perturbation analysis result
 */
export interface PerturbationAnalysis {
  /** Normalized edit distance from original to canonical (0-1) */
  editDistance: number;
  /** Whether compression/encoding artifacts were detected */
  hasEncodingArtifacts: boolean;
  /** Whether homograph/lookalike characters were detected */
  hasHomographs: boolean;
  /** Whether invisible/zero-width characters were detected */
  hasInvisibleChars: boolean;
  /** Overall perturbation score (0-1, higher = more suspicious) */
  perturbationScore: number;
  /** Detailed flags for each detected issue */
  flags: PerturbationFlag[];
  /** Whether input should be flagged for review */
  suspicious: boolean;
}

/**
 * Thresholds for perturbation detection
 */
export interface PerturbationThresholds {
  /** Max normalized edit distance before flagging */
  maxEditDistance: number;
  /** Perturbation score threshold for suspicious flag */
  suspiciousThreshold: number;
}

const DEFAULT_THRESHOLDS: PerturbationThresholds = {
  maxEditDistance: 0.3,
  suspiciousThreshold: 0.5
};

// Common homograph character mappings (Cyrillic, Greek, etc. that look like Latin)
const HOMOGRAPH_MAPPINGS: Record<string, string> = {
  '\u0430': 'a', // Cyrillic а
  '\u0435': 'e', // Cyrillic е
  '\u043E': 'o', // Cyrillic о
  '\u0440': 'p', // Cyrillic р
  '\u0441': 'c', // Cyrillic с
  '\u0443': 'y', // Cyrillic у
  '\u0445': 'x', // Cyrillic х
  '\u0391': 'A', // Greek Α
  '\u0392': 'B', // Greek Β
  '\u0395': 'E', // Greek Ε
  '\u0397': 'H', // Greek Η
  '\u0399': 'I', // Greek Ι
  '\u039A': 'K', // Greek Κ
  '\u039C': 'M', // Greek Μ
  '\u039D': 'N', // Greek Ν
  '\u039F': 'O', // Greek Ο
  '\u03A1': 'P', // Greek Ρ
  '\u03A4': 'T', // Greek Τ
  '\u03A7': 'X', // Greek Χ
  '\u03A5': 'Y', // Greek Υ
  '\u0417': 'Z', // Cyrillic З
};

// Invisible/zero-width characters
const INVISIBLE_CHARS = [
  '\u200B', // Zero-width space
  '\u200C', // Zero-width non-joiner
  '\u200D', // Zero-width joiner
  '\u200E', // Left-to-right mark
  '\u200F', // Right-to-left mark
  '\u2060', // Word joiner
  '\u2061', // Function application
  '\u2062', // Invisible times
  '\u2063', // Invisible separator
  '\u2064', // Invisible plus
  '\uFEFF', // Byte order mark
];

// Common encoding artifact patterns (base64 remnants, URL encoding, etc.)
const ENCODING_PATTERNS = [
  /[A-Za-z0-9+/]{20,}={0,2}/, // Base64-like sequences
  /%[0-9A-Fa-f]{2}/,          // URL encoding
  /\\x[0-9A-Fa-f]{2}/,        // Hex escape
  /\\u[0-9A-Fa-f]{4}/,        // Unicode escape
  /&#\d{2,5};/,               // HTML numeric entities
  /&#x[0-9A-Fa-f]{2,4};/,     // HTML hex entities
];

/**
 * Detect homograph characters in text
 */
function detectHomographs(text: string): { found: boolean; chars: string[] } {
  const foundChars: string[] = [];
  
  for (const char of text) {
    if (HOMOGRAPH_MAPPINGS[char]) {
      foundChars.push(char);
    }
  }
  
  return {
    found: foundChars.length > 0,
    chars: Array.from(new Set(foundChars))
  };
}

/**
 * Detect invisible/zero-width characters
 */
function detectInvisibleChars(text: string): { found: boolean; count: number } {
  let count = 0;
  
  for (const char of text) {
    if (INVISIBLE_CHARS.includes(char)) {
      count++;
    }
  }
  
  return {
    found: count > 0,
    count
  };
}

/**
 * Detect encoding artifacts (base64, URL encoding, etc.)
 */
function detectEncodingArtifacts(text: string): { found: boolean; patterns: string[] } {
  const foundPatterns: string[] = [];
  
  for (const pattern of ENCODING_PATTERNS) {
    if (pattern.test(text)) {
      foundPatterns.push(pattern.source);
    }
  }
  
  return {
    found: foundPatterns.length > 0,
    patterns: foundPatterns
  };
}

/**
 * Detect excessive punctuation that might indicate evasion
 */
function detectExcessivePunctuation(text: string): { found: boolean; ratio: number } {
  const punctuationCount = (text.match(/[^\w\s]/g) || []).length;
  const totalChars = text.length;
  const ratio = totalChars > 0 ? punctuationCount / totalChars : 0;
  
  return {
    found: ratio > 0.3, // More than 30% punctuation is suspicious
    ratio
  };
}

/**
 * Detect suspicious repetition patterns
 */
function detectSuspiciousRepetition(text: string): { found: boolean; pattern?: string } {
  // Look for character repetition beyond normal usage
  const repetitionPattern = /(.)\1{10,}/;
  const match = text.match(repetitionPattern);
  
  return {
    found: match !== null,
    pattern: match ? match[0].substring(0, 20) + '...' : undefined
  };
}

/**
 * Analyze text for perturbation patterns
 * 
 * @param original - Original input text
 * @param canonical - Canonical form after normalization
 * @param thresholds - Detection thresholds
 * @returns Perturbation analysis result
 */
export function analyzePerturbation(
  original: string,
  canonical: string,
  thresholds: PerturbationThresholds = DEFAULT_THRESHOLDS
): PerturbationAnalysis {
  const flags: PerturbationFlag[] = [];
  let perturbationScore = 0;

  // 1. Check edit distance
  const editDist = normalizedEditDistance(original, canonical);
  if (editDist > thresholds.maxEditDistance) {
    flags.push({
      type: 'high_edit_distance',
      severity: editDist > 0.5 ? 'high' : 'medium',
      description: `High edit distance during canonicalization: ${(editDist * 100).toFixed(1)}%`
    });
    perturbationScore += editDist * 0.3;
  }

  // 2. Check for homographs
  const homographs = detectHomographs(original);
  if (homographs.found) {
    flags.push({
      type: 'homograph_attack',
      severity: homographs.chars.length > 3 ? 'high' : 'medium',
      description: `Homograph characters detected`,
      evidence: homographs.chars.join(', ')
    });
    perturbationScore += 0.25;
  }

  // 3. Check for invisible characters
  const invisible = detectInvisibleChars(original);
  if (invisible.found) {
    flags.push({
      type: 'invisible_characters',
      severity: invisible.count > 5 ? 'high' : 'low',
      description: `${invisible.count} invisible/zero-width characters detected`
    });
    perturbationScore += 0.2;
  }

  // 4. Check for encoding artifacts
  const encoding = detectEncodingArtifacts(original);
  if (encoding.found) {
    flags.push({
      type: 'encoding_artifacts',
      severity: 'medium',
      description: `Encoding artifacts detected`,
      evidence: encoding.patterns.join(', ')
    });
    perturbationScore += 0.15;
  }

  // 5. Check for excessive punctuation
  const punctuation = detectExcessivePunctuation(original);
  if (punctuation.found) {
    flags.push({
      type: 'excessive_punctuation',
      severity: 'low',
      description: `Excessive punctuation: ${(punctuation.ratio * 100).toFixed(1)}% of text`
    });
    perturbationScore += 0.1;
  }

  // 6. Check for suspicious repetition
  const repetition = detectSuspiciousRepetition(original);
  if (repetition.found) {
    flags.push({
      type: 'suspicious_repetition',
      severity: 'medium',
      description: `Suspicious character repetition detected`,
      evidence: repetition.pattern
    });
    perturbationScore += 0.15;
  }

  // Clamp score to 0-1
  perturbationScore = Math.min(1, perturbationScore);

  return {
    editDistance: editDist,
    hasEncodingArtifacts: encoding.found,
    hasHomographs: homographs.found,
    hasInvisibleChars: invisible.found,
    perturbationScore,
    flags,
    suspicious: perturbationScore >= thresholds.suspiciousThreshold
  };
}

/**
 * Analyze a canonicalization result for perturbations
 * 
 * @param result - Canonicalization result
 * @param thresholds - Detection thresholds
 * @returns Perturbation analysis
 */
export function analyzeFromCanonicalization(
  result: CanonicalizationResult,
  thresholds: PerturbationThresholds = DEFAULT_THRESHOLDS
): PerturbationAnalysis {
  return analyzePerturbation(result.original, result.canonical, thresholds);
}

/**
 * Quick check if text appears suspicious
 * 
 * @param text - Text to check
 * @returns True if text contains suspicious patterns
 */
export function isSuspicious(text: string): boolean {
  const homographs = detectHomographs(text);
  const invisible = detectInvisibleChars(text);
  const encoding = detectEncodingArtifacts(text);
  
  return homographs.found || invisible.found || encoding.found;
}
