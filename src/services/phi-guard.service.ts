/**
 * PhiGuard — Three-tier PHI detection and redaction service.
 *
 * Tier 1: Regex battery — deterministic, zero-latency, covers structured PII
 *         (SSN, MRN, phone, email, DOB patterns).
 * Tier 2: Keyword prefix scan — catches labelled PII ("Name: John Smith",
 *         "Patient:", "DOB:") that Tier 1 misses because the value itself
 *         is not a recognisable pattern.
 * Tier 3: Local WASM NER — quantized BERT-NER via @huggingface/transformers,
 *         loaded once at startup. Catches free-form person names that have
 *         no structural cue.
 *
 * Design constraints:
 *  - Redact-and-proceed: PHI detection NEVER blocks ingestion. The masked
 *    string is returned alongside a ScanResult so callers can log and surface
 *    a soft UI warning.
 *  - Zero external network calls: NER model is cached locally by the HF
 *    transformers runtime (~90 MB first download, then disk-cached).
 *  - The AI inference prompt is intentionally excluded from masking because it
 *    is transient (wire-only, never stored or hashed). All ledger-bound fields
 *    MUST be masked before hash computation.
 */

import type { TokenClassificationOutput } from '@huggingface/transformers';

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface PhiMatch {
  /** The original text that was redacted */
  original: string;
  /** Replacement token inserted in its place */
  replacement: string;
  /** Which tier detected this match */
  tier: 'regex' | 'keyword' | 'ner';
  /** Human-readable label for audit logs (e.g. 'SSN', 'PERSON', 'PHONE') */
  label: string;
  /** Character offset in the *original* string (best-effort, NER may omit) */
  start?: number;
  end?: number;
}

export interface ScanResult {
  /** The text with all PHI tokens replaced */
  maskedText: string;
  /** Whether any PHI was detected */
  phiDetected: boolean;
  /** Individual matches, in order of detection */
  matches: PhiMatch[];
  /** Total elapsed time for all three tiers (ms) */
  durationMs: number;
}

// ─── Tier 1: Regex Battery ────────────────────────────────────────────────────

interface RegexRule {
  label: string;
  pattern: RegExp;
  replacement: string;
}

/**
 * Ordered from most-specific to least-specific to prevent partial overlaps.
 * All patterns use the global flag so replaceAll works correctly.
 */
const REGEX_RULES: RegexRule[] = [
  // US Social Security Number: 123-45-6789 / 123 45 6789 / 123456789
  {
    label: 'SSN',
    pattern: /\b\d{3}[-\s]\d{2}[-\s]\d{4}\b|\b\d{9}\b(?=\D|$)/g,
    replacement: '[SSN_REDACTED]',
  },
  // Medical Record Number: "MRN: A00421" / "MRN#4821" / "Medical Record: 12345"
  {
    label: 'MRN',
    pattern: /\b(?:MRN|mrn|Medical\s+Record(?:\s+Number)?)[:\s#]*[A-Z0-9-]{4,12}\b/gi,
    replacement: '[MRN_REDACTED]',
  },
  // Date of Birth: "DOB: 1972-03-14" / "dob 03/14/72" / "Date of Birth: March 14 1972"
  {
    label: 'DOB',
    pattern: /\b(?:DOB|dob|Date\s+of\s+Birth)[:\s]*(?:\d{1,4}[-\/]\d{1,2}[-\/]\d{2,4}|\w+ \d{1,2},?\s*\d{4})\b/gi,
    replacement: '[DOB_REDACTED]',
  },
  // North American phone numbers (many formats)
  {
    label: 'PHONE',
    pattern: /\b(?:\+?1[-.\s]?)?\(?[2-9]\d{2}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  // Email addresses
  {
    label: 'EMAIL',
    pattern: /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
  },
  // Postal/ZIP codes when preceded by a province/state abbreviation context
  // Narrowly scoped to avoid false-positives on vitals like "HR 72"
  {
    label: 'POSTAL',
    pattern: /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b|\b[A-Z]\d[A-Z]\s*\d[A-Z]\d\b/g,
    replacement: '[POSTAL_REDACTED]',
  },
  // IP addresses (can be quasi-identifiers in audit logs)
  {
    label: 'IP_ADDRESS',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    replacement: '[IP_REDACTED]',
  },
];

function applyRegexTier(text: string): { text: string; matches: PhiMatch[] } {
  let result = text;
  const matches: PhiMatch[] = [];

  for (const rule of REGEX_RULES) {
    // Reset lastIndex for global regexes before each pass
    rule.pattern.lastIndex = 0;

    let match: RegExpExecArray | null;
    const replacements: Array<{ start: number; end: number; original: string }> = [];

    while ((match = rule.pattern.exec(result)) !== null) {
      replacements.push({ start: match.index, end: match.index + match[0].length, original: match[0] });
    }

    // Replace in reverse order so indices stay valid
    for (let i = replacements.length - 1; i >= 0; i--) {
      const { start, end, original } = replacements[i];
      result = result.slice(0, start) + rule.replacement + result.slice(end);
      matches.push({
        original,
        replacement: rule.replacement,
        tier: 'regex',
        label: rule.label,
        start,
        end,
      });
    }

    rule.pattern.lastIndex = 0;
  }

  return { text: result, matches };
}

// ─── Tier 2: Keyword Prefix Scan ─────────────────────────────────────────────

/**
 * Matches labelled PII fields where the value itself is not a structured
 * pattern. Captures the label and a short trailing value (up to 40 chars,
 * stopping at commas, newlines, or sentence terminators).
 */
const KEYWORD_RULES: Array<{ label: string; pattern: RegExp; replacement: string }> = [
  {
    label: 'NAMED_PATIENT',
    pattern: /\b(?:patient|pt|name|patient\s+name)[:\s]+([A-Z][a-zA-Z'-]{1,30}(?:\s+[A-Z][a-zA-Z'-]{1,30}){0,3})/gi,
    replacement: '[NAME_REDACTED]',
  },
  {
    label: 'NAMED_CLINICIAN',
    // Only redact if clinician name follows a label — bare "Dr Smith" handled by NER
    pattern: /\b(?:physician|clinician|attending|provider|dr\.?)[:\s]+([A-Z][a-zA-Z'-]{1,30}(?:\s+[A-Z][a-zA-Z'-]{1,30}){0,2})/gi,
    replacement: '[CLINICIAN_REDACTED]',
  },
  {
    label: 'CARE_ADDRESS',
    pattern: /\b(?:address|addr|home\s+address)[:\s]+([^\n,;]{5,60})/gi,
    replacement: '[ADDRESS_REDACTED]',
  },
];

function applyKeywordTier(text: string): { text: string; matches: PhiMatch[] } {
  let result = text;
  const matches: PhiMatch[] = [];

  for (const rule of KEYWORD_RULES) {
    rule.pattern.lastIndex = 0;
    result = result.replace(rule.pattern, (fullMatch, captureGroup) => {
      matches.push({
        original: captureGroup,
        replacement: rule.replacement,
        tier: 'keyword',
        label: rule.label,
      });
      // Replace only the captured value, preserve the label prefix
      return fullMatch.replace(captureGroup, rule.replacement);
    });
    rule.pattern.lastIndex = 0;
  }

  return { text: result, matches };
}

// ─── Tier 3: Local WASM NER ───────────────────────────────────────────────────

type NERPipeline = (text: string, options?: any) => Promise<any>;
let nerPipeline: NERPipeline | null = null;
let nerInitialised = false;
let nerInitError: Error | null = null;

/**
 * Lazily initialises the quantized BERT-NER model on first call.
 * The HuggingFace transformers runtime caches the model to disk after the
 * first download (~90 MB). Subsequent cold starts load from disk in ~1-2s.
 *
 * Model: Xenova/bert-base-NER
 *  - Entities: PER, ORG, LOC, MISC
 *  - We only act on PER (person names)
 */
async function getNerPipeline(): Promise<NERPipeline | null> {
  if (nerInitialised) return nerPipeline;

  if (process.env.DISABLE_NER === 'true') {
    nerInitialised = true;
    nerPipeline = null;
    return null;
  }

  try {
    // Dynamic import keeps this optional — if transformers isn't installed the
    // service degrades gracefully to tiers 1+2 only.
    const { pipeline, env } = await import('@huggingface/transformers');

    // Force local-only execution — no telemetry, no external calls after download
    env.allowLocalModels = true;
    env.allowRemoteModels = true; // Needed for first-time download; set false post-cache if desired

    nerPipeline = await pipeline(
      'token-classification',
      'Xenova/bert-base-NER',
      { aggregation_strategy: 'simple' } as any
    ) as NERPipeline;

    console.log('[PhiGuard] BERT-NER pipeline ready');
  } catch (err) {
    nerInitError = err as Error;
    console.warn('[PhiGuard] BERT-NER pipeline failed to load — NER tier disabled. Regex + keyword tiers remain active.', err);
    nerPipeline = null;
  }

  nerInitialised = true;
  return nerPipeline;
}

async function applyNerTier(text: string): Promise<{ text: string; matches: PhiMatch[] }> {
  const pipe = await getNerPipeline();
  if (!pipe) return { text, matches: [] };

  const matches: PhiMatch[] = [];

  try {
    // Pass aggregation_strategy at execution time so transformers aggregates sub-tokens into words/phrases
    const entities = await pipe(text, { aggregation_strategy: 'simple' } as any) as any[];

    // Filter to PERSON entities only with confidence > 0.85
    const personEntities = entities.filter((e: any) => e.entity_group === 'PER' && e.score > 0.85);

    let result = text;
    for (const entity of personEntities) {
      const original = entity.word;
      if (!original || original.trim().length === 0) continue;

      // Skip tokens that are purely numeric, whitespace-only, punctuation-only,
      // or already contain a redaction placeholder from a prior tier.
      if (
        /^\d+$/.test(original.trim()) ||
        /^[\s\W]+$/.test(original.trim()) ||
        original.includes('_REDACTED')
      ) continue;

      // Find the start/end index of the name in the current text (best-effort)
      const start = result.indexOf(original);
      if (start === -1) continue;
      const end = start + original.length;

      result = result.slice(0, start) + '[NAME_REDACTED]' + result.slice(end);
      matches.push({
        original,
        replacement: '[NAME_REDACTED]',
        tier: 'ner',
        label: 'PERSON',
        start,
        end,
      });
    }

    return { text: result, matches };
  } catch (err) {
    // NER failure must never block ingestion
    console.error('[PhiGuard] NER scan error — skipping tier 3:', err);
    return { text, matches: [] };
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Scan a single string through all three tiers and return the masked version
 * alongside a full audit trail of what was detected and replaced.
 *
 * @param text - Raw input string (chief_complaint, reason_text, gender_identity, etc.)
 * @returns ScanResult — always resolves, never throws.
 */
export async function scanAndMask(text: string): Promise<ScanResult> {
  if (!text || text.trim().length === 0) {
    return { maskedText: text, phiDetected: false, matches: [], durationMs: 0 };
  }

  const t0 = Date.now();
  const allMatches: PhiMatch[] = [];

  // Tier 1 — Regex
  const tier1 = applyRegexTier(text);
  allMatches.push(...tier1.matches);

  // Tier 2 — Keyword prefix
  const tier2 = applyKeywordTier(tier1.text);
  allMatches.push(...tier2.matches);

  // Tier 3 — NER (async, may degrade gracefully)
  const tier3 = await applyNerTier(tier2.text);
  allMatches.push(...tier3.matches);

  return {
    maskedText: tier3.text,
    phiDetected: allMatches.length > 0,
    matches: allMatches,
    durationMs: Date.now() - t0,
  };
}

/**
 * Scan multiple fields at once. Returns a map of field name → ScanResult.
 * Runs scans concurrently (Promise.all) to minimise total latency.
 */
export async function scanFields(
  fields: Record<string, string | undefined>
): Promise<Record<string, ScanResult>> {
  const entries = Object.entries(fields).filter(([, v]) => v != null) as [string, string][];

  const results = await Promise.all(
    entries.map(async ([key, value]) => [key, await scanAndMask(value)] as [string, ScanResult])
  );

  return Object.fromEntries(results);
}

/**
 * Warm up the NER pipeline at server startup so the first clinical encounter
 * doesn't pay the model-loading latency penalty.
 */
export async function warmUpPhiGuard(): Promise<void> {
  await getNerPipeline();
}
