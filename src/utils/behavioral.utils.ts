/**
 * Behavioral Verification Utilities
 *
 * This module provides utilities for generating and verifying behavioral trait hashes.
 */

import { ethers } from 'ethers';
import { TestSuite, TestPrompt } from '../tests/behavioralTestSuite';
import {
  canonicalize,
  areSimilarAfterCanonicalization,
  levenshteinDistance,
  normalizedEditDistance,
} from "./canonicalization.utils";
import {
  analyzePerturbation,
  PerturbationAnalysis,
} from "../detection/perturbation.detector";

/**
 * Response to a single test prompt
 */
export interface PromptResponse {
  promptId: string;
  prompt: string;
  response: string;
  timestamp: number;
}

/**
 * Collection of responses to all prompts in a test suite
 */
export interface ResponseSet {
  testSuiteVersion: string;
  responses: PromptResponse[];
  generatedAt: number;
}

/**
 * Normalized response set (cleaned for hashing)
 */
export interface NormalizedResponseSet {
  testSuiteVersion: string;
  responses: string[]; // Just the response text, in order
}

/**
 * Result of behavioral hash generation
 */
export interface BehavioralHashResult {
  hash: string;
  traitVersion: string;
  responseSet: ResponseSet;
  normalizedSet: NormalizedResponseSet;
  isCanonical?: boolean;
}

/**
 * Detailed verification result with similarity and perturbation analysis
 */
export interface VerificationResult {
  match: boolean; // Overall verdict
  similarity: number; // 0-1 similarity score
  confidence: number; // Confidence score
  mode: "enforcement" | "triage";
  perturbation: PerturbationAnalysis;
  decision: {
    reason: string;
    threshold: number;
  };
  traitVersion: string;
}

/**
 * Normalize responses for consistent hashing
 *
 * Removes non-deterministic elements:
 * - Timestamps
 * - Excessive whitespace
 * - Trailing/leading spaces
 *
 * @param responseSet - Raw responses from AI agent
 * @returns Normalized response set ready for hashing
 */
export function normalizeResponses(
  responseSet: ResponseSet
): NormalizedResponseSet {
  const normalizedResponses = responseSet.responses.map((r) => {
    // Normalize whitespace
    let normalized = r.response.trim();

    // Replace multiple spaces with single space
    normalized = normalized.replace(/\s+/g, " ");

    // Replace multiple newlines with single newline
    normalized = normalized.replace(/\n+/g, "\n");

    return normalized;
  });

  return {
    testSuiteVersion: responseSet.testSuiteVersion,
    responses: normalizedResponses,
  };
}

/**
 * Generate behavioral trait hash from normalized responses
 *
 * Creates a keccak256 hash of the concatenated normalized responses.
 * Format: response1|response2|response3|...
 *
 * @param normalizedSet - Normalized response set
 * @returns Hash string (0x... format, 66 characters)
 */
export function generateBehavioralHash(
  normalizedSet: NormalizedResponseSet
): string {
  // Concatenate all responses with pipe separator
  const concatenated = normalizedSet.responses.join("|");

  // Convert to UTF-8 bytes
  const dataBytes = ethers.toUtf8Bytes(concatenated);

  // Generate keccak256 hash
  const hash = ethers.keccak256(dataBytes);

  return hash;
}

/**
 * Generate behavioral trait hash from raw response set
 *
 * Convenience function that normalizes and hashes in one step.
 * Supports an optional 'useCanonical' flag for safety-grade hashing.
 *
 * @param responseSet - Raw responses from AI agent
 * @param useCanonical - Whether to use safety-grade canonicalization
 * @returns Behavioral hash result with all intermediate data
 */
export function generateBehavioralTraitHash(
  responseSet: ResponseSet,
  useCanonical: boolean = false
): BehavioralHashResult {
  let normalizedSet: NormalizedResponseSet;

  if (useCanonical) {
    // Use safety-grade canonicalization for each response
    const canonicalResponses = responseSet.responses.map(
      (r) => canonicalize(r.response).canonical
    );
    normalizedSet = {
      testSuiteVersion: responseSet.testSuiteVersion,
      responses: canonicalResponses,
    };
  } else {
    // Use legacy normalization
    normalizedSet = normalizeResponses(responseSet);
  }

  const hash = generateBehavioralHash(normalizedSet);

  return {
    hash,
    traitVersion: responseSet.testSuiteVersion,
    responseSet,
    normalizedSet,
    isCanonical: useCanonical,
  };
}

/**
 * Create a manual response set (for testing or manual entry)
 *
 * @param testSuite - The test suite being used
 * @param responses - Array of response strings (must match prompt order)
 * @returns ResponseSet ready for hashing
 */
export function createManualResponseSet(
  testSuite: TestSuite,
  responses: string[]
): ResponseSet {
  if (responses.length !== testSuite.prompts.length) {
    throw new Error(
      `Response count mismatch: expected ${testSuite.prompts.length}, got ${responses.length}`
    );
  }

  const promptResponses: PromptResponse[] = testSuite.prompts.map(
    (prompt, index) => ({
      promptId: prompt.id,
      prompt: prompt.prompt,
      response: responses[index],
      timestamp: Date.now(),
    })
  );

  return {
    testSuiteVersion: testSuite.version,
    responses: promptResponses,
    generatedAt: Date.now(),
  };
}

/**
 * Thresholds for different verification modes
 */
export const VERIFICATION_THRESHOLDS = {
  enforcement: {
    minSimilarity: 0.95,
    maxPerturbation: 0.2,
  },
  triage: {
    minSimilarity: 0.4, // Extensive paraphrasing drops Jaccard similarity all the way to 41%
    maxPerturbation: 0.5,
  },
};

/**
 * Calculate Jaccard Similarity (Bag of Words) for text
 *
 * @param a - First string
 * @param b - Second string
 * @returns Similarity score between 0 and 1
 */
function calculateJaccardSimilarity(a: string, b: string): number {
  // Strip punctuation from words to ensure robust matching
  const tokenize = (text: string) =>
    text
      .split(/\s+/)
      .map((w) => w.replace(/[.,!?()\[\]{}":;']/g, ""))
      .filter((w) => w.length > 0);

  const setA = new Set(tokenize(a));
  const setB = new Set(tokenize(b));

  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;

  const intersection = new Set(Array.from(setA).filter((x) => setB.has(x)));
  const union = new Set([...Array.from(setA), ...Array.from(setB)]);

  return intersection.size / union.size;
}

/**
 * Verify if two behavioral signatures match using similarity thresholds
 *
 * This is the "safety-grade" verification function.
 *
 * @param registeredResponses - The original ResponseSet registered
 * @param currentResponses - The ResponseSet currently being verified
 * @param mode - 'enforcement' (strict) or 'triage' (loose)
 * @returns Comprehensive VerificationResult
 */
export function verifyBehavioralSignature(
  registeredResponses: ResponseSet,
  currentResponses: ResponseSet,
  mode: "enforcement" | "triage" = "enforcement"
): VerificationResult {
  const thresholds = VERIFICATION_THRESHOLDS[mode];

  // 1. Canonicalize both sets of responses
  const regCanon = registeredResponses.responses
    .map((r) => canonicalize(r.response).canonical)
    .join(" ");
  const curCanon = currentResponses.responses
    .map((r) => canonicalize(r.response).canonical)
    .join(" ");

  // 2. Calculate Token-based Jaccard Similarity
  const similarity = calculateJaccardSimilarity(regCanon, curCanon);

  // 3. Analyze perturbations in current response set (concatenated)
  // We use the raw text for perturbation analysis to catch hidden characters/homographs
  const curRaw = currentResponses.responses.map((r) => r.response).join("|");
  const perturbation = analyzePerturbation(curRaw, curCanon, {
    maxEditDistance: thresholds.maxPerturbation > 0.3 ? 0.5 : 0.3,
    suspiciousThreshold: thresholds.maxPerturbation,
  });

  // 4. Decision logic
  const similarityPass = similarity >= thresholds.minSimilarity;
  const perturbationPass =
    perturbation.perturbationScore <= thresholds.maxPerturbation &&
    !perturbation.suspicious;

  const match = similarityPass && perturbationPass;
  let reason = "Verification successful";

  if (!similarityPass) {
    reason = `Similarity ${similarity.toFixed(2)} below threshold ${
      thresholds.minSimilarity
    }`;
    if (!perturbationPass || perturbation.suspicious) {
      reason += " (suspicious patterns also detected)";
    }
  } else if (!perturbationPass) {
    reason = `Perturbation score ${perturbation.perturbationScore.toFixed(
      2,
    )} above threshold ${thresholds.maxPerturbation}`;
  } else if (perturbation.suspicious) {
    reason = "Verification passed but suspicious patterns detected";
  }

  // Confidence calculation (heuristic)
  let confidence =
    similarity * 0.7 + (1 - perturbation.perturbationScore) * 0.3;
  if (perturbation.suspicious) confidence = 0; // Absolute zero confidence if spoofing detected

  return {
    match,
    similarity,
    confidence,
    mode,
    perturbation,
    decision: {
      reason,
      threshold: thresholds.minSimilarity,
    },
    traitVersion: registeredResponses.testSuiteVersion,
  };
}

/**
 * Verify if two behavioral hashes match (Legacy/Blockchain Wrapper)
 *
 * @param hash1 - First hash to compare
 * @param hash2 - Second hash to compare
 * @returns True if hashes match exactly
 */
export function verifyBehavioralMatch(hash1: string, hash2: string): boolean {
  return hash1.toLowerCase() === hash2.toLowerCase();
}

/**
 * Calculate behavioral drift percentage
 *
 * Updated: 0% drift means identical, 100% means completely different.
 * Now uses similarity for a continuous metric.
 *
 * @param originalResponses - Original ResponseSet or hash (if hash, returns binary)
 * @param currentResponses - Current ResponseSet or hash
 * @returns Drift percentage (0-100)
 */
export function calculateBehavioralDrift(
  original: ResponseSet | string,
  current: ResponseSet | string
): number {
  if (typeof original === "string" || typeof current === "string") {
    const hash1 =
      typeof original === "string"
        ? original
        : generateBehavioralTraitHash(original).hash;
    const hash2 =
      typeof current === "string"
        ? current
        : generateBehavioralTraitHash(current).hash;
    return verifyBehavioralMatch(hash1, hash2) ? 0 : 100;
  }

  const result = verifyBehavioralSignature(original, current, "triage");
  return (1 - result.similarity) * 100;
}

/**
 * Validate behavioral hash format
 *
 * @param hash - Hash string to validate
 * @returns True if hash is valid keccak256 format
 */
export function isValidBehavioralHash(hash: string): boolean {
  // Must start with 0x and be 66 characters (0x + 64 hex chars)
  if (!hash.startsWith("0x") || hash.length !== 66) {
    return false;
  }

  // Must contain only hex characters
  const hexPattern = /^0x[0-9a-fA-F]{64}$/;
  return hexPattern.test(hash);
}
