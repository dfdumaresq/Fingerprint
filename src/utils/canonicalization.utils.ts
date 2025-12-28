/**
 * Canonicalization Utilities
 * 
 * Normalizes text inputs before hashing to resist formatting-based evasion attacks.
 * Part of the safety-grade robustness layer.
 */

/**
 * Result of canonicalization process
 */
export interface CanonicalizationResult {
  /** Original input text */
  original: string;
  /** Normalized/canonical form */
  canonical: string;
  /** List of transformations applied */
  transformations: string[];
  /** Levenshtein edit distance from original to canonical */
  editDistance: number;
}

/**
 * Canonicalization options
 */
export interface CanonicalizationOptions {
  /** Apply Unicode NFC normalization (default: true) */
  unicodeNormalize?: boolean;
  /** Convert to lowercase (default: true) */
  lowercase?: boolean;
  /** Collapse multiple whitespace to single space (default: true) */
  collapseWhitespace?: boolean;
  /** Remove excess punctuation (default: true) */
  normalizePunctuation?: boolean;
  /** Standardize quotes and dashes (default: true) */
  standardizeCharacters?: boolean;
  /** Trim leading/trailing whitespace (default: true) */
  trim?: boolean;
}

const DEFAULT_OPTIONS: Required<CanonicalizationOptions> = {
  unicodeNormalize: true,
  lowercase: true,
  collapseWhitespace: true,
  normalizePunctuation: true,
  standardizeCharacters: true,
  trim: true
};

/**
 * Calculate Levenshtein edit distance between two strings
 * 
 * @param a - First string
 * @param b - Second string
 * @returns Edit distance (number of insertions, deletions, substitutions)
 */
export function levenshteinDistance(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  const matrix: number[][] = [];

  // Initialize first column
  for (let i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }

  // Initialize first row
  for (let j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  // Fill in the rest of the matrix
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1,     // insertion
          matrix[i - 1][j] + 1      // deletion
        );
      }
    }
  }

  return matrix[b.length][a.length];
}

/**
 * Normalize Unicode to NFC form
 */
function normalizeUnicode(text: string): string {
  return text.normalize('NFC');
}

/**
 * Standardize various quote and dash characters to ASCII equivalents
 */
function standardizeCharacters(text: string): string {
  return text
    // Quotes
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")  // Single quotes
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')  // Double quotes
    .replace(/[\u00AB\u00BB]/g, '"')              // Guillemets
    // Dashes
    .replace(/[\u2012\u2013\u2014\u2015]/g, '-')  // Various dashes
    .replace(/\u2026/g, '...')                     // Ellipsis
    // Spaces
    .replace(/[\u00A0\u2000-\u200B\u202F\u205F\u3000]/g, ' '); // Non-breaking and special spaces
}

/**
 * Normalize punctuation by removing excessive repetition
 */
function normalizePunctuation(text: string): string {
  return text
    .replace(/\.{2,}/g, '...')     // Multiple periods → ellipsis
    .replace(/!{2,}/g, '!')        // Multiple exclamation → single
    .replace(/\?{2,}/g, '?')       // Multiple question → single
    .replace(/,{2,}/g, ',')        // Multiple commas → single
    .replace(/-{2,}/g, '-');       // Multiple dashes → single
}

/**
 * Collapse all whitespace (spaces, tabs, newlines) to single spaces
 */
function collapseWhitespace(text: string): string {
  return text
    .replace(/\s+/g, ' ')          // Multiple whitespace → single space
    .replace(/\n+/g, '\n');        // Multiple newlines → single newline
}

/**
 * Canonicalize a text string by applying normalization steps
 * 
 * @param input - Raw input text
 * @param options - Canonicalization options
 * @returns Canonicalization result with canonical form and metadata
 */
export function canonicalize(
  input: string,
  options: CanonicalizationOptions = {}
): CanonicalizationResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const transformations: string[] = [];
  
  let result = input;

  // Step 1: Unicode normalization
  if (opts.unicodeNormalize) {
    const before = result;
    result = normalizeUnicode(result);
    if (result !== before) {
      transformations.push('unicode_nfc');
    }
  }

  // Step 2: Standardize characters (quotes, dashes, special spaces)
  if (opts.standardizeCharacters) {
    const before = result;
    result = standardizeCharacters(result);
    if (result !== before) {
      transformations.push('standardize_chars');
    }
  }

  // Step 3: Normalize punctuation
  if (opts.normalizePunctuation) {
    const before = result;
    result = normalizePunctuation(result);
    if (result !== before) {
      transformations.push('normalize_punctuation');
    }
  }

  // Step 4: Collapse whitespace
  if (opts.collapseWhitespace) {
    const before = result;
    result = collapseWhitespace(result);
    if (result !== before) {
      transformations.push('collapse_whitespace');
    }
  }

  // Step 5: Lowercase
  if (opts.lowercase) {
    const before = result;
    result = result.toLowerCase();
    if (result !== before) {
      transformations.push('lowercase');
    }
  }

  // Step 6: Trim
  if (opts.trim) {
    const before = result;
    result = result.trim();
    if (result !== before) {
      transformations.push('trim');
    }
  }

  // Calculate edit distance
  const editDistance = levenshteinDistance(input, result);

  return {
    original: input,
    canonical: result,
    transformations,
    editDistance
  };
}

/**
 * Canonicalize an array of responses
 * 
 * @param responses - Array of response strings
 * @param options - Canonicalization options
 * @returns Array of canonicalization results
 */
export function canonicalizeResponses(
  responses: string[],
  options: CanonicalizationOptions = {}
): CanonicalizationResult[] {
  return responses.map(response => canonicalize(response, options));
}

/**
 * Calculate normalized edit distance (0-1 scale)
 * 
 * @param a - First string
 * @param b - Second string
 * @returns Normalized distance where 0 = identical, 1 = completely different
 */
export function normalizedEditDistance(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 0;
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
export function areSimilarAfterCanonicalization(
  a: string,
  b: string,
  threshold: number = 0.1
): boolean {
  const canonicalA = canonicalize(a).canonical;
  const canonicalB = canonicalize(b).canonical;
  
  return normalizedEditDistance(canonicalA, canonicalB) <= threshold;
}
