"use strict";
/**
 * Behavioral Verification Utilities
 *
 * This module provides utilities for generating and verifying behavioral trait hashes.
 */
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.VERIFICATION_THRESHOLDS = void 0;
exports.normalizeResponses = normalizeResponses;
exports.generateBehavioralHash = generateBehavioralHash;
exports.generateBehavioralTraitHash = generateBehavioralTraitHash;
exports.createManualResponseSet = createManualResponseSet;
exports.verifyBehavioralSignature = verifyBehavioralSignature;
exports.verifyBehavioralMatch = verifyBehavioralMatch;
exports.calculateBehavioralDrift = calculateBehavioralDrift;
exports.isValidBehavioralHash = isValidBehavioralHash;
var ethers_1 = require("ethers");
var canonicalization_utils_1 = require("./canonicalization.utils");
var perturbation_detector_1 = require("../detection/perturbation.detector");
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
function normalizeResponses(responseSet) {
    var normalizedResponses = responseSet.responses.map(function (r) {
        // Normalize whitespace
        var normalized = r.response.trim();
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
function generateBehavioralHash(normalizedSet) {
    // Concatenate all responses with pipe separator
    var concatenated = normalizedSet.responses.join("|");
    // Convert to UTF-8 bytes
    var dataBytes = ethers_1.ethers.toUtf8Bytes(concatenated);
    // Generate keccak256 hash
    var hash = ethers_1.ethers.keccak256(dataBytes);
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
function generateBehavioralTraitHash(responseSet, useCanonical) {
    if (useCanonical === void 0) { useCanonical = false; }
    var normalizedSet;
    if (useCanonical) {
        // Use safety-grade canonicalization for each response
        var canonicalResponses = responseSet.responses.map(function (r) { return (0, canonicalization_utils_1.canonicalize)(r.response).canonical; });
        normalizedSet = {
            testSuiteVersion: responseSet.testSuiteVersion,
            responses: canonicalResponses,
        };
    }
    else {
        // Use legacy normalization
        normalizedSet = normalizeResponses(responseSet);
    }
    var hash = generateBehavioralHash(normalizedSet);
    return {
        hash: hash,
        traitVersion: responseSet.testSuiteVersion,
        responseSet: responseSet,
        normalizedSet: normalizedSet,
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
function createManualResponseSet(testSuite, responses) {
    if (responses.length !== testSuite.prompts.length) {
        throw new Error("Response count mismatch: expected ".concat(testSuite.prompts.length, ", got ").concat(responses.length));
    }
    var promptResponses = testSuite.prompts.map(function (prompt, index) { return ({
        promptId: prompt.id,
        prompt: prompt.prompt,
        response: responses[index],
        timestamp: Date.now(),
    }); });
    return {
        testSuiteVersion: testSuite.version,
        responses: promptResponses,
        generatedAt: Date.now(),
    };
}
/**
 * Thresholds for different verification modes
 */
exports.VERIFICATION_THRESHOLDS = {
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
function calculateJaccardSimilarity(a, b) {
    // Strip punctuation from words to ensure robust matching
    var tokenize = function (text) {
        return text
            .split(/\s+/)
            .map(function (w) { return w.replace(/[.,!?()\[\]{}":;']/g, ""); })
            .filter(function (w) { return w.length > 0; });
    };
    var setA = new Set(tokenize(a));
    var setB = new Set(tokenize(b));
    if (setA.size === 0 && setB.size === 0)
        return 1;
    if (setA.size === 0 || setB.size === 0)
        return 0;
    var intersection = new Set(Array.from(setA).filter(function (x) { return setB.has(x); }));
    var union = new Set(__spreadArray(__spreadArray([], Array.from(setA), true), Array.from(setB), true));
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
function verifyBehavioralSignature(registeredResponses, currentResponses, mode) {
    if (mode === void 0) { mode = "enforcement"; }
    var thresholds = exports.VERIFICATION_THRESHOLDS[mode];
    // 1. Canonicalize both sets of responses
    var regCanon = registeredResponses.responses
        .map(function (r) { return (0, canonicalization_utils_1.canonicalize)(r.response).canonical; })
        .join(" ");
    var curCanon = currentResponses.responses
        .map(function (r) { return (0, canonicalization_utils_1.canonicalize)(r.response).canonical; })
        .join(" ");
    // 2. Calculate Token-based Jaccard Similarity
    var similarity = calculateJaccardSimilarity(regCanon, curCanon);
    // 3. Analyze perturbations in current response set (concatenated)
    // We use the raw text for perturbation analysis to catch hidden characters/homographs
    var curRaw = currentResponses.responses.map(function (r) { return r.response; }).join("|");
    var perturbation = (0, perturbation_detector_1.analyzePerturbation)(curRaw, curCanon, {
        maxEditDistance: thresholds.maxPerturbation > 0.3 ? 0.5 : 0.3,
        suspiciousThreshold: thresholds.maxPerturbation,
    });
    // 4. Decision logic
    var similarityPass = similarity >= thresholds.minSimilarity;
    var perturbationPass = perturbation.perturbationScore <= thresholds.maxPerturbation &&
        !perturbation.suspicious;
    var match = similarityPass && perturbationPass;
    var reason = "Verification successful";
    if (!similarityPass) {
        reason = "Similarity ".concat(similarity.toFixed(2), " below threshold ").concat(thresholds.minSimilarity);
        if (!perturbationPass || perturbation.suspicious) {
            reason += " (suspicious patterns also detected)";
        }
    }
    else if (!perturbationPass) {
        reason = "Perturbation score ".concat(perturbation.perturbationScore.toFixed(2), " above threshold ").concat(thresholds.maxPerturbation);
    }
    else if (perturbation.suspicious) {
        reason = "Verification passed but suspicious patterns detected";
    }
    // Confidence calculation (heuristic)
    var confidence = similarity * 0.7 + (1 - perturbation.perturbationScore) * 0.3;
    if (perturbation.suspicious)
        confidence = 0; // Absolute zero confidence if spoofing detected
    return {
        match: match,
        similarity: similarity,
        confidence: confidence,
        mode: mode,
        perturbation: perturbation,
        decision: {
            reason: reason,
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
function verifyBehavioralMatch(hash1, hash2) {
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
function calculateBehavioralDrift(original, current) {
    if (typeof original === "string" || typeof current === "string") {
        var hash1 = typeof original === "string"
            ? original
            : generateBehavioralTraitHash(original).hash;
        var hash2 = typeof current === "string"
            ? current
            : generateBehavioralTraitHash(current).hash;
        return verifyBehavioralMatch(hash1, hash2) ? 0 : 100;
    }
    var result = verifyBehavioralSignature(original, current, "triage");
    return (1 - result.similarity) * 100;
}
/**
 * Validate behavioral hash format
 *
 * @param hash - Hash string to validate
 * @returns True if hash is valid keccak256 format
 */
function isValidBehavioralHash(hash) {
    // Must start with 0x and be 66 characters (0x + 64 hex chars)
    if (!hash.startsWith("0x") || hash.length !== 66) {
        return false;
    }
    // Must contain only hex characters
    var hexPattern = /^0x[0-9a-fA-F]{64}$/;
    return hexPattern.test(hash);
}
