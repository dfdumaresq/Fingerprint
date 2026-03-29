import { Pool } from 'pg';
import { ethers } from 'ethers';
import { v4 as uuidv4 } from 'uuid';
import { generateEventHash } from '../utils/crypto.utils';
import { EventService } from './event.service';
import { TRIAGE_AGENT, TriageAgentConfig } from '../config/agents';

// ─── Domain Types ────────────────────────────────────────────────────────────

export interface ClinicalInput {
  chief_complaint: string;
  vitals: { hr: number; bp: string; rr?: number; spo2?: number };
  age?: number;
  sex?: 'M' | 'F';
  red_flags?: string[];
}

export interface TriageResult {
  acuity: number;          // 1 (critical) – 5 (non-urgent)
  reasons: string[];
}

export interface TriageEncounter {
  encounter_id: string;
  db_row_id: number;
  arrival_time: string;
  clinician_action: string | null;
  agent_id: string;
  source: 'live' | 'scenario';

  // Hydrated PHI Mock / Clinician-entered Data
  clinical: {
    acuity: number;
    chief_complaint: string;
    vitals: { heart_rate: number; blood_pressure: string };
    state: string;
    ai_recommendation?: TriageResult;
    ai_provider?: string;
  };

  integrity: {
    event_hash: string;
    merkle_root_id: number | null;
    anchored_to_chain: boolean;
    tamper_status: 'pending' | 'anchored' | 'tampered';
  };
  decision_history?: { 
    action: string; 
    timestamp: string; 
    anchored: boolean; 
    event_hash: string 
  }[];
}

// ─── AI Rule Engine ───────────────────────────────────────────────────────────

function runRuleEngine(input: ClinicalInput): TriageResult {
  let acuity = 3;
  const reasons: string[] = [];

  const systolic = parseInt(input.vitals.bp?.split('/')[0] ?? '120');

  if (input.vitals.hr > 120) { acuity = Math.min(acuity, 2); reasons.push(`Tachycardia (HR ${input.vitals.hr})`); }
  if (input.vitals.spo2 !== undefined && input.vitals.spo2 < 92) { acuity = Math.min(acuity, 2); reasons.push(`Hypoxia (SpO₂ ${input.vitals.spo2}%)`); }
  if (systolic < 90) { acuity = Math.min(acuity, 2); reasons.push(`Hypotension (BP ${input.vitals.bp})`); }
  if (input.red_flags?.includes('chest_pain') && input.sex === 'M' && (input.age ?? 0) > 40) {
    acuity = Math.min(acuity, 2); reasons.push('ACS risk profile (chest pain, male >40)');
  }
  if (input.red_flags?.includes('altered_loc')) { acuity = 1; reasons.push('Altered level of consciousness'); }
  if (input.red_flags?.includes('syncope')) { acuity = Math.min(acuity, 2); reasons.push('Syncope'); }

  if (reasons.length === 0) reasons.push(`Stable presentation — ${input.chief_complaint}`);
  return { acuity, reasons };
}

// ─── Ollama Integration ───────────────────────────────────────────────────────

function buildTriagePrompt(input: ClinicalInput): string {
  return `You are a clinical triage AI. Respond with ONLY valid JSON matching this exact schema: {"acuity": <1-5>, "reasons": ["<reason1>", "<reason2>"]}.
Acuity scale: 1=Resuscitation, 2=Emergent, 3=Urgent, 4=Less Urgent, 5=Non-Urgent.
Patient: ${input.chief_complaint}. Age: ${input.age ?? 'unknown'}, Sex: ${input.sex ?? 'unknown'}.
Vitals: HR ${input.vitals.hr}, BP ${input.vitals.bp}${input.vitals.rr ? ', RR ' + input.vitals.rr : ''}${input.vitals.spo2 ? ', SpO2 ' + input.vitals.spo2 + '%' : ''}.
Red flags: ${input.red_flags?.join(', ') || 'none'}.
Respond ONLY with JSON. No explanation, no markdown.`;
}

function safeParseTriageJson(raw: string): TriageResult {
  // Strip markdown fences if model returns them
  const cleaned = raw.replace(/```json?/g, '').replace(/```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  if (typeof parsed.acuity !== 'number' || !Array.isArray(parsed.reasons)) {
    throw new Error('Invalid triage schema from LLM');
  }
  return { acuity: Math.min(5, Math.max(1, Math.round(parsed.acuity))), reasons: parsed.reasons };
}

async function callOllama(config: TriageAgentConfig, input: ClinicalInput): Promise<TriageResult> {
  const response = await fetch(`${config.endpoint}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: config.model,
      prompt: buildTriagePrompt(input),
      stream: false,
      options: { temperature: config.temperature ?? 0 },
    }),
  });
  if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
  const body = await response.json() as { response: string };
  return safeParseTriageJson(body.response);
}

// ─── Agent Dispatch ───────────────────────────────────────────────────────────

async function runTriageAgent(input: ClinicalInput): Promise<{ result: TriageResult; provider: string }> {
  if (TRIAGE_AGENT.provider === 'ollama') {
    try {
      const result = await callOllama(TRIAGE_AGENT, input);
      return { result, provider: `ollama:${TRIAGE_AGENT.model}` };
    } catch (e: any) {
      console.warn(`[TriageAgent] Ollama unavailable, falling back to rule engine: ${e.message}`);
    }
  }
  return { result: runRuleEngine(input), provider: 'rules_fallback' };
}

// ─── Mock PHI Hydrator (for scenario-mode events) ────────────────────────────

function getMockClinicalData(sessionId: string) {
  const hash = ethers.id(sessionId || 'unknown');
  const seedNum = parseInt(hash.substring(2, 10), 16);
  const COMPLAINTS = ['Chest Pain', 'Laceration', 'Shortness of Breath', 'Abdominal Pain', 'Fever', 'Headache', 'Dizziness', 'Sprain'];
  const DISPOSITIONS = ['waiting', 'in_room', 'completed', 'waiting'];
  const acuity = [1,2,3,4,5][seedNum % 5];
  const hr = 60 + (acuity * 8) + (seedNum % 25);
  const bp = `${95 + (acuity * 5) + (seedNum % 30)}/${60 + (seedNum % 20)}`;
  return {
    acuity,
    chief_complaint: COMPLAINTS[seedNum % COMPLAINTS.length],
    vitals: { heart_rate: hr, blood_pressure: bp },
    state: DISPOSITIONS[(seedNum >> 2) % DISPOSITIONS.length],
  };
}

// ─── Service Class ────────────────────────────────────────────────────────────

export class TriageService {
  private db: Pool;
  private eventService: EventService;

  constructor(dbPool: Pool) {
    this.db = dbPool;
    this.eventService = new EventService(dbPool);
  }

  /**
   * Clinician-driven: create an encounter, get AI recommendation, log to ledger.
   */
  async createEncounterWithAI(input: ClinicalInput, clinicianName: string): Promise<TriageEncounter> {
    const sessionId = `${clinicianName.toLowerCase().replace(/\s+/g, '_')}_${uuidv4()}`;

    // 1. Run AI triage
    const { result: recommendation, provider } = await runTriageAgent(input);

    // 2. Write the event referencing pointers (never raw PHI)
    const inputRef = `sha256:${ethers.id(JSON.stringify(input)).substring(2)}`;
    const outputRef = `sha256:${ethers.id(JSON.stringify(recommendation)).substring(2)}`;

    const event = await this.eventService.ingestEvent({
      agent_fingerprint_id: TRIAGE_AGENT.id,
      model_version: provider,
      workflow_type: 'triage_recommendation',
      // Encode clinical data into policy_id for display recovery on re-read
      // Format: "live::<complaint>::<hr>::<bp>::<acuity>::<reason1>|<reason2>"
      policy_id: `live::${input.chief_complaint}::${input.vitals.hr}::${input.vitals.bp}::${recommendation.acuity}::${recommendation.reasons.join('|')}`,
      session_id: sessionId,
      clinician_action: undefined,
      input_ref: inputRef,
      output_ref: outputRef,
    });

    return {
      encounter_id: sessionId,
      db_row_id: (event as any).id ?? 0,
      arrival_time: new Date().toISOString(),
      clinician_action: null,
      agent_id: TRIAGE_AGENT.id,
      source: 'live',
      clinical: {
        acuity: recommendation.acuity,
        chief_complaint: input.chief_complaint,
        vitals: { heart_rate: input.vitals.hr, blood_pressure: input.vitals.bp },
        state: 'waiting',
        ai_recommendation: recommendation,
        ai_provider: provider,
      },
      integrity: {
        event_hash: (event as any).event_hash,
        merkle_root_id: null,
        anchored_to_chain: false,
        tamper_status: 'pending',
      },
    };
  }

  /**
   * Log a clinician's accept / downgrade / escalate decision.
   */
  async logClinicianAction(
    sessionId: string,
    action: 'accepted' | 'overridden' | 'downgraded' | 'escalated',
  ): Promise<{ is_amendment: boolean; previous_action: string | null }> {
    // 1. Check for existing clinician actions to see if this is an amendment
    const existingRes = await this.db.query(
      `SELECT clinician_action FROM agent_events 
       WHERE session_id = $1 AND clinician_action IS NOT NULL 
       ORDER BY id DESC LIMIT 1`,
      [sessionId]
    );
    const isAmendment = existingRes.rows.length > 0;
    const previousAction = isAmendment ? existingRes.rows[0].clinician_action : null;

    // 2. Fetch the original recommendation data to carry forward refs
    const res = await this.db.query(
      `SELECT input_ref, output_ref, policy_id FROM agent_events WHERE session_id = $1 AND workflow_type = 'triage_recommendation' ORDER BY id ASC LIMIT 1`,
      [sessionId]
    );
    if (res.rows.length === 0) throw new Error(`Session ${sessionId} not found`);
    const { input_ref, output_ref, policy_id } = res.rows[0];

    // 3. Append the new decision event
    await this.eventService.ingestEvent({
      agent_fingerprint_id: TRIAGE_AGENT.id,
      model_version: 'clinician',
      workflow_type: isAmendment ? 'clinician_amendment' : 'triage_recommendation',
      policy_id,           // carry forward so clinical data stays correct
      session_id: sessionId,
      clinician_action: action,
      input_ref,
      output_ref,
    });

    return { is_amendment: isAmendment, previous_action: previousAction };
  }

  /**
   * Read model: hydrated triage queue for clinician view.
   */
  async getTriageEncounters(filters: { state?: string; acuity?: number; source?: 'live' | 'scenario' } = {}): Promise<TriageEncounter[]> {
    // Fetch latest event per session_id — the clinician action overwrites the AI row in the queue view
    // but we also need the original AI recommendation data, so we do a self-join
    const res = await this.db.query(
      `SELECT DISTINCT ON (COALESCE(session_id, id::text)) *
       FROM agent_events
       WHERE workflow_type = 'triage_recommendation'
       ORDER BY COALESCE(session_id, id::text), id DESC`
    );

    const encounters: TriageEncounter[] = res.rows.map(event => {
      const sessionId = event.session_id || `enc_${event.id}`;
      // Determine source: live sessions are UUID-suffixed, scenario sessions are enc_N
      const isLive = /^.+_[0-9a-f]{8}-[0-9a-f]{4}/.test(sessionId);
      const source: 'live' | 'scenario' = isLive ? 'live' : 'scenario';

      // Hydrate clinical data:
      // - Live encounters: decode from policy_id "live::<complaint>::<hr>::<bp>"
      // - Scenario encounters: use deterministic mock hydrator
      let clinicalData: { acuity: number; chief_complaint: string; vitals: { heart_rate: number; blood_pressure: string }; state: string };
      if (isLive && event.policy_id?.startsWith('live::')) {
        const parts = event.policy_id.split('::');
        const acuity = parts[4] ? parseInt(parts[4]) : 3;
        const reasons = parts[5] ? parts[5].split('|') : [];
        clinicalData = {
          acuity,
          chief_complaint: parts[1] || 'Unknown',
          vitals: { heart_rate: parseInt(parts[2]) || 0, blood_pressure: parts[3] || '--/--' },
          state: event.clinician_action ? 'completed' : 'waiting',
          ai_recommendation: reasons.length > 0 ? { acuity, reasons } : undefined,
          ai_provider: event.model_version || 'rules_fallback',
        } as any;
      } else {
        clinicalData = getMockClinicalData(sessionId);
      }

      // Inline tamper check
      const reconstructedPayload: any = {
        agent_fingerprint_id: event.agent_fingerprint_id,
        model_version: event.model_version,
        workflow_type: event.workflow_type,
        input_ref: event.input_ref,
        output_ref: event.output_ref,
      };
      if (event.policy_id !== null) reconstructedPayload.policy_id = event.policy_id;
      if (event.session_id !== null) reconstructedPayload.session_id = event.session_id;
      if (event.clinician_action !== null) reconstructedPayload.clinician_action = event.clinician_action;

      const trueHash = generateEventHash(reconstructedPayload, event.previous_event_hash, new Date(event.timestamp).toISOString());
      let tamperStatus: 'pending' | 'anchored' | 'tampered' = event.anchored_to_chain ? 'anchored' : 'pending';
      if (trueHash !== event.event_hash) tamperStatus = 'tampered';

      return {
        encounter_id: sessionId,
        db_row_id: event.id,
        arrival_time: new Date(event.timestamp).toISOString(),
        clinician_action: event.clinician_action,
        agent_id: event.agent_fingerprint_id,
        source,
        clinical: clinicalData,
        integrity: {
          event_hash: event.event_hash,
          merkle_root_id: event.merkle_root_id,
          anchored_to_chain: event.anchored_to_chain,
          tamper_status: tamperStatus,
        },
      };
    });

    // 2. Fetch decision history for all sessions in this batch to provide a timeline
    const sessionIds = encounters.map(e => e.encounter_id);
    const historyMap: Record<string, any[]> = {};
    
    if (sessionIds.length > 0) {
      const historyRes = await this.db.query(
        `SELECT session_id, clinician_action, timestamp, event_hash, anchored_to_chain
         FROM agent_events
         WHERE clinician_action IS NOT NULL AND (session_id = ANY($1))
         ORDER BY id ASC`,
        [sessionIds]
      );

      // Group history entries by session_id
      historyRes.rows.forEach(row => {
        if (!historyMap[row.session_id]) historyMap[row.session_id] = [];
        historyMap[row.session_id].push({
          action: row.clinician_action,
          timestamp: new Date(row.timestamp).toISOString(),
          anchored: row.anchored_to_chain,
          event_hash: row.event_hash,
        });
      });
    }

    // Attach history to each encounter object
    encounters.forEach(e => {
      e.decision_history = historyMap[e.encounter_id] || [];
    });

    let filtered = encounters.sort((a, b) => new Date(b.arrival_time).getTime() - new Date(a.arrival_time).getTime());

    if (filters.source) filtered = filtered.filter(e => e.source === filters.source);
    if (filters.state) filtered = filtered.filter(e => e.clinical.state === filters.state);
    if (filters.acuity) filtered = filtered.filter(e => e.clinical.acuity === Number(filters.acuity));

    return filtered;
  }

  /**
   * Fetch full decision sequence for a specific encounter session.
   */
  async getEncounterHistory(sessionId: string) {
    const res = await this.db.query(
      `SELECT clinician_action, workflow_type, timestamp, event_hash, anchored_to_chain
       FROM agent_events 
       WHERE session_id = $1 AND clinician_action IS NOT NULL
       ORDER BY id ASC`,
      [sessionId]
    );
    return res.rows.map(row => ({
      action: row.clinician_action,
      timestamp: new Date(row.timestamp).toISOString(),
      anchored: row.anchored_to_chain,
      event_hash: row.event_hash,
      workflow: row.workflow_type
    }));
  }

  /**
   * Ping Ollama to check if the configured model is available.
   */
  async triageAgentHealth(): Promise<{ available: boolean; provider: string; model: string }> {
    if (TRIAGE_AGENT.provider !== 'ollama') {
      return { available: true, provider: 'rules', model: 'built-in' };
    }
    try {
      const res = await fetch(`${TRIAGE_AGENT.endpoint}/api/tags`);
      const data = await res.json() as { models: { name: string }[] };
      const available = data.models?.some((m: any) => m.name.startsWith(TRIAGE_AGENT.model)) ?? false;
      return { available, provider: 'ollama', model: TRIAGE_AGENT.model };
    } catch {
      return { available: false, provider: 'ollama', model: TRIAGE_AGENT.model };
    }
  }
}
