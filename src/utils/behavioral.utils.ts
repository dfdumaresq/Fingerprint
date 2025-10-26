/**
 * Behavioral Verification Utilities
 *
 * This module provides utilities for generating and verifying behavioral trait hashes.
 */

import { ethers } from 'ethers';
import { TestSuite, TestPrompt } from '../tests/behavioralTestSuite';

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
    responses: string[];  // Just the response text, in order
}

/**
 * Result of behavioral hash generation
 */
export interface BehavioralHashResult {
    hash: string;
    traitVersion: string;
    responseSet: ResponseSet;
    normalizedSet: NormalizedResponseSet;
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
export function normalizeResponses(responseSet: ResponseSet): NormalizedResponseSet {
    const normalizedResponses = responseSet.responses.map(r => {
        // Normalize whitespace
        let normalized = r.response.trim();

        // Replace multiple spaces with single space
        normalized = normalized.replace(/\s+/g, ' ');

        // Replace multiple newlines with single newline
        normalized = normalized.replace(/\n+/g, '\n');

        return normalized;
    });

    return {
        testSuiteVersion: responseSet.testSuiteVersion,
        responses: normalizedResponses
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
export function generateBehavioralHash(normalizedSet: NormalizedResponseSet): string {
    // Concatenate all responses with pipe separator
    const concatenated = normalizedSet.responses.join('|');

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
 *
 * @param responseSet - Raw responses from AI agent
 * @returns Behavioral hash result with all intermediate data
 */
export function generateBehavioralTraitHash(responseSet: ResponseSet): BehavioralHashResult {
    const normalizedSet = normalizeResponses(responseSet);
    const hash = generateBehavioralHash(normalizedSet);

    return {
        hash,
        traitVersion: responseSet.testSuiteVersion,
        responseSet,
        normalizedSet
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

    const promptResponses: PromptResponse[] = testSuite.prompts.map((prompt, index) => ({
        promptId: prompt.id,
        prompt: prompt.prompt,
        response: responses[index],
        timestamp: Date.now()
    }));

    return {
        testSuiteVersion: testSuite.version,
        responses: promptResponses,
        generatedAt: Date.now()
    };
}

/**
 * Verify if two behavioral hashes match
 *
 * @param hash1 - First hash to compare
 * @param hash2 - Second hash to compare
 * @returns True if hashes match
 */
export function verifyBehavioralMatch(hash1: string, hash2: string): boolean {
    return hash1.toLowerCase() === hash2.toLowerCase();
}

/**
 * Calculate behavioral drift percentage
 *
 * Simple metric: if hashes match = 0% drift, if different = 100% drift
 * Future: Could use more sophisticated similarity metrics
 *
 * @param originalHash - Original registered hash
 * @param currentHash - Current hash from re-testing
 * @returns Drift percentage (0-100)
 */
export function calculateBehavioralDrift(originalHash: string, currentHash: string): number {
    return verifyBehavioralMatch(originalHash, currentHash) ? 0 : 100;
}

/**
 * Validate behavioral hash format
 *
 * @param hash - Hash string to validate
 * @returns True if hash is valid keccak256 format
 */
export function isValidBehavioralHash(hash: string): boolean {
    // Must start with 0x and be 66 characters (0x + 64 hex chars)
    if (!hash.startsWith('0x') || hash.length !== 66) {
        return false;
    }

    // Must contain only hex characters
    const hexPattern = /^0x[0-9a-fA-F]{64}$/;
    return hexPattern.test(hash);
}