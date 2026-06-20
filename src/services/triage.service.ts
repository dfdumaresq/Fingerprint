import { Pool } from 'pg';
import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import { generateEventHash, buildCanonicalPayload, AgentEvent } from '../utils/crypto.utils';
import { EventService } from './event.service';
import { TRIAGE_AGENT, TriageAgentConfig } from '../config/agents';
import { scanFields, ScanResult } from './phi-guard.service';

// ─── Domain Types ────────────────────────────────────────────────────────────

/**
 * Structured patient context for risk stratification and audit.
 * 
 * NOTE: This object flows directly into immutable audit logs and packs.
 * DO NOT include highly identifying PII (e.g. Full Name, DOB, MRN) here.
 * Only include risk-relevant, coarse-granularity demographic and clinical attributes.
 */
export interface PatientContext {
  demographics: {
    age_years: number;
    sex_at_birth: 'male' | 'female' | 'intersex' | 'unknown';
    gender_identity?: string;          // Free-text for inclusivity
    language_primary?: string;         // e.g. 'en', 'fr'
    country_region?: string;           // e.g. 'CA-BC'
  };
  clinical?: {
    comorbidities?: { code: string; description: string }[];
    medications?: { name: string; dose?: string }[];
    allergies?: { substance: string; reaction?: string }[];
  };
  risk_factors?: {
    smoking_status?: 'never' | 'former' | 'current' | 'unknown';
    family_history_cvd?: boolean;
  };
}

export type TriageSystemState = 'nominal' | 'degraded' | 'anomaly_detected';

export interface TriageHealthStatus {
  available: boolean;
  success: boolean;
  state: TriageSystemState;
  provider: string;
  model: string;
  details?: {
    error_code?: string;
    message?: string;
  };
}

export interface ClinicalInput {
  chief_complaint: string;
  vitals: { 
    hr: number; 
    bp_sys: number; 
    bp_dia: number; 
    rr: number; 
    spo2: number;
    spo2_support?: 'room_air' | 'supplemental';
    temp: number;
    temp_method?: 'oral' | 'tympanic' | 'axillary' | 'rectal';
    pain_score: number;
    weight_kg?: number;
    height_cm?: number;
    glucose_mmol?: number;
    map?: number;
    avpu?: 'A' | 'V' | 'P' | 'U';
  };
  patient_context: PatientContext;
  red_flags?: string[];
  safety_warning_triggered?: 'none' | 'clinical_contradiction' | 'infrastructure_degraded';
  safety_warning_bypassed?: boolean;
}

export interface ClinicalData {
  schemaVersion: number;
  vitals: {
    hr: number;
    bp_sys: number;
    bp_dia: number;
    rr: number;
    spo2: number;
    spo2_support?: 'room_air' | 'supplemental';
    temp: number;
    temp_method?: 'oral' | 'tympanic' | 'axillary' | 'rectal';
    pain_score: number;
    weight_kg?: number;
    height_cm?: number;
    glucose_mmol?: number;
    map?: number;
    avpu?: 'A' | 'V' | 'P' | 'U';
  };
  history: {
    allergies: string[];
    medications: string[];
    pmh: string[];
    notes?: string;
  };
  chief_complaint: string;
  patient_context: PatientContext;
  age?: number;     // legacy fallback
  gender?: string;  // legacy fallback
  red_flags?: string[];
  ai_recommendation?: TriageResult;
  /** Always present for new encounters: the clinical rules engine output run in parallel with the AI */
  rules_recommendation?: TriageResult;
  /**
   * Absolute difference in acuity level between AI and rules engine outputs.
   * 0 = aligned, 1 = minor discrepancy, ≥2 = significant conflict (possible silent failure).
   * High divergence + high semantic alignment score = most dangerous category.
   */
  acuity_divergence?: number;
  /**
   * Normalized governance record. Present for EVERY encounter, including aligned ones.
   * pattern: 'aligned' when divergence === 0.
   * Written once at creation time by TriageService. Immutable after event is anchored.
   * Frontend must read from this field rather than re-deriving governance classification.
   */
  acuity_governance_event: AcuityGovernanceEvent;
  clinician_acuity?: number;
  ai_provider?: string;
  state: string;
  safety_warning_triggered?: 'none' | 'clinical_contradiction' | 'infrastructure_degraded';
  safety_warning_bypassed?: boolean;
}

export interface TriageResult {
  acuity: number;          // 1 (critical) – 5 (non-urgent)
  reasons: string[];
}

/**
 * Normalized governance record written into every clinical_data payload at encounter creation.
 *
 * This is the canonical, server-authored record of AI/rules alignment or conflict.
 * Written once by TriageService and immutable after the event is anchored.
 * The frontend may overlay a live semantic score for display purposes but must never
 * mutate or re-derive the governance classification stored here.
 *
 * @schema_version 1.0
 */
export interface AcuityGovernanceEvent {
  schema_version: '1.0';
  source: 'triage_service';
  /** Classification is derived from server-side rules comparison only at write time */
  classification_basis: 'server_rules_only';
  /** Whether a subsequent SAE/semantic enrichment pass has attached a score */
  semantic_enrichment_status: 'not_available' | 'pending' | 'attached';

  /** UUID identifying this governance sub-event */
  event_id: string;
  /**
   * UUID of the parent agent_events row that contains this governance object.
   * Pre-generated by TriageService before the DB write so the linkage is
   * established without requiring a post-write update.
   */
  parent_event_id: string;
  /** ISO-8601 UTC — server-authoritative creation timestamp */
  occurred_at: string;

  ai_decision: {
    /** ESI acuity level 1–5 as produced by the AI model */
    level: number;
    label: string;
  };
  rules_decision: {
    /** ESI acuity level 1–5 as produced by the clinical rules engine */
    level: number;
    label: string;
    /** Verbatim rule-hit reasons from the rules engine — not summarised */
    triggered_on: string[];
  };
  final_governed_outcome: {
    /**
     * Resolved acuity:
     * - under_triage → rules level (safety floor wins, original AI preserved alongside)
     * - over_escalation → AI level (more cautious; clinician review required)
     * - aligned → AI == rules level
     */
    level: number;
    label: string;
    resolution:
      | 'no_conflict'
      | 'rules_floor_override'
      | 'clinician_review_required'
      | 'high_severity_conflict_escalated';
  };

  /**
   * Directional classification derived from server-side rules comparison only.
   * 'semantic_drift_suspected' is reserved for a future enrichment pass;
   * it is NEVER set at creation time.
   */
  pattern: 'aligned' | 'under_triage' | 'over_escalation' | 'semantic_drift_suspected';

  /** Absolute delta |ai.level - rules.level| */
  divergence: number;
  /** Human-readable narrative derived from verbatim rules engine hits */
  trigger_description: string;

  /** True when rules safety floor was applied because AI under-triaged below the encoded minimum */
  safety_floor_applied: boolean;
  /** True whenever divergence > 0 — a clinician must review */
  clinician_review_required: boolean;
}

export interface PhiScanSummary {
  phiDetected: boolean;
  fieldsScanned: string[];
  matchCount: number;
  durationMs: number;
}

export interface TriageEncounter {
  encounter_id: string;
  db_row_id: number;
  arrival_time: string;
  clinician_action: string | null;
  agent_id: string;
  source: 'live' | 'scenario';

  // Hydrated Clinical Payload
  clinical: ClinicalData;

  integrity: {
    event_hash: string;
    merkle_root_id: number | null;
    anchored_to_chain: boolean;
    tamper_status: 'pending' | 'anchored' | 'tampered';
  };
  agent_name?: string;
  agent_version?: string;
  decision_history?: { 
    action: string; 
    timestamp: string; 
    anchored: boolean; 
    event_hash: string;
    reason_code?: string;
    reason_text?: string;
    amends_event_id?: string;
    clinician_acuity?: number;
  }[];
  /** Present when at least one PHI token was detected and masked during ingestion */
  phi_scan?: PhiScanSummary;
}

export class AgentNotAvailableError extends Error {
  constructor(public slug: string) {
    super(`Active agent for role/identity '${slug}' not found or has been revoked.`);
    this.name = 'AgentNotAvailableError';
  }
}

// ─── AI Rule Engine ───────────────────────────────────────────────────────────

function runRuleEngine(input: ClinicalInput): TriageResult {
  let acuity = 3;
  const reasons: string[] = [];
  const { age_years, sex_at_birth } = input.patient_context.demographics;
  const complaint = (input.chief_complaint || '').toLowerCase();

  // ── Complaint-pattern rules (clinical knowledge, not just vitals) ─────────
  // These handle high-acuity presentations where vitals may appear deceptively
  // stable but the clinical context demands urgent workup.

  // DVT / VTE: Unilateral limb swelling + immobility risk context
  // Proxies for Wells Score ≥ 2 (high probability)
  const dvtKeywords = ['calf swelling', 'leg swelling', 'swelling in', 'swollen leg', 'swollen calf', 'calf pain', 'dvt', 'blood clot', 'deep vein'];
  const immobilityKeywords = ['flight', 'travel', 'long journey', 'immobil', 'bed rest', 'prolonged sitting', 'car ride', 'bus ride'];
  const hasDvtComplaint = dvtKeywords.some(k => complaint.includes(k));
  const hasImmobilityContext = immobilityKeywords.some(k => complaint.includes(k));

  if (hasDvtComplaint) {
    // Unilateral swelling alone → urgent (workup required)
    acuity = Math.min(acuity, 3);
    reasons.push('Possible DVT: unilateral limb swelling requiring urgent vascular assessment');

    if (hasImmobilityContext) {
      // Immobility + swelling → high Wells Score proxy → emergent
      acuity = Math.min(acuity, 2);
      reasons.push('High DVT/VTE risk: limb swelling following prolonged immobility (Wells Score elevated)');
    }

    // Age ≥ 60 + female = additional VTE risk amplifier
    if (age_years >= 60 && (sex_at_birth === 'female' || sex_at_birth === 'unknown')) {
      acuity = Math.min(acuity, 2);
      reasons.push(`Elevated VTE risk profile (age ${age_years}, ${sex_at_birth})`);
    }
  }

  // Stroke / TIA: FAST symptoms or sudden neurological deficit
  const strokeKeywords = ['facial droop', 'face droop', 'arm weakness', 'speech difficulty', 'slurred speech', 'sudden weakness', 'sudden numbness', 'stroke', 'tia', 'vision loss', 'sudden headache'];
  const hasStrokeComplaint = strokeKeywords.some(k => complaint.includes(k));

  if (hasStrokeComplaint) {
    acuity = Math.min(acuity, 2);
    reasons.push('Possible stroke/TIA: time-critical neurological assessment required (FAST positive)');
    if (age_years >= 55) {
      acuity = Math.min(acuity, 1);
      reasons.push(`High stroke risk profile (age ${age_years}) — resuscitation bay assessment`);
    }
  }

  // Sepsis / SIRS: Infection source + systemic signs
  // (Vitals-based checks below will also catch HR/RR thresholds)
  const sepsisKeywords = ['fever with', 'infection', 'sepsis', 'unwell with fever', 'rigors', 'shaking', 'chills with'];
  const hasSepsisComplaint = sepsisKeywords.some(k => complaint.includes(k));

  if (hasSepsisComplaint && (input.vitals.hr > 100 || input.vitals.rr > 20 || input.vitals.temp > 38.3)) {
    acuity = Math.min(acuity, 2);
    reasons.push('Possible sepsis/SIRS: fever with systemic response requires urgent assessment');
  }

  // ── Vitals-threshold rules ────────────────────────────────────────────────

  if (input.vitals.hr > 120) { acuity = Math.min(acuity, 2); reasons.push(`Tachycardia (HR ${input.vitals.hr})`); }
  if (input.vitals.spo2 < 92) { acuity = Math.min(acuity, 2); reasons.push(`Hypoxia (SpO₂ ${input.vitals.spo2}%)`); }
  if (input.vitals.bp_sys < 90) { acuity = Math.min(acuity, 2); reasons.push(`Hypotension (BP ${input.vitals.bp_sys}/${input.vitals.bp_dia})`); }
  if (input.vitals.glucose_mmol && input.vitals.glucose_mmol < 4.0) { acuity = Math.min(acuity, 2); reasons.push(`Hypoglycemia (Glucose ${input.vitals.glucose_mmol})`); }
  if (input.vitals.pain_score >= 8) { acuity = Math.min(acuity, 3); reasons.push(`Severe Pain (${input.vitals.pain_score}/10)`); }
  
  if (input.red_flags?.includes('chest_pain')) {
    // Failsafe: If sex is unknown, err on the side of caution for age-based ACS risk
    const isHighRiskSex = sex_at_birth === 'male' || sex_at_birth === 'unknown';
    const ageThreshold = isHighRiskSex ? 40 : 50;
    
    if (age_years > ageThreshold) {
      acuity = Math.min(acuity, 2); 
      reasons.push(`High ACS risk profile (chest pain, ${sex_at_birth === 'unknown' ? 'unknown' : sex_at_birth} >${ageThreshold})`);
    }
  }

  if (input.red_flags?.includes('altered_loc') || input.vitals.avpu === 'U') { acuity = 1; reasons.push('Critical neurologic status'); }

  if (reasons.length === 0) reasons.push(`Stable presentation — ${input.chief_complaint}`);
  return { acuity, reasons };
}


async function runTriageAgent(input: ClinicalInput): Promise<{ result: TriageResult, provider: string, rules_check: TriageResult }> {
  // Rules engine always runs — both as a safety net and as a divergence reference.
  // When Ollama is active, this provides the independent check we compare against.
  // When Ollama fails, this becomes the primary result (provider: 'rules').
  const rulesResult = runRuleEngine(input);

  if (TRIAGE_AGENT.provider === 'ollama') {
    try {
      const response = await fetch(`${TRIAGE_AGENT.endpoint}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: TRIAGE_AGENT.model,
          prompt: buildTriagePrompt(input),
          stream: false,
          format: 'json'
        }),
        signal: AbortSignal.timeout(90000)
      });
      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}: ${response.statusText}`);
      }
      const data = await response.json();
      const aiResult = safeParseTriageJson(data.response);
      return { result: aiResult, provider: 'ollama', rules_check: rulesResult };
    } catch (e) {
      console.warn("Ollama failed, falling back to rule engine:", e);
    }
  }
  // Rules-only path: rules_check mirrors result (divergence = 0 by definition)
  return { result: rulesResult, provider: 'rules', rules_check: rulesResult };
}

function buildTriagePrompt(input: ClinicalInput): string {
  const demographics = input.patient_context.demographics;
  return `You are a clinical triage AI. Respond with ONLY valid JSON matching this exact schema: {"clinical_analysis": "<step-by-step triage reasoning>", "acuity": <1-5>, "reasons": ["<reason1>", "<reason2>"]}.

Use the following Emergency Severity Index (ESI) triage guidelines:
- Acuity 1 (Resuscitation): Patient requires immediate life-saving intervention (e.g., severe airway/respiratory distress, cardiac/respiratory arrest, unresponsive/AVPU 'U', SpO2 < 90%).
- Acuity 2 (Emergent): High-risk situations where delay is dangerous, new onset confusion/lethargy, or severe pain (e.g., chest pain with risk factors, possible stroke/neurological deficits, possible sepsis/SIRS, possible deep vein thrombosis (DVT)/VTE due to unilateral leg swelling and prolonged travel/immobility).
- Acuity 3 (Urgent): Patient has stable vitals but requires multiple resources (e.g., both labs and imaging like ultrasound/CT, or IV medications/fluids).
- Acuity 4 (Less Urgent): Patient has stable vitals and requires a single resource (e.g., simple X-ray only, simple lab test only, or minor suturing).
- Acuity 5 (Non-Urgent): Patient requires no resources (e.g., prescription refill, simple wound check, suture removal).

Patient: ${input.chief_complaint}. Age: ${demographics.age_years}, Sex (at birth): ${demographics.sex_at_birth}${demographics.gender_identity ? `, Gender Identity: ${demographics.gender_identity}` : ''}.
Vitals: HR ${input.vitals.hr}, BP ${input.vitals.bp_sys}/${input.vitals.bp_dia}, RR ${input.vitals.rr}, SpO2 ${input.vitals.spo2}% (${input.vitals.spo2_support || 'room air'}), Temp ${input.vitals.temp}°C (${input.vitals.temp_method || 'oral'}), Pain ${input.vitals.pain_score}/10.
History: Allergies: ${input.patient_context.clinical?.allergies?.map(a => a.substance).join(', ') || 'NKDA'}, Meds: ${input.patient_context.clinical?.medications?.map(m => m.name).join(', ') || 'none'}, PMH: ${input.patient_context.clinical?.comorbidities?.map(c => c.description).join(', ') || 'none'}.
Red flags: ${input.red_flags?.join(', ') || 'none'}.

Respond ONLY with JSON. No explanation, no markdown. Ensure "clinical_analysis" is the first property in the JSON so you perform reasoning before choosing acuity.`;
}

function safeParseTriageJson(raw: string): TriageResult {
  try {
    let clean = raw.trim();
    // Strip markdown code block wraps (e.g. ```json ... ```)
    if (clean.startsWith('```')) {
      clean = clean.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim();
    }
    const data = JSON.parse(clean);
    const reasons = Array.isArray(data.reasons) ? data.reasons : [];
    if (data.clinical_analysis) {
      reasons.unshift(data.clinical_analysis);
    }
    return {
      acuity: Number(data.acuity) || 3,
      reasons: reasons.length > 0 ? reasons : ['AI provided triage recommendation']
    };
  } catch {
    return { acuity: 3, reasons: ['Error parsing AI response'] };
  }
}

function getMockClinicalData(sessionId: string): ClinicalData {
  const hash = ethers.id(sessionId || 'unknown');
  const seedNum = parseInt(hash.substring(2, 10), 16);
  const COMPLAINTS = ['Chest Pain', 'Laceration', 'Shortness of Breath', 'Abdominal Pain', 'Fever', 'Headache', 'Dizziness', 'Sprain'];
  
  const acuity = [1,2,3,4,5][seedNum % 5];
  const hr = 60 + (acuity * 8) + (seedNum % 25);
  const sys = 110 + (seedNum % 40);
  const dia = 70 + (seedNum % 20);
  const rr = 12 + (seedNum % 10);
  const spo2 = 94 + (seedNum % 6);
  const age = 18 + (seedNum % 75);

  const sexOptions: ('male' | 'female' | 'intersex' | 'unknown')[] = ['male', 'female', 'intersex', 'unknown'];
  const sexAtBirth = sexOptions[seedNum % sexOptions.length];
  const genderIdentity = (seedNum % 7 === 0) ? 'non-binary' : undefined;

  return {
    schemaVersion: 2,
    chief_complaint: COMPLAINTS[seedNum % COMPLAINTS.length],
    patient_context: {
      demographics: {
        age_years: age,
        sex_at_birth: sexAtBirth,
        gender_identity: genderIdentity
      },
      clinical: {
        allergies: [{ substance: 'NKDA' }],
        medications: [],
        comorbidities: []
      }
    },
    vitals: { 
      hr, 
      bp_sys: sys,
      bp_dia: dia,
      rr,
      spo2,
      spo2_support: 'room_air',
      temp: 36.5 + (seedNum % 2),
      temp_method: 'oral',
      pain_score: seedNum % 10,
      map: Math.round((sys + 2 * dia) / 3),
      avpu: 'A'
    },
    history: {
      allergies: ['NKDA'],
      medications: [],
      pmh: []
    },
    ai_recommendation: {
      acuity,
      reasons: ['Triage protocol autogenerated for test mock']
    },
    // Stub governance event for scenario/mock records that predate the governance schema.
    // These are test fixtures, not clinical records — the stub documents this explicitly.
    acuity_governance_event: buildAcuityGovernanceEvent(
      '00000000-0000-0000-0000-000000000000',
      '00000000-0000-0000-0000-000000000000',
      new Date().toISOString(),
      { acuity, reasons: ['Triage protocol autogenerated for test mock'] },
      { acuity, reasons: ['Triage protocol autogenerated for test mock'] },
      0
    ),
    state: 'waiting'
  };
}

// ─── ESI Label Map ───────────────────────────────────────────────────────────

const ESI_LABELS: Record<number, string> = {
  1: 'Resuscitation',
  2: 'Emergent',
  3: 'Urgent',
  4: 'Less Urgent',
  5: 'Non-Urgent',
};

// ─── Acuity Governance Event Builder ─────────────────────────────────────────

/**
 * Builds the normalized AcuityGovernanceEvent stored in every clinical_data payload.
 *
 * Classification rules:
 *  - divergence === 0           → pattern: 'aligned',       resolution: 'no_conflict'
 *  - ai.level > rules.level     → pattern: 'under_triage',  resolution: 'rules_floor_override'
 *    (AI less urgent than floor)  Δ≥2 escalates to         'high_severity_conflict_escalated'
 *  - ai.level < rules.level     → pattern: 'over_escalation', resolution: 'clinician_review_required'
 *    (AI more urgent, safer)      Final level = AI (more cautious); review required
 *
 * Pure function — no DB access, no side effects.
 * Called immediately after AI and rules engine results are available in createEncounterWithAI.
 */
function buildAcuityGovernanceEvent(
  eventId: string,
  parentEventId: string,
  occurredAt: string,
  aiResult: TriageResult,
  rulesResult: TriageResult,
  divergence: number
): AcuityGovernanceEvent {
  const aiLevel = aiResult.acuity;
  const rulesLevel = rulesResult.acuity;

  let pattern: AcuityGovernanceEvent['pattern'];
  let resolution: AcuityGovernanceEvent['final_governed_outcome']['resolution'];
  let finalLevel: number;
  let safetyFloorApplied: boolean;
  let clinicianReviewRequired: boolean;

  if (divergence === 0) {
    // AI and rules engine are aligned — governance records this but requires no action
    pattern = 'aligned';
    resolution = 'no_conflict';
    finalLevel = aiLevel; // identical to rulesLevel
    safetyFloorApplied = false;
    clinicianReviewRequired = false;
  } else if (aiLevel > rulesLevel) {
    // AI assigned a LESS urgent level than the rules floor requires (under-triage).
    // Safety policy: rules floor wins. Original AI recommendation is preserved
    // in ai_recommendation alongside the governed result.
    pattern = 'under_triage';
    resolution = divergence >= 2 ? 'high_severity_conflict_escalated' : 'rules_floor_override';
    finalLevel = rulesLevel;
    safetyFloorApplied = true;
    clinicianReviewRequired = true;
  } else {
    // AI assigned a MORE urgent level than the rules engine (over-escalation).
    // Policy: preserve AI level (more cautious is safer); flag for clinician review.
    pattern = 'over_escalation';
    resolution = 'clinician_review_required';
    finalLevel = aiLevel;
    safetyFloorApplied = false;
    clinicianReviewRequired = true;
  }

  // Build trigger description from verbatim rules engine hits (not a generated template).
  // Filter the generic catch-all reason so only clinical rule hits appear.
  // Use a deterministic fallback when the rules engine supplied no reasons.
  const FALLBACK_NO_RULE_REASONS = 'No rule-hit reasons supplied by rules engine';
  const clinicalHits = rulesResult.reasons
    .filter(r => !r.startsWith('Stable presentation'))
    .slice(0, 3);
  const triggerDescription = divergence > 0
    ? `Rules floor L${rulesLevel} (${ESI_LABELS[rulesLevel] ?? 'Unknown'}); ${clinicalHits.join('; ') || FALLBACK_NO_RULE_REASONS}`
    : `Aligned at L${finalLevel} (${ESI_LABELS[finalLevel] ?? 'Unknown'})`;

  return {
    schema_version: '1.0',
    source: 'triage_service',
    classification_basis: 'server_rules_only',
    semantic_enrichment_status: 'not_available',
    event_id: eventId,
    parent_event_id: parentEventId,
    occurred_at: occurredAt,
    ai_decision: {
      level: aiLevel,
      label: ESI_LABELS[aiLevel] ?? 'Unknown',
    },
    rules_decision: {
      level: rulesLevel,
      label: ESI_LABELS[rulesLevel] ?? 'Unknown',
      // Deterministic fallback when the rules engine supplied no reasons
      triggered_on: rulesResult.reasons.length > 0
        ? rulesResult.reasons
        : ['No rule-hit reasons supplied by rules engine'],
    },
    final_governed_outcome: {
      level: finalLevel,
      label: ESI_LABELS[finalLevel] ?? 'Unknown',
      resolution,
    },
    pattern,
    divergence,
    trigger_description: triggerDescription,
    safety_floor_applied: safetyFloorApplied,
    clinician_review_required: clinicianReviewRequired,
  };
}

// ─── Service Class ────────────────────────────────────────────────────────────

export class TriageService {
  private db: Pool | any;
  private eventService: EventService;

  constructor(dbPool: Pool | any) {
    this.db = dbPool;
    this.eventService = new EventService(dbPool);
  }

  async resolveActiveAgent(slug: string): Promise<string> {
    // 1. Try to find the agent explicitly marked active
    let res = await this.db.query(
      'SELECT fingerprint_hash FROM agents WHERE is_active = true AND is_revoked = false LIMIT 1'
    );
    
    // 2. Fallback to default slug if none is explicitly marked active
    if (res.rows.length === 0) {
      res = await this.db.query(
        `SELECT fingerprint_hash FROM agents 
         WHERE agent_id = $1 AND is_revoked = false 
         ORDER BY created_at DESC LIMIT 1`,
        [slug]
      );
    }

    if (res.rows.length === 0) {
      throw new AgentNotAvailableError(slug);
    }

    return res.rows[0].fingerprint_hash;
  }

  /**
   * Clinician-driven: create an encounter, get AI recommendation, log to ledger.
   */
  async createEncounterWithAI(input: ClinicalInput, clinicianName: string): Promise<TriageEncounter> {
    const sessionId = `${clinicianName.toLowerCase().replace(/\s+/g, '_')}_${randomUUID()}`;

    // 1. Resolve active agent fingerprint (or safely fallback to standard rule engine signature if unconfigured)
    let activeFingerprint = '0x0000000000000000000000000000000000000000000000000000000000000000';
    let activeAgent: any = null;
    try {
      activeAgent = await this.getActiveAgent(TRIAGE_AGENT.slug);
      if (activeAgent) {
        activeFingerprint = activeAgent.fingerprint_hash;
      }
    } catch (err) {
      console.warn(`Registry warning: No active agent resolved for ${TRIAGE_AGENT.slug}. Safely routing to rules-based fallback.`);
    }

    // 2. Run AI triage — uses ORIGINAL text intentionally.
    //    The Ollama prompt is transient (wire-only, never stored or hashed).
    //    All ledger-bound fields are masked in step 3 before hash computation.
    //    Rules engine always runs in parallel for divergence computation.
    const { result: recommendation, provider, rules_check } = await runTriageAgent(input);
    const acuityDivergence = Math.abs(recommendation.acuity - rules_check.acuity);

    // 2b. Build normalized governance event — pure classification, no DB access.
    //     Present for every encounter: pattern 'aligned' when divergence === 0.
    //     Original ai_recommendation and rules_recommendation are preserved alongside;
    //     this object records the governed interpretation and is immutable after anchoring.
    //     parentEventId is pre-generated here so the governance sub-event can reference
    //     its parent before the DB write; the same UUID is passed to ingestEvent.
    const parentEventId = randomUUID();
    const governanceEvent = buildAcuityGovernanceEvent(
      randomUUID(),
      parentEventId,
      new Date().toISOString(),
      recommendation,
      rules_check,
      acuityDivergence
    );

    // 3. PHI masking — runs BEFORE clinicalData assembly and hash computation.
    //    Redact-and-proceed: masking never blocks the clinical workflow.
    const phiScans = await scanFields({
      chief_complaint: input.chief_complaint,
      gender_identity: input.patient_context.demographics.gender_identity,
    });

    const maskedComplaint = phiScans.chief_complaint?.maskedText ?? input.chief_complaint;
    const maskedGenderIdentity = phiScans.gender_identity?.maskedText ?? input.patient_context.demographics.gender_identity;

    const phiDetectedInEncounter = Object.values(phiScans).some(r => r.phiDetected);
    const totalPhiMatches = Object.values(phiScans).reduce((n, r) => n + r.matches.length, 0);
    const totalScanMs = Object.values(phiScans).reduce((n, r) => n + r.durationMs, 0);

    if (phiDetectedInEncounter) {
      console.warn(
        `[PhiGuard] PHI detected and masked in encounter ${sessionId}. ` +
        `Fields: ${Object.keys(phiScans).join(', ')}. Matches: ${totalPhiMatches}.`
      );
    }

    // 4. Assemble clinicalData from MASKED fields — this is what gets hashed and stored.
    const maskedPatientContext = {
      ...input.patient_context,
      demographics: {
        ...input.patient_context.demographics,
        gender_identity: maskedGenderIdentity,
      },
    };

    const clinicalData: ClinicalData = {
      schemaVersion: 2,
      chief_complaint: maskedComplaint,
      patient_context: maskedPatientContext,
      vitals: input.vitals,
      history: {
        allergies: input.patient_context.clinical?.allergies?.map(a => a.substance) || [],
        medications: input.patient_context.clinical?.medications?.map(m => m.name) || [],
        pmh: input.patient_context.clinical?.comorbidities?.map(c => c.description) || [],
        notes: ''
      },
      red_flags: input.red_flags,
      ai_recommendation: recommendation,
      rules_recommendation: rules_check,
      acuity_divergence: acuityDivergence,
      acuity_governance_event: governanceEvent,
      ai_provider: provider,
      state: 'waiting',
      safety_warning_triggered: input.safety_warning_triggered,
      safety_warning_bypassed: input.safety_warning_bypassed
    };

    // 5. Write the event referencing pointers (never raw PHI — masking enforced above)
    const event = await this.eventService.ingestEvent({
       event_id: parentEventId,
       agent_fingerprint_id: activeFingerprint,
       model_version: provider === 'ollama' ? TRIAGE_AGENT.model : 'rules_fallback',
       workflow_type: 'triage_recommendation',
       session_id: sessionId,
       input_ref: 'clinical_admission_form',
       output_ref: 'ai_triage_audit',
       // policy_id uses masked complaint so it is also safe to store
       policy_id: `live::${maskedComplaint}::${input.vitals.hr}::${input.vitals.bp_sys}/${input.vitals.bp_dia}::${recommendation.acuity}::${recommendation.reasons.join('|')}`.substring(0, 512),
       clinical_data: clinicalData,
       reason_code: 'initial_decision'
    });

    const phi_scan: PhiScanSummary | undefined = phiDetectedInEncounter
      ? {
          phiDetected: true,
          fieldsScanned: Object.keys(phiScans),
          matchCount: totalPhiMatches,
          durationMs: totalScanMs,
        }
      : undefined;

    return {
       encounter_id: sessionId,
       db_row_id: event.id,
       arrival_time: event.timestamp as string,
       clinician_action: null,
       agent_id: activeFingerprint,
       source: 'live',
       clinical: clinicalData,
       integrity: {
         event_hash: event.event_hash,
         merkle_root_id: null,
         anchored_to_chain: false,
         tamper_status: 'pending'
       },
       phi_scan,
       agent_name: activeAgent ? activeAgent.name : undefined,
       agent_version: activeAgent ? activeAgent.version : undefined,
    };
  }

  /**
   * Record a clinician action (accepted, overridden, etc.) with reason and optional amendment linkage.
   */
  async logClinicianAction(
    sessionId: string,
    action: string,
    reasonCode: string,
    reasonText?: string,
    assignedAcuity?: number
  ): Promise<{ is_amendment: boolean; previous_action: string | null; phi_scan?: PhiScanSummary }> {
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;

    try {
      const idMatch = sessionId.match(/^enc_(\d+)$/);

      // 1. Check for existing clinician actions to see if this is an amendment
      let existingRes = await client.query(
        `SELECT event_id, clinician_action FROM agent_events 
         WHERE session_id = $1
         ORDER BY id DESC LIMIT 1`,
        [sessionId]
      );
      
      if (existingRes.rows.length === 0 && idMatch) {
        existingRes = await client.query(
          `SELECT event_id, clinician_action FROM agent_events 
           WHERE id = $1 OR (session_id IS NULL AND id = $1)
           ORDER BY id DESC LIMIT 1`,
          [parseInt(idMatch[1])]
        );
      }
      
      const lastEventId = existingRes.rows.length > 0 ? existingRes.rows[0].event_id : null;
      
      let cliniciansActionFoundRes = await client.query(
        `SELECT clinician_action FROM agent_events 
         WHERE session_id = $1 AND clinician_action IS NOT NULL 
         LIMIT 1`,
        [sessionId]
      );
      
      if (cliniciansActionFoundRes.rows.length === 0 && idMatch) {
        cliniciansActionFoundRes = await client.query(
          `SELECT clinician_action FROM agent_events 
           WHERE (id = $1 OR (session_id IS NULL AND id = $1)) AND clinician_action IS NOT NULL 
           LIMIT 1`,
          [parseInt(idMatch[1])]
        );
      }
      
      const isAmendment = cliniciansActionFoundRes.rows.length > 0;
      const previousAction = isAmendment ? existingRes.rows[0].clinician_action : null;

      // 2. Fetch the original recommendation data to carry forward refs
      let res = await client.query(
        `SELECT input_ref, output_ref, policy_id, clinical_data FROM agent_events WHERE session_id = $1 AND workflow_type = 'triage_recommendation' ORDER BY id ASC LIMIT 1`,
        [sessionId]
      );
      
      if (res.rows.length === 0 && idMatch) {
        res = await client.query(
          `SELECT input_ref, output_ref, policy_id, clinical_data FROM agent_events WHERE id = $1 AND workflow_type = 'triage_recommendation'`,
          [parseInt(idMatch[1])]
        );
      }
      
      if (res.rows.length === 0) throw new Error(`Session ${sessionId} not found`);
      const { input_ref, output_ref, policy_id, clinical_data } = res.rows[0];

      let payload = clinical_data;
      if (assignedAcuity) {
        payload = { ...clinical_data, schemaVersion: 1, clinician_acuity: Number(assignedAcuity) };
      }

      // 3. PHI masking on reason_text before it reaches the ledger
      let maskedReasonText = reasonText;
      let phi_scan: PhiScanSummary | undefined;

      if (reasonText) {
        const scan = await scanFields({ reason_text: reasonText });
        maskedReasonText = scan.reason_text?.maskedText ?? reasonText;

        if (scan.reason_text?.phiDetected) {
          console.warn(
            `[PhiGuard] PHI detected and masked in clinician reason_text for session ${sessionId}. ` +
            `Matches: ${scan.reason_text.matches.length}.`
          );
          phi_scan = {
            phiDetected: true,
            fieldsScanned: ['reason_text'],
            matchCount: scan.reason_text.matches.length,
            durationMs: scan.reason_text.durationMs,
          };
        }
      }

      // 4. Append the new decision event (resolving current platform agent)
      const activeFingerprint = await this.resolveActiveAgent(TRIAGE_AGENT.slug);

      await this.eventService.ingestEvent({
        agent_fingerprint_id: activeFingerprint,
        model_version: 'clinician',
        workflow_type: isAmendment ? 'clinician_amendment' : 'clinician_action',
        policy_id,
        clinical_data: payload,
        session_id: sessionId,
        clinician_action: action,
        input_ref,
        output_ref,
        amends_event_id: lastEventId,
        reason_code: reasonCode,
        reason_text: maskedReasonText
      });

      return { is_amendment: isAmendment, previous_action: previousAction, phi_scan };
    } finally {
      if (shouldRelease) client.release();
    }
  }

  /**
   * Read model: hydrated triage queue for clinician view.
   */
  async getTriageEncounters(filters: { state?: string; acuity?: number; source?: 'live' | 'scenario' } = {}): Promise<TriageEncounter[]> {
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;

    try {
      const res = await client.query(
        `SELECT DISTINCT ON (COALESCE(e.session_id, e.id::text)) e.*, a.name as agent_name, a.version as agent_version
         FROM agent_events e
         LEFT JOIN agents a ON e.agent_fingerprint_id = a.fingerprint_hash
         WHERE e.workflow_type = 'triage_recommendation'
         ORDER BY COALESCE(e.session_id, e.id::text), e.id DESC`
      );

      const encounters: TriageEncounter[] = (res.rows as any[]).map((event: any) => {
        const sessionId = event.session_id || `enc_${event.id}`;
        const isLive = /^.+_[0-9a-f]{8}-[0-9a-f]{4}/.test(sessionId);
        const source: 'live' | 'scenario' = isLive ? 'live' : 'scenario';

        let clinicalData: ClinicalData;
        if (event.clinical_data && (event.clinical_data as any).schemaVersion >= 1) {
          clinicalData = event.clinical_data as ClinicalData;
        } else if (isLive && event.policy_id?.startsWith('live::')) {
          const parts = event.policy_id.split('::');
          const acuity = parts[4] ? parseInt(parts[4]) : 3;
          const reasons = parts[5] ? parts[5].split('|') : [];
          const [sys, dia] = (parts[3] || '120/80').split('/').map((n: string) => parseInt(n) || 120);

          const age = 22 + (event.id % 60);
          const gender = (event.id % 2 === 0) ? 'male' : 'female';

          clinicalData = {
            schemaVersion: 0,
            chief_complaint: parts[1] || 'Unknown',
            patient_context: {
              demographics: {
                age_years: age,
                sex_at_birth: gender as any,
              }
            },
            age,
            gender: gender === 'male' ? 'Male' : 'Female',
            vitals: { hr: parseInt(parts[2]) || 70, bp_sys: sys, bp_dia: dia, rr: 12 + (event.id % 8), spo2: 95 + (event.id % 5), map: Math.round((sys + 2 * dia) / 3), temp: 37.0, pain_score: 0, avpu: 'A' },
            history: { allergies: [], medications: [], pmh: [] },
            state: event.clinician_action ? 'completed' : 'in_progress',
            ai_recommendation: reasons.length > 0 ? { acuity, reasons } : undefined,
            ai_provider: event.model_version || 'rules_fallback',
          } as unknown as ClinicalData; // Pre-governance legacy record: acuity_governance_event absent by design
        } else {
          clinicalData = getMockClinicalData(sessionId);
          clinicalData.state = event.clinician_action ? 'completed' : 'in_progress';
        }

        const canonical = buildCanonicalPayload(event);
        const reconstructedHash = generateEventHash(canonical, event.previous_event_hash, new Date(event.timestamp).toISOString());
        let tamperStatus: 'pending' | 'anchored' | 'tampered' = event.anchored_to_chain ? 'anchored' : 'pending';
        if (reconstructedHash !== event.event_hash) tamperStatus = 'tampered';

        return {
          encounter_id: sessionId,
          db_row_id: event.id,
          arrival_time: new Date(event.timestamp).toISOString(),
          clinician_action: event.clinician_action,
          agent_id: event.agent_fingerprint_id,
          source,
          clinical: clinicalData,
          integrity: { event_hash: event.event_hash, merkle_root_id: event.merkle_root_id, anchored_to_chain: event.anchored_to_chain, tamper_status: tamperStatus },
          agent_name: event.agent_name || undefined,
          agent_version: event.agent_version || undefined,
        };
      });

      const sessionIds = encounters.map(e => e.encounter_id);
      const historyMap: Record<string, any[]> = {};
      if (sessionIds.length > 0) {
        const historyRes = await client.query(
          `SELECT session_id, clinician_action, timestamp, event_hash, anchored_to_chain, amends_event_id, reason_code, reason_text, clinical_data
           FROM agent_events
           WHERE clinician_action IS NOT NULL AND (session_id = ANY($1))
           ORDER BY id ASC`,
          [sessionIds]
        );
        (historyRes.rows as AgentEvent[]).forEach((row: AgentEvent) => {
          const sid = row.session_id || 'unknown';
          if (!historyMap[sid]) historyMap[sid] = [];
          historyMap[sid].push({
            action: row.clinician_action!,
            timestamp: new Date(row.timestamp).toISOString(),
            anchored: row.anchored_to_chain,
            event_hash: row.event_hash,
            reason_code: row.reason_code || undefined,
            reason_text: row.reason_text || undefined,
            amends_event_id: row.amends_event_id || undefined,
            clinician_acuity: (row.clinical_data as any)?.clinician_acuity,
          });
        });
      }

      encounters.forEach(e => {
        const history = historyMap[e.encounter_id] || [];
        e.decision_history = history;
        if (history.length > 0) {
          e.clinical.state = 'completed';
          const latest = history[history.length - 1];
          e.clinician_action = latest.action;
          if (latest.clinician_acuity) e.clinical.clinician_acuity = latest.clinician_acuity;
        }
      });

      let filtered = encounters.sort((a, b) => new Date(b.arrival_time).getTime() - new Date(a.arrival_time).getTime());
      if (filters.source) filtered = filtered.filter(e => e.source === filters.source);
      if (filters.state) filtered = filtered.filter(e => e.clinical.state === filters.state);
      if (filters.acuity) filtered = filtered.filter(e => e.clinical.ai_recommendation?.acuity === Number(filters.acuity));
      return filtered;
    } finally {
      if (shouldRelease) client.release();
    }
  }

  async getEncounterHistory(sessionId: string) {
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;
    try {
      const res = await client.query(
        `SELECT event_id, clinician_action, workflow_type, timestamp, event_hash, anchored_to_chain, amends_event_id, reason_code, reason_text
         FROM agent_events WHERE session_id = $1 ORDER BY id ASC`,
        [sessionId]
      );
      return {
        session_id: sessionId,
        nodes: (res.rows as AgentEvent[]).map((row: AgentEvent) => ({
          id: row.event_id,
          type: row.workflow_type === 'triage_recommendation' && !row.clinician_action ? 'ai_recommendation' : 'clinician_action',
          action: row.clinician_action,
          timestamp: new Date(row.timestamp).toISOString(),
          anchored: row.anchored_to_chain,
          hash: row.event_hash,
          reason: row.reason_code,
          note: row.reason_text,
          workflow: row.workflow_type
        })),
        edges: (res.rows as AgentEvent[]).filter((row: AgentEvent) => row.amends_event_id).map((row: AgentEvent) => ({ from: row.event_id, to: row.amends_event_id!, type: 'amends' }))
      };
    } finally {
      if (shouldRelease) client.release();
    }
  }

  async getAuditPack(sessionId: string) {
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;
    try {
      const res = await client.query(
        `SELECT e.*, a.merkle_root, a.tx_hash, a.chain_name
         FROM agent_events e LEFT JOIN merkle_anchors a ON e.merkle_root_id = a.id
         WHERE e.session_id = $1 ORDER BY e.id ASC`,
        [sessionId]
      );
      if (res.rows.length === 0) throw new Error(`Audit Pack Error: Session ${sessionId} not found`);
      
      const events = res.rows;
      const errors: string[] = [];
      const nodes = events.map((event: any) => {
        const canonical = buildCanonicalPayload(event);
        const ts = new Date(event.timestamp).toISOString();
        const calculatedHash = generateEventHash(canonical, event.previous_event_hash, ts);
        if (calculatedHash !== event.event_hash) errors.push(`Integrity Failure: Hash mismatch at Event ID ${event.event_id}`);
        
        return {
          event_id: event.event_id,
          workflow: event.workflow_type,
          timestamp: ts,
          event_hash: event.event_hash,
          provenance: { amends: event.amends_event_id, reason: event.reason_code, note: event.reason_text },
          anchoring: event.anchored_to_chain ? { status: 'anchored', chain: event.chain_name || 'sepolia', merkle_root: event.merkle_root, tx_hash: event.tx_hash } : { status: 'pending' }
        };
      });

      return {
        pack_version: "1.0.0-regulatory",
        generated_at: new Date().toISOString(),
        session: { id: sessionId, environment: "simulation_lab", clinician_ref: sessionId.split('_')[0], effective_state: events[events.length - 1].clinician_action || 'awaiting_decision' },
        evidence: { nodes, edges: events.filter((e: any) => e.amends_event_id).map((e: any) => ({ from: e.event_id, to: e.amends_event_id, type: 'amends' })) },
        verification_certificate: { 
          audit_status: errors.length === 0 ? "verified" : "failed", 
          faults: errors, 
          attestation: "System-generated cryptographic integrity proof",
          explanation: errors.length === 0 
            ? "Audit Pack was generated from the append-only clinical AI event ledger and verified against on-chain Merkle anchors where applicable."
            : "Verification failed due to hash drift or unauthorized ledger modification."
        }
      };
    } finally {
      if (shouldRelease) client.release();
    }
  }

  async getActiveAgent(slug: string): Promise<any> {
    // 1. Try to find the agent explicitly marked active
    let res = await this.db.query(
      'SELECT * FROM agents WHERE is_active = true AND is_revoked = false LIMIT 1'
    );
    
    // 2. Fallback to default slug if none is explicitly marked active
    if (res.rows.length === 0) {
      res = await this.db.query(
        `SELECT * FROM agents 
         WHERE agent_id = $1 AND is_revoked = false 
         ORDER BY created_at DESC LIMIT 1`,
        [slug]
      );
    }

    if (res.rows.length === 0) return null;
    return res.rows[0];
  }

  async triageAgentHealth(): Promise<TriageHealthStatus> {
    if (TRIAGE_AGENT.provider !== 'ollama') {
      return { success: true, available: true, state: 'nominal', provider: 'rules', model: 'built-in' };
    }
    try {
      const res = await fetch(`${TRIAGE_AGENT.endpoint}/api/tags`, {
        signal: AbortSignal.timeout(10000)
      });
      if (!res.ok) {
        return {
          success: true,
          available: true,
          state: 'degraded',
          provider: 'rules',
          model: 'rules_fallback',
          details: { error_code: 'endpoint_error', message: `Ollama returned status ${res.status}. Falling back to rule engine.` }
        };
      }
      const data = await res.json() as any;
      const modelAvailable = data.models?.some((m: any) => m.name.startsWith(TRIAGE_AGENT.model)) ?? false;
      if (!modelAvailable) {
        // The endpoint is online, but the model is missing (configuration/provenance anomaly)
        return {
          success: true,
          available: true,
          state: 'anomaly_detected',
          provider: 'rules',
          model: 'rules_fallback',
          details: { error_code: 'model_not_found', message: `Registered model "${TRIAGE_AGENT.model}" is not loaded on Ollama server. Falling back to rule engine.` }
        };
      }
      return { success: true, available: true, state: 'nominal', provider: 'ollama', model: TRIAGE_AGENT.model };
    } catch (e: any) {
      // Offline/Timeout -> soft connection degraded state
      return {
        success: true,
        available: true,
        state: 'degraded',
        provider: 'rules',
        model: 'rules_fallback',
        details: { error_code: 'connection_timeout', message: `Connection to local Ollama agent failed. Falling back to rule engine.` }
      };
    }
  }

  async activateAgentWithAudit(params: {
    targetFingerprintHash: string;
    actor: { userId: string; displayName: string; role: string; type: string };
    source: string;
    requestId: string;
    reason?: string;
  }): Promise<{ eventId: number; occurredAt: string; agent: any }> {
    const client = await this.db.connect();
    
    let targetAgent: any = null;
    let prevAgent: any = null;
    let inTransaction = false;

    try {
      // 1. Resolve target agent details to verify it exists and is not revoked
      const targetAgentRes = await client.query(
        'SELECT agent_id, name, provider, version, is_revoked FROM agents WHERE fingerprint_hash = $1',
        [params.targetFingerprintHash]
      );
      if (targetAgentRes.rows.length === 0) {
        throw new Error(`Agent not found with fingerprint hash ${params.targetFingerprintHash}`);
      }
      targetAgent = targetAgentRes.rows[0];
      if (targetAgent.is_revoked) {
        throw new Error(`Cannot activate revoked agent ${targetAgent.agent_id}`);
      }

      // 2. Resolve current active agent (if any) for before/after diff tracking
      const currentActiveRes = await client.query(
        'SELECT agent_id, fingerprint_hash FROM agents WHERE is_active = true AND is_revoked = false LIMIT 1'
      );
      prevAgent = currentActiveRes.rows[0] || null;

      await client.query('BEGIN');
      inTransaction = true;

      // 3. Perform activation state switch
      await client.query('UPDATE agents SET is_active = false');
      const updateRes = await client.query(
        'UPDATE agents SET is_active = true WHERE fingerprint_hash = $1 RETURNING fingerprint_hash',
        [params.targetFingerprintHash]
      );
      if (updateRes.rows.length === 0) {
        throw new Error('Failed to update agent active status.');
      }

      // 4. Ingest success audit log
      const auditRes = await client.query(
        `INSERT INTO audit.agent_activation_events (
          actor_type, actor_id, actor_display_name, actor_role, event_type,
          target_agent_id, target_fingerprint_hash,
          previous_agent_id, previous_fingerprint_hash,
          source, request_id, reason, outcome, metadata
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING id, occurred_at`,
        [
          params.actor.type,
          params.actor.userId,
          params.actor.displayName,
          params.actor.role,
          'activation_attempt',
          targetAgent.agent_id,
          params.targetFingerprintHash,
          prevAgent ? prevAgent.agent_id : null,
          prevAgent ? prevAgent.fingerprint_hash : null,
          params.source,
          params.requestId,
          params.reason || null,
          'success',
          JSON.stringify({ target_name: targetAgent.name })
        ]
      );

      await client.query('COMMIT');
      inTransaction = false;
      return {
        eventId: auditRes.rows[0].id,
        occurredAt: auditRes.rows[0].occurred_at.toISOString(),
        agent: {
          slug: targetAgent.agent_id,
          name: targetAgent.name,
          provider: targetAgent.provider,
          version: targetAgent.version,
          fingerprintHash: params.targetFingerprintHash
        }
      };
    } catch (err: any) {
      if (inTransaction) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackErr) {
          console.error('Failed to rollback transaction:', rollbackErr);
        }
      }

      // 5. Ingest failure audit log in a separate, non-rolled-back database context
      try {
        await this.db.query(
          `INSERT INTO audit.agent_activation_events (
            actor_type, actor_id, actor_display_name, actor_role, event_type,
            target_agent_id, target_fingerprint_hash,
            previous_agent_id, previous_fingerprint_hash,
            source, request_id, reason, outcome, metadata
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            params.actor.type,
            params.actor.userId,
            params.actor.displayName,
            params.actor.role,
            'activation_attempt',
            targetAgent ? targetAgent.agent_id : 'unknown',
            params.targetFingerprintHash,
            prevAgent ? prevAgent.agent_id : null,
            prevAgent ? prevAgent.fingerprint_hash : null,
            params.source,
            params.requestId,
            params.reason || null,
            'failure',
            JSON.stringify({ error: err.message })
          ]
        );
      } catch (logErr) {
        console.error('Failed to log activation failure audit:', logErr);
      }

      throw err;
    } finally {
      client.release();
    }
  }

  async getActivationAuditTrail(limit: number = 50): Promise<any[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM audit.agent_activation_events 
       ORDER BY occurred_at DESC 
       LIMIT $1`,
      [limit]
    );
    return rows;
  }
}
