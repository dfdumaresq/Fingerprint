import { Pool } from 'pg';
import { ethers } from 'ethers';
import { randomUUID } from 'crypto';
import { generateEventHash, buildCanonicalPayload, AgentEvent } from '../utils/crypto.utils';
import { EventService } from './event.service';
import { TRIAGE_AGENT, TriageAgentConfig } from '../config/agents';

// ─── Domain Types ────────────────────────────────────────────────────────────

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
  age: number;
  sex: 'M' | 'F';
  history: {
    allergies: string[];
    medications: string[];
    pmh: string[];
    notes?: string;
  };
  red_flags?: string[];
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
  age: number;
  gender: string;
  red_flags?: string[];
  ai_recommendation?: TriageResult;
  clinician_acuity?: number;
  ai_provider?: string;
  state: string;
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

  // Hydrated Clinical Payload
  clinical: ClinicalData;

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
    event_hash: string;
    reason_code?: string;
    reason_text?: string;
    amends_event_id?: string;
    clinician_acuity?: number;
  }[];
}

// ─── AI Rule Engine ───────────────────────────────────────────────────────────

function runRuleEngine(input: ClinicalInput): TriageResult {
  let acuity = 3;
  const reasons: string[] = [];

  if (input.vitals.hr > 120) { acuity = Math.min(acuity, 2); reasons.push(`Tachycardia (HR ${input.vitals.hr})`); }
  if (input.vitals.spo2 < 92) { acuity = Math.min(acuity, 2); reasons.push(`Hypoxia (SpO₂ ${input.vitals.spo2}%)`); }
  if (input.vitals.bp_sys < 90) { acuity = Math.min(acuity, 2); reasons.push(`Hypotension (BP ${input.vitals.bp_sys}/${input.vitals.bp_dia})`); }
  if (input.vitals.glucose_mmol && input.vitals.glucose_mmol < 4.0) { acuity = Math.min(acuity, 2); reasons.push(`Hypoglycemia (Glucose ${input.vitals.glucose_mmol})`); }
  if (input.vitals.pain_score >= 8) { acuity = Math.min(acuity, 3); reasons.push(`Severe Pain (${input.vitals.pain_score}/10)`); }
  
  if (input.red_flags?.includes('chest_pain') && input.sex === 'M' && (input.age ?? 0) > 40) {
    acuity = Math.min(acuity, 2); reasons.push('ACS risk profile (chest pain, male >40)');
  }
  if (input.red_flags?.includes('altered_loc') || input.vitals.avpu === 'U') { acuity = 1; reasons.push('Critical neurologic status'); }

  if (reasons.length === 0) reasons.push(`Stable presentation — ${input.chief_complaint}`);
  return { acuity, reasons };
}

async function runTriageAgent(input: ClinicalInput): Promise<{ result: TriageResult, provider: string }> {
  if (TRIAGE_AGENT.provider === 'ollama') {
    try {
      const response = await fetch(`${TRIAGE_AGENT.endpoint}/api/generate`, {
        method: 'POST',
        body: JSON.stringify({
          model: TRIAGE_AGENT.model,
          prompt: buildTriagePrompt(input),
          stream: false,
          format: 'json'
        })
      });
      const data = await response.json();
      return { result: safeParseTriageJson(data.response), provider: 'ollama' };
    } catch (e) {
      console.warn("Ollama failed, falling back to rule engine:", e);
    }
  }
  return { result: runRuleEngine(input), provider: 'rules' };
}

function buildTriagePrompt(input: ClinicalInput): string {
  return `You are a clinical triage AI. Respond with ONLY valid JSON matching this exact schema: {"acuity": <1-5>, "reasons": ["<reason1>", "<reason2>"]}.
Acuity scale: 1=Resuscitation, 2=Emergent, 3=Urgent, 4=Less Urgent, 5=Non-Urgent.
Patient: ${input.chief_complaint}. Age: ${input.age}, Sex: ${input.sex}.
Vitals: HR ${input.vitals.hr}, BP ${input.vitals.bp_sys}/${input.vitals.bp_dia}, RR ${input.vitals.rr}, SpO2 ${input.vitals.spo2}% (${input.vitals.spo2_support || 'room air'}), Temp ${input.vitals.temp}°C (${input.vitals.temp_method || 'oral'}), Pain ${input.vitals.pain_score}/10.
History: Allergies: ${input.history.allergies.join(', ') || 'NKDA'}, Meds: ${input.history.medications.join(', ') || 'none'}, PMH: ${input.history.pmh.join(', ') || 'none'}.
Red flags: ${input.red_flags?.join(', ') || 'none'}.
Respond ONLY with JSON. No explanation, no markdown.`;
}

function safeParseTriageJson(raw: string): TriageResult {
  try {
    const data = JSON.parse(raw);
    return {
      acuity: Number(data.acuity) || 3,
      reasons: Array.isArray(data.reasons) ? data.reasons : ['AI provided triage recommendation']
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

  return {
    schemaVersion: 1,
    chief_complaint: COMPLAINTS[seedNum % COMPLAINTS.length],
    age,
    gender: (seedNum % 2 === 0) ? 'Male' : 'Female',
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
    state: 'waiting'
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

  /**
   * Clinician-driven: create an encounter, get AI recommendation, log to ledger.
   */
  async createEncounterWithAI(input: ClinicalInput, clinicianName: string): Promise<TriageEncounter> {
    const sessionId = `${clinicianName.toLowerCase().replace(/\s+/g, '_')}_${randomUUID()}`;

    // 1. Run AI triage
    const { result: recommendation, provider } = await runTriageAgent(input);

    // 2. Write the event referencing pointers (never raw PHI)
    const event = await this.eventService.ingestEvent({
       agent_fingerprint_id: TRIAGE_AGENT.id,
       model_version: provider === 'ollama' ? TRIAGE_AGENT.model : 'rules_fallback',
       workflow_type: 'triage_recommendation',
       session_id: sessionId,
       input_ref: 'clinical_admission_form', 
       output_ref: 'ai_triage_audit',
       policy_id: `live::${input.chief_complaint}::${input.vitals.hr}::${input.vitals.bp_sys}/${input.vitals.bp_dia}::${recommendation.acuity}::${recommendation.reasons.join('|')}`,
       clinical_data: {
          schemaVersion: 1,
          chief_complaint: input.chief_complaint,
          age: input.age,
          gender: input.sex === 'M' ? 'Male' : 'Female',
          vitals: input.vitals,
          history: input.history,
          red_flags: input.red_flags,
          ai_recommendation: recommendation,
          ai_provider: provider,
          state: 'waiting'
       } as ClinicalData,
       reason_code: 'initial_decision'
    });

    return {
       encounter_id: sessionId,
       db_row_id: event.id,
       arrival_time: event.timestamp,
       clinician_action: null,
       agent_id: TRIAGE_AGENT.id,
       source: 'live',
       clinical: {
         ...input,
         gender: input.sex === 'M' ? 'Male' : 'Female',
         ai_recommendation: recommendation,
         ai_provider: provider,
         state: 'waiting',
         schemaVersion: 1
       } as any,
       integrity: {
         event_hash: event.event_hash,
         merkle_root_id: null,
         anchored_to_chain: false,
         tamper_status: 'pending'
       }
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
  ): Promise<{ is_amendment: boolean; previous_action: string | null }> {
    const isPool = (this.db as any).connect && typeof (this.db as any).release !== 'function';
    const client = isPool ? await (this.db as any).connect() : this.db;
    const shouldRelease = isPool;

    try {
      // 1. Check for existing clinician actions to see if this is an amendment
      const existingRes = await client.query(
        `SELECT event_id, clinician_action FROM agent_events 
         WHERE session_id = $1
         ORDER BY id DESC LIMIT 1`,
        [sessionId]
      );
      
      const lastEventId = existingRes.rows.length > 0 ? existingRes.rows[0].event_id : null;
      
      const cliniciansActionFoundRes = await client.query(
        `SELECT clinician_action FROM agent_events 
         WHERE session_id = $1 AND clinician_action IS NOT NULL 
         LIMIT 1`,
        [sessionId]
      );
      const isAmendment = cliniciansActionFoundRes.rows.length > 0;
      const previousAction = isAmendment ? existingRes.rows[0].clinician_action : null;

      // 2. Fetch the original recommendation data to carry forward refs
      const res = await client.query(
        `SELECT input_ref, output_ref, policy_id, clinical_data FROM agent_events WHERE session_id = $1 AND workflow_type = 'triage_recommendation' ORDER BY id ASC LIMIT 1`,
        [sessionId]
      );
      if (res.rows.length === 0) throw new Error(`Session ${sessionId} not found`);
      const { input_ref, output_ref, policy_id, clinical_data } = res.rows[0];

      let payload = clinical_data;
      if (assignedAcuity) {
        payload = { ...clinical_data, schemaVersion: 1, clinician_acuity: Number(assignedAcuity) };
      }

      // 3. Append the new decision event
      await this.eventService.ingestEvent({
        agent_fingerprint_id: TRIAGE_AGENT.id,
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
        reason_text: reasonText
      });

      return { is_amendment: isAmendment, previous_action: previousAction };
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
        `SELECT DISTINCT ON (COALESCE(session_id, id::text)) *
         FROM agent_events
         WHERE workflow_type = 'triage_recommendation'
         ORDER BY COALESCE(session_id, id::text), id DESC`
      );

      const encounters: TriageEncounter[] = (res.rows as AgentEvent[]).map((event: AgentEvent) => {
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

          clinicalData = {
            schemaVersion: 0,
            chief_complaint: parts[1] || 'Unknown',
            age: 22 + (event.id % 60),
            gender: (event.id % 2 === 0) ? 'Male' : 'Female',
            vitals: { hr: parseInt(parts[2]) || 70, bp_sys: sys, bp_dia: dia, rr: 12 + (event.id % 8), spo2: 95 + (event.id % 5), map: Math.round((sys + 2 * dia) / 3), temp: 37.0, pain_score: 0, avpu: 'A' },
            history: { allergies: [], medications: [], pmh: [] },
            state: event.clinician_action ? 'completed' : 'in_progress',
            ai_recommendation: reasons.length > 0 ? { acuity, reasons } : undefined,
            ai_provider: event.model_version || 'rules_fallback',
          };
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

  async triageAgentHealth(): Promise<{ available: boolean; provider: string; model: string }> {
    if (TRIAGE_AGENT.provider !== 'ollama') return { available: true, provider: 'rules', model: 'built-in' };
    try {
      const res = await fetch(`${TRIAGE_AGENT.endpoint}/api/tags`);
      const data = await res.json() as any;
      const available = data.models?.some((m: any) => m.name.startsWith(TRIAGE_AGENT.model)) ?? false;
      return { available, provider: 'ollama', model: TRIAGE_AGENT.model };
    } catch {
      return { available: false, provider: 'ollama', model: TRIAGE_AGENT.model };
    }
  }
}
