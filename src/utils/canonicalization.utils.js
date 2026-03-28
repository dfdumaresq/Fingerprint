"use strict";
/**
 * Canonicalization Utilities
 *
 * Normalizes text inputs before hashing to resist formatting-based evasion attacks.
 * Part of the safety-grade robustness layer.
 */
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.levenshteinDistance = levenshteinDistance;
exports.canonicalize = canonicalize;
exports.canonicalizeResponses = canonicalizeResponses;
exports.normalizedEditDistance = normalizedEditDistance;
exports.areSimilarAfterCanonicalization = areSimilarAfterCanonicalization;
var DEFAULT_OPTIONS = {
    unicodeNormalize: true,
    lowercase: true,
    collapseWhitespace: true,
    normalizePunctuation: true,
    standardizeCharacters: true,
    trim: true,
    standardizeHomographs: true,
};
/**
 * Common homograph character mappings (Cyrillic, Greek, etc. that look like Latin)
 */
var HOMOGRAPH_MAPPINGS = {
    "\u0430": "a", // Cyrillic а
    "\u0435": "e", // Cyrillic е
    "\u043E": "o", // Cyrillic о
    "\u0440": "p", // Cyrillic р
    "\u0441": "c", // Cyrillic с
    "\u0443": "y", // Cyrillic у
    "\u0445": "x", // Cyrillic х
    "\u0391": "A", // Greek Α
    "\u0392": "B", // Greek Β
    "\u0395": "E", // Greek Ε
    "\u0397": "H", // Greek Η
    "\u0399": "I", // Greek Ι
    "\u039A": "K", // Greek Κ
    "\u039C": "M", // Greek Μ
    "\u039D": "N", // Greek Ν
    "\u039F": "O", // Greek Ο
    "\u03A1": "P", // Greek Ρ
    "\u03A4": "T", // Greek Τ
    "\u03A7": "X", // Greek Χ
    "\u03A5": "Y", // Greek Υ
    "\u0417": "Z", // Cyrillic З
};
/**
 * Calculate Levenshtein edit distance between two strings
 *
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance (number of insertions, deletions, substitutions)
 */
function levenshteinDistance(a, b) {
    if (a.length === 0)
        return b.length;
    if (b.length === 0)
        return a.length;
    var matrix = [];
    // Initialize first column
    for (var i = 0; i <= b.length; i++) {
        matrix[i] = [i];
    }
    // Initialize first row
    for (var j = 0; j <= a.length; j++) {
        matrix[0][j] = j;
    }
    // Fill in the rest of the matrix
    for (var i = 1; i <= b.length; i++) {
        for (var j = 1; j <= a.length; j++) {
            if (b.charAt(i - 1) === a.charAt(j - 1)) {
                matrix[i][j] = matrix[i - 1][j - 1];
            }
            else {
                matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, // substitution
                matrix[i][j - 1] + 1, // insertion
                matrix[i - 1][j] + 1 // deletion
                );
            }
        }
    }
    return matrix[b.length][a.length];
}
/**
 * Normalize Unicode to NFC form
 */
function normalizeUnicode(text) {
    return text.normalize("NFC");
}
/**
 * Standardize various quote and dash characters to ASCII equivalents
 */
function standardizeCharacters(text) {
    return (text
        // Quotes
        .replace(/[\u2018\u2019\u201A\u201B]/g, "'") // Single quotes
        .replace(/[\u201C\u201D\u201E\u201F]/g, '"') // Double quotes
        .replace(/[\u00AB\u00BB]/g, '"') // Guillemets
        // Dashes
        .replace(/[\u2012\u2013\u2014\u2015]/g, "-") // Various dashes
        .replace(/\u2026/g, "...") // Ellipsis
        // Spaces
        .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, " ")); // Non-breaking and special spaces
}
/**
 * Standardize homograph characters to Latin equivalents
 */
function standardizeHomographs(text) {
    var result = "";
    for (var _i = 0, text_1 = text; _i < text_1.length; _i++) {
        var char = text_1[_i];
        result += HOMOGRAPH_MAPPINGS[char] || char;
    }
    return result;
}
/**
 * Normalize punctuation by removing excessive repetition
 */
function normalizePunctuation(text) {
    return text
        .replace(/\.{2,}/g, '...') // Multiple periods → ellipsis
        .replace(/!{2,}/g, '!') // Multiple exclamation → single
        .replace(/\?{2,}/g, '?') // Multiple question → single
        .replace(/,{2,}/g, ',') // Multiple commas → single
        .replace(/-{2,}/g, '-'); // Multiple dashes → single
}
/**
 * Collapse all whitespace (spaces, tabs, newlines) to single spaces
 */
function collapseWhitespace(text) {
    return text
        .replace(/\s+/g, ' ') // Multiple whitespace → single space
        .replace(/\n+/g, '\n'); // Multiple newlines → single newline
}
/**
 * Canonicalize a text string by applying normalization steps
 *
 * @param input - Raw input text
 * @param options - Canonicalization options
 * @returns Canonicalization result with canonical form and metadata
 */
function canonicalize(input, options) {
    if (options === void 0) { options = {}; }
    var opts = __assign(__assign({}, DEFAULT_OPTIONS), options);
    var transformations = [];
    var result = input;
    // Step 1: Unicode normalization
    if (opts.unicodeNormalize) {
        var before_1 = result;
        result = normalizeUnicode(result);
        if (result !== before_1) {
            transformations.push("unicode_nfc");
        }
    }
    // Step 2: Standardize characters (quotes, dashes, special spaces)
    if (opts.standardizeCharacters) {
        var before_2 = result;
        result = standardizeCharacters(result);
        if (result !== before_2) {
            transformations.push("standardize_chars");
        }
    }
    // Step 2b: Standardize homographs
    if (opts.standardizeHomographs) {
        var before_3 = result;
        result = standardizeHomographs(result);
        if (result !== before_3) {
            transformations.push("standardize_homographs");
        }
    }
    // Step 3: Normalize punctuation
    if (opts.normalizePunctuation) {
        var before_4 = result;
        result = normalizePunctuation(result);
        if (result !== before_4) {
            transformations.push("normalize_punctuation");
        }
    }
    // Step 4: Collapse whitespace
    if (opts.collapseWhitespace) {
        var before_5 = result;
        result = collapseWhitespace(result);
        if (result !== before_5) {
            transformations.push("collapse_whitespace");
        }
    }
    // Step 5: Lowercase
    if (opts.lowercase) {
        var before_6 = result;
        result = result.toLowerCase();
        if (result !== before_6) {
            transformations.push("lowercase");
        }
    }
    // Step 6: Trim
    if (opts.trim) {
        var before_7 = result;
        result = result.trim();
        if (result !== before_7) {
            transformations.push("trim");
        }
    }
    // Calculate edit distance
    var editDistance = levenshteinDistance(input, result);
    return {
        original: input,
        canonical: result,
        transformations: transformations,
        editDistance: editDistance,
    };
}
/**
 * Canonicalize an array of responses
 *
 * @param responses - Array of response strings
 * @param options - Canonicalization options
 * @returns Array of canonicalization results
 */
function canonicalizeResponses(responses, options) {
    if (options === void 0) { options = {}; }
    return responses.map(function (response) { return canonicalize(response, options); });
}
/**
 * Calculate normalized edit distance (0-1 scale)
 *
 * @param a - First string
 * @param b - Second string
 * @returns Normalized distance where 0 = identical, 1 = completely different
 */
function normalizedEditDistance(a, b) {
    var maxLen = Math.max(a.length, b.length);
    if (maxLen === 0)
        return 0;
    return levenshteinDistance(a, b) / maxLen;
}
/**
 * Check if two strings are semantically similar after canonicalization
 *
 * @param a - First string
 * @param b - Second string
 * @param threshold - Maximum normalized edit distance to consider similar (default: 0.1)
 * @returns True if strings are similar within threshold
 */
function areSimilarAfterCanonicalization(a, b, threshold) {
    if (threshold === void 0) { threshold = 0.1; }
    var canonicalA = canonicalize(a).canonical;
    var canonicalB = canonicalize(b).canonical;
    return normalizedEditDistance(canonicalA, canonicalB) <= threshold;
}
