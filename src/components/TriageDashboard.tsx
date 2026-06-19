import React, { useState, useEffect, useCallback } from 'react';
import '../css/triage.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ClinicalData {
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
  acuity?: number; // legacy
  clinician_acuity?: number;
  chief_complaint: string;
  patient_context: {
    demographics: {
      age_years: number;
      sex_at_birth: 'male' | 'female' | 'intersex' | 'unknown';
      gender_identity?: string;
      language_primary?: string;
      country_region?: string;
    };
    clinical?: {
      comorbidities?: { code: string; description: string }[];
      medications?: { name: string; dose?: string }[];
      allergies?: { substance: string; reaction?: string }[];
    };
  };
  age?: number;     // legacy fallback
  gender?: string;  // legacy fallback
  red_flags?: string[];
  ai_recommendation?: { acuity: number; reasons: string[] };
  /** Clinical rules engine result, always run in parallel with the AI model */
  rules_recommendation?: { acuity: number; reasons: string[] };
  /** |ai_acuity - rules_acuity|: 0=aligned, 1=discrepancy, ≥2=conflict */
  acuity_divergence?: number;
  ai_provider?: string;
  state: string;
}

interface TriageEncounter {
  encounter_id: string;
  db_row_id: number;
  arrival_time: string;
  clinician_action: string | null;
  agent_id: string;
  source: 'live' | 'scenario';
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
  }[];
}

interface PhiScanWarning {
  /** Which fields were scanned and had PHI detected */
  fieldsScanned: string[];
  /** Total number of PHI tokens redacted */
  matchCount: number;
  /** 'encounter' = fired on new encounter submission; 'action' = fired on clinician action */
  source: 'encounter' | 'action';
}

interface NewEncounterForm {
  chief_complaint: string;
  custom_complaint: string;
  
  // Vitals
  hr: string; bp_sys: string; bp_dia: string; rr: string; spo2: string;
  spo2_support: 'room_air' | 'supplemental';
  temp: string; temp_method: 'oral' | 'tympanic' | 'axillary' | 'rectal';
  pain_score: string; weight_kg: string; height_cm: string; glucose_mmol: string;
  avpu: 'A' | 'V' | 'P' | 'U' | '';
  
  // Patient Context
  age_years: string;
  sex_at_birth: 'male' | 'female' | 'intersex' | 'unknown' | '';
  gender_identity: string;
  
  // SAMPLE History
  history: {
    allergies: string;
    medications: string;
    pmh: string;
    notes: string;
  };

  red_flags: string[];
  clinician_name: string;
}

type TriageMode = 'all' | 'live' | 'scenario';

const CHIEF_COMPLAINTS = [
  'Chest Pain', 'Shortness of Breath', 'Abdominal Pain', 'Headache',
  'Fever', 'Dizziness', 'Laceration', 'Syncope', 'Back Pain', 'Other…'
];

const RED_FLAG_OPTIONS = [
  { id: 'chest_pain', label: 'Chest Pain' },
  { id: 'syncope', label: 'Syncope' },
  { id: 'altered_loc', label: 'Altered LOC' },
  { id: 'dyspnoea', label: 'Dyspnoea' },
];

const ACUITY_LABELS: Record<number, string> = {
  1: 'Resuscitation', 2: 'Emergent', 3: 'Urgent', 4: 'Less Urgent', 5: 'Non-Urgent'
};

const AMENDMENT_REASONS = [
  { id: 'new_lab_data', label: 'New Lab Data' },
  { id: 'senior_review', label: 'Senior Clinical Review' },
  { id: 'deterioration', label: 'Patient Deterioration' },
  { id: 'imaging_result', label: 'Imaging Result' },
  { id: 'clerical_error', label: 'Clerical/Entry Error' },
  { id: 'other', label: 'Other' },
];

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || '';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

const getAcuityColor = (lvl: number) => {
  switch (lvl) {
    case 1: return 'var(--acuity-1)';
    case 2: return 'var(--acuity-2)';
    case 3: return 'var(--acuity-3)';
    case 4: return 'var(--acuity-4)';
    case 5: return 'var(--acuity-5)';
    default: return 'var(--text-secondary)';
  }
};

const getFeatureColor = (category: string) => {
  switch (category) {
    case 'Critical': return '#ef4444';
    case 'Clinical': return '#f59e0b';
    case 'Cognitive': return '#3b82f6';
    default: return '#6b7280';
  }
};

// ─── Component ────────────────────────────────────────────────────────────────

export const TriageDashboard: React.FC = () => {
  const [encounters, setEncounters] = useState<TriageEncounter[]>([]);
  const [selectedEncounter, setSelectedEncounter] = useState<TriageEncounter | null>(null);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<TriageMode>(() => {
    return (localStorage.getItem('triage_filter_mode') as TriageMode) || 'all';
  });
  const [showNewForm, setShowNewForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [triageStatus, setTriageStatus] = useState<{ 
    available: boolean; 
    success: boolean;
    state?: 'nominal' | 'degraded' | 'anomaly_detected' | 'blocked';
    provider?: string;
    model?: string;
    details?: { error_code?: string; message?: string };
    agent?: any; 
    error?: string; 
  } | null>(null);
  const [changingDecision, setChangingDecision] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<{ is_amendment: boolean; previous_action: string | null } | null>(null);
  const [amendmentReason, setAmendmentReason] = useState('initial_decision');
  const [amendmentNote, setAmendmentNote] = useState('');
  const [showTechnicalProofs, setShowTechnicalProofs] = useState(false);
  const [showExtendedVitals, setShowExtendedVitals] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  // PHI masking soft-warning state
  // Set whenever the server detects and masks PHI in a submitted field.
  // Never blocks the workflow — informational only.
  const [phiScanWarning, setPhiScanWarning] = useState<PhiScanWarning | null>(null);
  const [availableAgents, setAvailableAgents] = useState<any[]>([]);

  // AI Latent Concept Audit (SAE) States (Phase 3)
  const [saeData, setSaeData] = useState<any | null>(null);
  const [saeLoading, setSaeLoading] = useState(false);
  const [saeError, setSaeError] = useState<string | null>(null);
  const [bypassSafety, setBypassSafety] = useState(false);
  const [activeEncounterId, setActiveEncounterId] = useState<string | null>(null);
  const [showSaeTechnical, setShowSaeTechnical] = useState(false);

  // Semantic Embedding Alignment Audit States
  const [semanticData, setSemanticData] = useState<any | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [semanticError, setSemanticError] = useState<string | null>(null);
  const [showSemanticTechnical, setShowSemanticTechnical] = useState(false);

  // Pre-submission validation states
  const [validationWarning, setValidationWarning] = useState<string | null>(null);
  const [validationWarningType, setValidationWarningType] = useState<'contradiction' | 'infrastructure_degraded' | null>(null);
  const [painInputConflict, setPainInputConflict] = useState(false);
  const [preAuditLoading, setPreAuditLoading] = useState(false);

  const criticalFeatures = saeData?.active_features?.filter(
    (feat: any) => feat.category === 'Critical' && feat.strength >= 0.5
  ) || [];
  const hasCriticalWarning = criticalFeatures.length > 0;

  // Helper to build intermediate clinical representation for SAE inference
  const buildEncounterSaePrompt = (encounter: TriageEncounter): string => {
    const c = encounter.clinical;
    const complaint = c.chief_complaint;
    const vitals = c.vitals;
    const hr = vitals.hr;
    const sys = vitals.bp_sys;
    const dia = vitals.bp_dia;
    const rr = vitals.rr;
    const spo2 = vitals.spo2;
    const temp = vitals.temp ?? 37.0;
    const pain = vitals.pain_score ?? 0;
    const age = c.patient_context?.demographics?.age_years ?? c.age ?? 0;
    const gender = c.patient_context?.demographics?.sex_at_birth ?? c.gender ?? 'unknown';
    const pmh = c.history?.pmh?.length ? c.history.pmh.join(', ') : 'None';
    
    return `Patient chief complaint: ${complaint}. Vitals: HR ${hr} bpm, BP ${sys}/${dia} mmHg, RR ${rr}/min, SpO2 ${spo2}%, Temp ${temp}°C, Pain ${Number(pain) * 10}%. Age ${age}, Gender ${gender}. History: PMH ${pmh}.`;
  };

  // Reset all transient drawer/action states whenever the selected encounter changes (opened, closed, or switched)
  useEffect(() => {
    if (selectedEncounter?.encounter_id !== activeEncounterId) {
      setActiveEncounterId(selectedEncounter?.encounter_id || null);
      setPendingAction(null);
      setChangingDecision(false);
      setBypassSafety(false);
      setAmendmentReason('initial_decision');
      setAmendmentNote('');
      setShowSaeTechnical(false);
      setShowSemanticTechnical(false);
    }
  }, [selectedEncounter, activeEncounterId]);

  // Asynchronously fetch active features and semantic alignment in parallel when an encounter drawer opens
  useEffect(() => {
    if (!selectedEncounter) {
      setSaeData(null);
      setSaeLoading(false);
      setSaeError(null);
      setBypassSafety(false);
      setSemanticData(null);
      setSemanticLoading(false);
      setSemanticError(null);
      return;
    }

    const fetchAudits = async () => {
      const hash = triageStatus?.agent?.fingerprintHash;
      if (!hash) {
        setSaeError('No active agent resolved. Unable to perform latent concept audit.');
        setSemanticError('No active agent resolved. Unable to perform semantic embedding audit.');
        return;
      }

      setSaeLoading(true);
      setSaeError(null);
      setBypassSafety(false);

      setSemanticLoading(true);
      setSemanticError(null);

      const saePrompt = buildEncounterSaePrompt(selectedEncounter);
      const predictedAcuity = selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || 3;

      // Execute both audit endpoint requests concurrently in parallel
      await Promise.all([
        // 1. SAE Audit
        (async () => {
          try {
            const res = await fetch(`${REACT_APP_API_URL}/v1/agents/${encodeURIComponent(hash)}/sae/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REACT_APP_API_KEY}`
              },
              body: JSON.stringify({
                prompt: saePrompt,
                mock: true // Enforce mock mode in dev/UI
              })
            });

            const data = await res.json();
            if (data.success) {
              setSaeData(data);
            } else {
              setSaeError(data.error || 'Failed to fetch latent concept audit.');
            }
          } catch (err: any) {
            console.error('Failed to run SAE audit', err);
            setSaeError(err.message || 'Failed to connect to SAE audit pipeline.');
          } finally {
            setSaeLoading(false);
          }
        })(),

        // 2. Semantic Embedding Alignment Audit
        (async () => {
          try {
            const res = await fetch(`${REACT_APP_API_URL}/v1/agents/${encodeURIComponent(hash)}/semantic/verify`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${REACT_APP_API_KEY}`
              },
              body: JSON.stringify({
                prompt: saePrompt,
                acuityLevel: predictedAcuity
              })
            });

            const data = await res.json();
            if (data.success) {
              setSemanticData(data);
            } else {
              setSemanticError(data.error?.message || 'Failed to fetch semantic alignment audit.');
            }
          } catch (err: any) {
            console.error('Failed to run semantic audit', err);
            setSemanticError(err.message || 'Failed to connect to semantic alignment audit pipeline.');
          } finally {
            setSemanticLoading(false);
          }
        })()
      ]);
    };

    fetchAudits();
  }, [selectedEncounter, triageStatus]);

  const [form, setForm] = useState<NewEncounterForm>({
    chief_complaint: '', custom_complaint: '',
    hr: '', bp_sys: '', bp_dia: '', rr: '', spo2: '',
    spo2_support: 'room_air',
    temp: '', temp_method: 'oral',
    pain_score: '', weight_kg: '', height_cm: '', glucose_mmol: '',
    avpu: '',
    age_years: '', sex_at_birth: '',
    gender_identity: '',
    history: {
      allergies: '', medications: '', pmh: '', notes: ''
    },
    red_flags: [],
    clinician_name: localStorage.getItem('clinician_name') || '',
  });

  const fetchEncounters = useCallback(async () => {
    setLoading(true);
    try {
      const qs = mode !== 'all' ? `?source=${mode}` : '';
      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/encounters${qs}`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const data = await res.json();
      if (data.success) setEncounters(data.data);
    } catch (err) {
      console.error('Failed to fetch triage encounters', err);
    }
    setLoading(false);
  }, [mode]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/status`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const data = await res.json();
      setTriageStatus(data);
    } catch (err) {
      console.error('Failed to fetch triage status', err);
    }
  }, []);

  const fetchAvailableAgents = useCallback(async () => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/agents`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const data = await res.json();
      if (data && Array.isArray(data.data)) {
        setAvailableAgents(data.data.filter((a: any) => !a.revoked));
      }
    } catch (err) {
      console.error('Failed to fetch available agents', err);
    }
  }, []);

  useEffect(() => { 
    fetchEncounters(); 
    fetchStatus();
    fetchAvailableAgents();
  }, [fetchEncounters, fetchStatus, fetchAvailableAgents]);

  // Poll to keep queue fresh when form is closed and no heavyweight verification is in progress
  useEffect(() => {
    if (preAuditLoading || submitting || saeLoading || semanticLoading || loading) {
      return; // Pause polling to reduce server contention
    }
    const interval = setInterval(fetchEncounters, 15000);
    return () => clearInterval(interval);
  }, [fetchEncounters, preAuditLoading, submitting, saeLoading, semanticLoading, loading]);

  // Dismiss panels on Escape
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (selectedEncounter) { setSelectedEncounter(null); setChangingDecision(false); return; }
      if (showNewForm) setShowNewForm(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedEncounter, showNewForm]);

  const submitEncounter = async () => {
    if (submitting || preAuditLoading) return;
    if (!form.chief_complaint || (form.chief_complaint === 'Other…' && !form.custom_complaint.trim()) || !form.hr || !form.bp_sys || !form.bp_dia || !form.age_years || !form.sex_at_birth) return;

    const enteredPain = Number(form.pain_score || 0);
    const hash = triageStatus?.agent?.fingerprintHash;

    // Trigger Semantic Guardrail only if Pain is 0/10 and not bypassed
    if (enteredPain === 0 && !bypassSafety && hash) {
      setPreAuditLoading(true);
      setValidationWarning(null);
      setValidationWarningType(null);
      setPainInputConflict(false);

      // Build intermediate patient presentation context for semantic verification
      const resolvedComplaint = form.chief_complaint === 'Other…' 
        ? form.custom_complaint 
        : (form.custom_complaint ? `${form.chief_complaint} (${form.custom_complaint})` : form.chief_complaint);
      const tempPrompt = `Patient chief complaint: ${resolvedComplaint}. Vitals: HR ${form.hr} bpm, BP ${form.bp_sys}/${form.bp_dia} mmHg, RR ${form.rr || 16}/min, SpO2 ${form.spo2 || 98}%, Temp ${form.temp || 37.0}°C, Pain 0%. Age ${form.age_years || 0}, Gender ${form.sex_at_birth || 'unknown'}. History: PMH ${form.history.pmh || 'None'}.`;

      try {
        const res = await fetch(`${REACT_APP_API_URL}/v1/agents/${encodeURIComponent(hash)}/semantic/verify`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${REACT_APP_API_KEY}`
          },
          body: JSON.stringify({
            prompt: tempPrompt,
            acuityLevel: 2 // Verify against ESI-2 Emergent Baseline
          })
        });

        const data = await res.json();
        
        // If Qwen recognizes the case as high ESI-2 emergent (similarity >= 0.70) but Pain is 0/10!
        if (data.success && data.similarity >= 0.70) {
          setValidationWarning("The patient's presentation aligns semantically with an emergent ESI-2 condition, but the Pain Score is registered as 0/10. Please verify or re-enter the Pain Score.");
          setValidationWarningType('contradiction');
          setPainInputConflict(true);
          setShowExtendedVitals(true); // Automatically reveal the extended vitals section
          setPreAuditLoading(false);
          return;
        }
      } catch (err) {
        console.warn("Pre-submission semantic audit failed, falling back to lexical rules:", err);
        
        // Lexical fallback: catches chest, pain, pressure, tightness, tearing, dissection, or angina keywords
        const complaintLower = (resolvedComplaint || '').toLowerCase();
        const hasHighRiskKeywords = complaintLower.includes('chest') || complaintLower.includes('pain') || complaintLower.includes('pressure') || complaintLower.includes('tightness') || complaintLower.includes('tearing') || complaintLower.includes('dissection') || complaintLower.includes('angina');
        
        if (hasHighRiskKeywords) {
          setValidationWarning("Chief complaint describes high-risk symptoms, but Pain Score is registered as 0/10. Please verify or re-enter the Pain Score.");
          setValidationWarningType('infrastructure_degraded');
          setPainInputConflict(true);
          setShowExtendedVitals(true);
          setPreAuditLoading(false);
          return;
        }
      }
      setPreAuditLoading(false);
    }

    // Reset warnings if validation checks pass
    setValidationWarning(null);
    setValidationWarningType(null);
    setPainInputConflict(false);

    setSubmitting(true);
    const complaint = form.chief_complaint === 'Other…' 
      ? form.custom_complaint 
      : (form.custom_complaint ? `${form.chief_complaint} (${form.custom_complaint})` : form.chief_complaint);
    try {
      if (form.clinician_name) localStorage.setItem('clinician_name', form.clinician_name);
      
      const payload = {
        chief_complaint: complaint,
        vitals: { 
          hr: Number(form.hr), 
          bp_sys: Number(form.bp_sys), 
          bp_dia: Number(form.bp_dia),
          rr: Number(form.rr || 16), 
          spo2: Number(form.spo2 || 98),
          spo2_support: form.spo2_support,
          temp: Number(form.temp || 37.0),
          temp_method: form.temp_method,
          pain_score: Number(form.pain_score || 0),
          weight_kg: form.weight_kg ? Number(form.weight_kg) : undefined,
          height_cm: form.height_cm ? Number(form.height_cm) : undefined,
          glucose_mmol: form.glucose_mmol ? Number(form.glucose_mmol) : undefined,
          avpu: form.avpu || 'A'
        },
        patient_context: {
          demographics: {
            age_years: Number(form.age_years || 0),
            sex_at_birth: form.sex_at_birth || 'unknown',
            gender_identity: form.gender_identity || undefined,
          },
          clinical: {
            allergies: form.history.allergies.split(',').map(s => ({ substance: s.trim() })).filter(a => a.substance),
            medications: form.history.medications.split(',').map(s => ({ name: s.trim() })).filter(m => m.name),
            comorbidities: form.history.pmh.split(',').map(s => ({ description: s.trim(), code: '' })).filter(c => c.description),
          }
        },
        red_flags: form.red_flags.filter(flagId => {
          const flag = RED_FLAG_OPTIONS.find(o => o.id === flagId);
          const resolvedComplaint = form.chief_complaint === 'Other…' 
            ? form.custom_complaint 
            : (form.custom_complaint ? `${form.chief_complaint} (${form.custom_complaint})` : form.chief_complaint);
          return flag ? flag.label.toLowerCase() !== resolvedComplaint?.trim().toLowerCase() : true;
        }),
        clinician_name: form.clinician_name || 'clinician',
        safety_warning_triggered: validationWarningType || 'none',
        safety_warning_bypassed: bypassSafety
      };

      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/encounters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REACT_APP_API_KEY}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (data.success) {
        setShowNewForm(false);
        setEncounters(prev => [data.data, ...prev]);
        setSelectedEncounter(data.data);
        setSecurityExpanded(false);

        // Surface PHI soft-warning if the server masked any tokens
        if (data.phi_scan?.phiDetected) {
          setPhiScanWarning({
            fieldsScanned: data.phi_scan.fieldsScanned ?? [],
            matchCount: data.phi_scan.matchCount ?? 1,
            source: 'encounter',
          });
        }
      }
    } catch (err) {
      console.error('Failed to create encounter', err);
    }
    setSubmitting(false);
  };

  const dispatchAction = async (action: string, assignedAcuity?: number) => {
    if (!selectedEncounter) return;
    setActionLoading(action);

    // Optimistic update: reflect the action immediately in the drawer and main queue
    setSelectedEncounter(prev => prev ? { 
      ...prev, 
      clinician_action: action,
      clinical: { ...prev.clinical, clinician_acuity: assignedAcuity ?? prev.clinical.clinician_acuity }
    } : null);
    
    setEncounters(prev => prev.map(e => e.encounter_id === selectedEncounter.encounter_id ? { 
      ...e, 
      clinician_action: action, 
      clinical: { ...e.clinical, state: 'completed', clinician_acuity: assignedAcuity ?? e.clinical.clinician_acuity } 
    } : e));
    
    setChangingDecision(false);
    setPendingAction(null);

    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/encounters/${encodeURIComponent(selectedEncounter.encounter_id)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${REACT_APP_API_KEY}` },
        body: JSON.stringify({ 
          action, 
          reason_code: amendmentReason,
          reason_text: amendmentNote,
          assigned_acuity: assignedAcuity
        }),
      });
      const data = await res.json();
      if (data.success) {
        setLastActionResult({ is_amendment: data.is_amendment, previous_action: data.previous_action });

        // Surface PHI soft-warning if the server masked any tokens in reason_text
        if (data.phi_scan?.phiDetected) {
          setPhiScanWarning({
            fieldsScanned: data.phi_scan.fieldsScanned ?? ['reason_text'],
            matchCount: data.phi_scan.matchCount ?? 1,
            source: 'action',
          });
        }

        // Reset reasons
        setAmendmentReason('initial_decision');
        setAmendmentNote('');
        
        // Return clinician to queue
        setSelectedEncounter(null);
        
        // Clear result message after a few seconds
        setTimeout(() => setLastActionResult(null), 5000);
      }
      // Refresh queue in background to sync integrity status and history
      fetchEncounters();
    } catch (err) {
      console.error('Failed to log clinician action', err);
      // Revert optimistic update on failure
      setSelectedEncounter(prev => prev ? { ...prev, clinician_action: null } : null);
    }
    setActionLoading(null);
  };

  const downloadAuditPack = async (sessionId: string) => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/encounters/${encodeURIComponent(sessionId)}/audit-pack`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-pack-${sessionId.substring(0, 8)}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to download audit pack', err);
      alert('Failed to generate audit pack. Please try again.');
    }
  };

  const toggleRedFlag = (id: string) => {
    setForm(f => ({
      ...f,
      red_flags: f.red_flags.includes(id) ? f.red_flags.filter(r => r !== id) : [...f.red_flags, id]
    }));
  };

  const getIntegrityIcon = (status: string) => {
    if (status === 'anchored') return <span className="integrity-icon integrity-anchored">🔗 Anchored</span>;
    if (status === 'tampered') return <span className="integrity-icon integrity-tampered">❌ Tampered</span>;
    return <span className="integrity-icon integrity-pending">⏳ Pending</span>;
  };

  return (
    <div className="triage-container">
      <div className="triage-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '15px' }}>
          <div>
            <h1>Clinician Triage Queue</h1>
            <p>Live AI-assisted emergency department waiting room.</p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            {/* Mode toggle */}
            <div className="mode-toggle">
              {(['all', 'live', 'scenario'] as TriageMode[]).map(m => (
                <button key={m} className={`mode-btn${mode === m ? ' active' : ''}`} onClick={() => {
                  setMode(m);
                  localStorage.setItem('triage_filter_mode', m);
                }}>
                  {m === 'all' ? 'All' : m === 'live' ? '● Live' : '● Scenario'}
                </button>
              ))}
            </div>
            {/* New Encounter */}
            <button 
              className="new-encounter-btn" 
              onClick={() => {
                setValidationWarning(null);
                setPainInputConflict(false);
                setBypassSafety(false);
                setShowNewForm(true);
              }}
            >
              + New Encounter
            </button>
          </div>
        </div>
        
        {/* Render banners based on live status state */}
        {!triageStatus?.agent && (
          <div className="agent-status-banner warning" style={{ marginTop: '16px', padding: '12px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', borderRadius: '8px', color: '#b45309', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>🤖 AI Assistance Paused: Local Rules Backup Active</strong>
              <div style={{ fontSize: '0.75rem', opacity: 0.85, marginTop: '2px' }}>
                No active agent resolved in the governance registry. Acuity calculations are running safely on the clinical rule engine.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexShrink: 0, marginLeft: '16px' }}>
              {availableAgents.length > 0 && (
                <button 
                  onClick={async () => {
                    const targetAgent = availableAgents[0];
                    if (window.confirm(`Activate "${targetAgent.name}" as the active triage agent?`)) {
                      try {
                        const response = await fetch(`${REACT_APP_API_URL}/v1/agents/activate`, {
                          method: 'POST',
                          headers: {
                            'Authorization': `Bearer ${REACT_APP_API_KEY}`,
                            'Content-Type': 'application/json',
                            'X-Source': 'ui'
                          },
                          body: JSON.stringify({
                            fingerprintHash: targetAgent.fingerprintHash,
                            reason: 'Quick-activation via triage dashboard warning banner override.'
                          })
                        });
                        const resData = await response.json();
                        if (resData.success) {
                          alert(`Agent "${targetAgent.name}" activated successfully.`);
                          fetchStatus();
                          fetchAvailableAgents();
                        } else {
                          alert(`Activation failed: ${resData.error?.message || 'Unknown error'}`);
                        }
                      } catch (err: any) {
                        alert(`Activation failed: ${err.message}`);
                      }
                    }
                  }}
                  className="primary-btn"
                  style={{ background: 'var(--plasma-clinical-blue)', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
                >
                  ⚡ Enable {availableAgents[0].name}
                </button>
              )}
              <button 
                onClick={() => window.location.hash = 'governance'} 
                style={{ background: '#d97706', border: 'none', color: '#fff', padding: '6px 12px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, fontSize: '0.8rem' }}
              >
                Configure Agent
              </button>
            </div>
          </div>
        )}

        {triageStatus?.agent && triageStatus.state === 'degraded' && (
          <div className="agent-status-banner warning" style={{ marginTop: '16px', padding: '12px', background: 'rgba(245, 158, 11, 0.1)', border: '1px solid #f59e0b', borderRadius: '8px', color: '#b45309', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div><strong>⚠️ Standard Backup Active:</strong> Connection lag is occurring with the local AI agent. Acuity calculations are running safely on the clinical rule engine.</div>
            {triageStatus.details?.message && <div style={{ fontSize: '0.75rem', opacity: 0.85 }}>({triageStatus.details.message})</div>}
          </div>
        )}

        {triageStatus?.agent && triageStatus.state === 'anomaly_detected' && (
          <div className="agent-status-banner anomaly" style={{ marginTop: '16px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '8px', color: '#b91c1c', fontSize: '0.85rem', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div><strong>🚨 Compliance Alert:</strong> A model/provenance signature anomaly was detected on the active AI agent. Safe rules-based fallback is engaged.</div>
            {triageStatus.details?.message && <div style={{ fontSize: '0.75rem', fontWeight: 'bold' }}>Reason: {triageStatus.details.message}</div>}
          </div>
        )}

        {triageStatus?.agent && (!triageStatus.state || triageStatus.state === 'nominal') && (
          <div className="agent-status-banner success" style={{ marginTop: '16px', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px', color: '#10b981', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>✅ Active Agent Resolved:</strong> {triageStatus.agent.name} (v{triageStatus.agent.version})</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', opacity: 0.8 }}>{triageStatus.agent.fingerprintHash.substring(0, 16)}...</span>
          </div>
        )}

        {/* PHI Soft-Warning Banner — dismissible, never blocks workflow */}
        {phiScanWarning && (
          <div
            className="phi-warning-banner"
            role="alert"
            aria-live="polite"
            id="phi-warning-banner"
          >
            <div className="phi-warning-icon">🛡️</div>
            <div className="phi-warning-body">
              <strong>PHI Detected &amp; Masked</strong>
              <span className="phi-warning-detail">
                {phiScanWarning.matchCount} token{phiScanWarning.matchCount !== 1 ? 's' : ''} redacted
                {phiScanWarning.fieldsScanned.length > 0 && (
                  <> in <code>{phiScanWarning.fieldsScanned.join(', ')}</code></>  
                )}{' '}before the audit record was hashed.
                {phiScanWarning.source === 'encounter'
                  ? ' The encounter was logged with masked values.'
                  : ' The clinician note was logged with masked values.'}
              </span>
            </div>
            <button
              className="phi-warning-dismiss"
              aria-label="Dismiss PHI warning"
              id="phi-warning-dismiss-btn"
              onClick={() => setPhiScanWarning(null)}
            >
              ×
            </button>
          </div>
        )}
      </div>

      {/* ── New Encounter Form Panel ── */}
      {showNewForm && (
        <div className="new-encounter-panel">
          <div className="new-encounter-header">
            <h2>New Encounter</h2>
            <button className="drawer-close" onClick={() => setShowNewForm(false)}>×</button>
          </div>

          <div className="form-section">
            <label className="form-label">Chief Complaint *</label>
            <select className="form-select" value={form.chief_complaint}
              onChange={e => {
                const selected = e.target.value;
                setForm(f => {
                  const matchingFlagOption = RED_FLAG_OPTIONS.find(flag => flag.label === selected);
                  const updatedFlags = matchingFlagOption 
                    ? f.red_flags.filter(r => r !== matchingFlagOption.id)
                    : f.red_flags;
                  return { ...f, chief_complaint: selected, red_flags: updatedFlags };
                });
              }}>
              <option value="">Select…</option>
              {CHIEF_COMPLAINTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {form.chief_complaint !== '' && (
              <input className="form-input" style={{ marginTop: 8 }} 
                placeholder={form.chief_complaint === 'Other…' ? "Describe complaint..." : "Additional details (optional)..."}
                value={form.custom_complaint}
                onChange={e => setForm(f => ({ ...f, custom_complaint: e.target.value }))} />
            )}
          </div>

          <div className="form-section">
            <label className="form-label">Core Vitals *</label>
            <div className="vitals-input-grid">
              <div className="vital-input-box">
                <span className="vital-unit">HR</span>
                <input className="form-input tabular-nums" type="number" placeholder="72" value={form.hr} onChange={e => setForm(f => ({ ...f, hr: e.target.value }))} />
                <span className="vital-unit-suffix">bpm</span>
              </div>
              <div className="vital-input-box wide">
                <span className="vital-unit">BP</span>
                <div className="bp-input-wrapper">
                  <input className="form-input bp-sys" type="number" placeholder="120" value={form.bp_sys} onChange={e => setForm(f => ({ ...f, bp_sys: e.target.value }))} />
                  <span className="bp-divider">/</span>
                  <input className="form-input bp-dia" type="number" placeholder="80" value={form.bp_dia} onChange={e => setForm(f => ({ ...f, bp_dia: e.target.value }))} />
                </div>
                <span className="vital-unit-suffix">mmHg</span>
              </div>
              <div className="vital-input-box">
                <span className="vital-unit">RR</span>
                <input className="form-input tabular-nums" type="number" placeholder="16" value={form.rr} onChange={e => setForm(f => ({ ...f, rr: e.target.value }))} />
                <span className="vital-unit-suffix">/min</span>
              </div>
              <div className="vital-input-box">
                <span className="vital-unit">SpO₂</span>
                <input className="form-input tabular-nums" type="number" placeholder="98" value={form.spo2} onChange={e => setForm(f => ({ ...f, spo2: e.target.value }))} />
                <span className="vital-unit-suffix">%</span>
              </div>
            </div>
          </div>

          <div className="progressive-toggle" onClick={() => setShowExtendedVitals(!showExtendedVitals)}>
            {showExtendedVitals ? '− Hide Extended Vitals' : '+ Add Extended Vitals (Temp, Pain, Glucose…)'}
          </div>

          {showExtendedVitals && (
            <div className="form-section extended-vitals-section">
              <div className="vitals-input-grid secondary">
                <div className="vital-input-box">
                  <span className="vital-unit">Temp</span>
                  <input className="form-input tabular-nums" type="number" step="0.1" placeholder="37.0" value={form.temp} onChange={e => setForm(f => ({ ...f, temp: e.target.value }))} />
                  <span className="vital-unit-suffix">°C</span>
                </div>
                <div className="vital-input-box" style={painInputConflict ? { border: '1px solid #f59e0b', boxShadow: '0 0 8px rgba(245, 158, 11, 0.4)' } : undefined}>
                  <span className="vital-unit">Pain</span>
                  <input className="form-input tabular-nums" type="number" min="0" max="10" placeholder="0" value={form.pain_score} onChange={e => {
                    setForm(f => ({ ...f, pain_score: e.target.value }));
                    if (Number(e.target.value) > 0) {
                      setPainInputConflict(false);
                      setValidationWarning(null);
                    }
                  }} />
                  <span className="vital-unit-suffix">/10</span>
                </div>
                <div className="vital-input-box">
                  <span className="vital-unit">Glu</span>
                  <input className="form-input tabular-nums" type="number" step="0.1" placeholder="5.5" value={form.glucose_mmol} onChange={e => setForm(f => ({ ...f, glucose_mmol: e.target.value }))} />
                  <span className="vital-unit-suffix">mmol</span>
                </div>
                <div className="vital-input-box">
                  <span className="vital-unit">Wt</span>
                  <input className="form-input tabular-nums" type="number" placeholder="70" value={form.weight_kg} onChange={e => setForm(f => ({ ...f, weight_kg: e.target.value }))} />
                  <span className="vital-unit-suffix">kg</span>
                </div>
              </div>
            </div>
          )}

          <div className="form-section">
            <label className="form-label" onClick={() => setShowHistory(!showHistory)} style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between' }}>
              Relevant History (SAMPLE)
              <span style={{ fontSize: '0.8rem', opacity: 0.6 }}>{showHistory ? 'Collapse' : 'Expand'}</span>
            </label>
            {showHistory && (
              <div className="history-form-grid">
                <div className="history-field">
                  <span className="history-label">Allergies</span>
                  <input className="form-input" placeholder="NKDA, Penicillin..." value={form.history.allergies} onChange={e => setForm(f => ({ ...f, history: { ...f.history, allergies: e.target.value } }))} />
                </div>
                <div className="history-field">
                  <span className="history-label">Medications</span>
                  <input className="form-input" placeholder="Aspirin, Metformin..." value={form.history.medications} onChange={e => setForm(f => ({ ...f, history: { ...f.history, medications: e.target.value } }))} />
                </div>
                <div className="history-field">
                  <span className="history-label">PMH</span>
                  <input className="form-input" placeholder="HTN, Diabetes..." value={form.history.pmh} onChange={e => setForm(f => ({ ...f, history: { ...f.history, pmh: e.target.value } }))} />
                </div>
              </div>
            )}
          </div>

          <div className="form-section">
            <label className="form-label">Patient Demographics *</label>
            <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr', gap: '12px', marginBottom: '10px' }}>
              <input className="form-input" type="number" placeholder="Age"
                value={form.age_years} onChange={e => setForm(f => ({ ...f, age_years: e.target.value }))} />
              <select className="form-select" value={form.sex_at_birth}
                onChange={e => setForm(f => ({ ...f, sex_at_birth: e.target.value as any }))}>
                <option value="">Sex at Birth…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
                <option value="intersex">Intersex</option>
                <option value="unknown">Unknown</option>
              </select>
            </div>
            <input className="form-input" placeholder="Gender Identity (Optional e.g. non-binary)"
              value={form.gender_identity} onChange={e => setForm(f => ({ ...f, gender_identity: e.target.value }))} />
          </div>

          <div className="form-section">
            <label className="form-label">Red Flags</label>
            <div className="flag-checkboxes">
              {(() => {
                const resolvedComplaint = form.chief_complaint === 'Other…' 
                  ? form.custom_complaint 
                  : (form.custom_complaint ? `${form.chief_complaint} (${form.custom_complaint})` : form.chief_complaint);
                const normalizedComplaint = resolvedComplaint?.trim().toLowerCase();
                return RED_FLAG_OPTIONS
                  .filter(flag => flag.label.toLowerCase() !== normalizedComplaint)
                  .map(flag => (
                    <label key={flag.id} className="flag-label">
                      <input type="checkbox" checked={form.red_flags.includes(flag.id)}
                        onChange={() => toggleRedFlag(flag.id)} />
                      {flag.label}
                    </label>
                  ));
              })()}
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Clinician Name</label>
            <input className="form-input" placeholder="Dr. Smith" value={form.clinician_name}
              onChange={e => setForm(f => ({ ...f, clinician_name: e.target.value }))} />
          </div>

          {validationWarning && (
            <div style={{
              background: validationWarningType === 'infrastructure_degraded' ? 'rgba(154, 166, 189, 0.08)' : 'rgba(245, 158, 11, 0.1)',
              border: validationWarningType === 'infrastructure_degraded' ? '1px solid var(--plasma-border)' : '1px solid #f59e0b',
              borderRadius: '8px',
              padding: '12px',
              color: validationWarningType === 'infrastructure_degraded' ? 'var(--plasma-text-secondary)' : '#fbbf24',
              fontSize: '0.82rem',
              lineHeight: 1.4,
              marginBottom: '16px',
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div>
                <strong>{validationWarningType === 'infrastructure_degraded' ? '🤖 AI Verification Unavailable' : '⚠️ Clinical Contradiction Detected'}</strong>: {validationWarning}
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.78rem', cursor: 'pointer', color: validationWarningType === 'infrastructure_degraded' ? 'var(--plasma-text-muted)' : '#fbbf24', fontWeight: 600 }}>
                <input 
                  type="checkbox" 
                  checked={bypassSafety} 
                  onChange={(e) => setBypassSafety(e.target.checked)} 
                />
                Confirm Pain Score of 0/10 is correct (Bypass Warning)
              </label>
            </div>
          )}

          <button
            className="submit-btn"
            disabled={submitting || preAuditLoading || !form.chief_complaint || (form.chief_complaint === 'Other…' && !form.custom_complaint.trim()) || !form.hr || !form.bp_sys || !form.bp_dia || !form.age_years || !form.sex_at_birth}
            onClick={submitEncounter}
            aria-busy={submitting || preAuditLoading}
          >
            {submitting || preAuditLoading ? (
              <span className="btn-loading-container">
                <span className="spinner btn-spinner" aria-hidden="true" />
                <span>{preAuditLoading ? 'Analyzing Presentation…' : 'Running AI Triage…'}</span>
              </span>
            ) : '→ Submit & Triage'}
          </button>
        </div>
      )}

      {/* ── Triage Queue Table ── */}
      <div className="triage-table-container" style={{ overflowX: 'auto', width: '100%', borderRadius: '8px', border: '1px solid var(--border-light)', background: 'var(--bg-card)' }}>
        <table className="triage-queue" style={{ margin: 0, borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>Acuity</th>
            <th>Encounter ID</th>
            <th>Arrival Time</th>
            <th>Chief Complaint</th>
            <th>Vitals (H/B/R/S)</th>
            <th>Status</th>
            <th>Integrity</th>
          </tr>
        </thead>
        <tbody>
          {encounters.map(enc => (
            <tr key={enc.encounter_id}
              className={`triage-row${enc.integrity.tamper_status === 'tampered' ? ' row-tampered' : ''}`}
              onClick={() => { setSelectedEncounter(enc); setSecurityExpanded(false); }}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <div style={{ 
                    width: '10px', 
                    height: '10px', 
                    borderRadius: '50%', 
                    background: getAcuityColor(enc.clinical?.clinician_acuity || enc.clinical?.ai_recommendation?.acuity || enc.clinical?.acuity || 0) 
                  }} />
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>
                      Level {enc.clinical?.clinician_acuity || enc.clinical?.ai_recommendation?.acuity || enc.clinical?.acuity || '-'}
                    </span>
                    {enc.clinical?.clinician_acuity && (
                      <span className="status-pill status-critical" style={{ fontSize: '0.6rem', marginTop: '4px', padding: '2px 8px' }}>
                        Clinician Override
                      </span>
                    )}
                  </div>
                </div>
              </td>
              <td style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                {enc.source === 'live'
                  ? <span className="live-badge">● Live</span>
                  : <span className="scenario-badge">● Sim</span>}
                {' '}{enc.encounter_id.substring(0, 20)}…
              </td>
              <td>{new Date(enc.arrival_time).toLocaleTimeString()}</td>
              <td style={{ fontWeight: 600 }}>{enc.clinical.chief_complaint}</td>
              <td style={{ fontSize: '0.85rem' }} className="tabular-nums">
                {enc.clinical.vitals.hr} / {enc.clinical.vitals.bp_sys}/{enc.clinical.vitals.bp_dia} / {enc.clinical.vitals.rr} / {enc.clinical.vitals.spo2}%
              </td>
              <td style={{ textTransform: 'capitalize' }}>
                <div 
                  className={`status-pill status-${enc.clinical?.state}`}
                  title={enc.clinical?.state === 'in_progress' ? "In Progress: AI recommendation logged; awaiting clinician decision or further action." : ""}
                >
                  {enc.clinical?.state?.replace('_', ' ')}
                </div>
              </td>
              <td>{getIntegrityIcon(enc.integrity.tamper_status)}</td>
            </tr>
          ))}
          {encounters.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '60px', color: 'var(--text-secondary)' }}>
              No patients in queue. Click <strong>+ New Encounter</strong> to add one.
            </td></tr>
          )}
          {loading && (
            <tr>
              <td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                  <span className="spinner" aria-hidden="true" style={{ borderColor: 'rgba(255,255,255,0.1)', borderTopColor: 'var(--plasma-clinical-blue)' }} />
                  <span>Loading queue…</span>
                </div>
              </td>
            </tr>
          )}
        </tbody>
      </table>
      </div>

      {/* ── Drawer Overlay ── */}
      <div className={`drawer-overlay ${selectedEncounter ? 'open' : ''}`} onClick={() => { setSelectedEncounter(null); setChangingDecision(false); }} />

      {/* ── Encounter Detail Drawer ── */}
      <div className={`encounter-drawer ${selectedEncounter ? 'open' : ''}`}>
        {selectedEncounter && (
          <>
            <div className="drawer-header">
              <div>
                <h2>{selectedEncounter.clinical?.chief_complaint}</h2>
                <div style={{ color: '#8c9bb4', fontSize: '0.85rem', marginTop: '5px', fontFamily: 'monospace' }}>
                  {selectedEncounter.encounter_id}
                </div>
              </div>
              <button className="drawer-close" onClick={() => setSelectedEncounter(null)}>×</button>
            </div>

            <div className="drawer-content">
              {/* Acuity badge */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '30px' }}>
                <div style={{ 
                  width: '32px', 
                  height: '32px', 
                  borderRadius: '50%', 
                  background: getAcuityColor(selectedEncounter.clinical?.clinician_acuity || selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || 0),
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#fff',
                  fontWeight: 800,
                  fontSize: '1.1rem',
                  boxShadow: '0 4px 10px rgba(0,0,0,0.3)'
                }}>
                  {selectedEncounter.clinical?.clinician_acuity || selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || '-'}
                </div>
                <div>
                  <div style={{ color: '#8c9bb4', fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '2px' }}>
                    {selectedEncounter.clinical?.clinician_acuity ? 'Manual Assigned Acuity' : 'AI Predicted Triage'}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <div style={{ fontWeight: 700, fontSize: '1.2rem' }}>
                      Level {selectedEncounter.clinical?.clinician_acuity || selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || '-'}
                    </div>
                    {selectedEncounter.clinical?.clinician_acuity && (
                      <span className="status-pill status-critical" style={{ fontSize: '0.65rem', padding: '2px 10px' }}>
                        Clinician Override
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Vitals */}
              <h3>Current Vitals</h3>
              {/* Patient Context Block */}
              <div className="patient-context-grid-v2">
                <div className="context-item">
                  <span className="context-label">Age</span>
                  <span className="context-value">{selectedEncounter.clinical?.patient_context?.demographics?.age_years ?? selectedEncounter.clinical?.age}</span>
                </div>
                <div className="context-item">
                  <span className="context-label">Sex at Birth</span>
                  <span className="context-value" style={{ textTransform: 'capitalize' }}>
                    {selectedEncounter.clinical?.patient_context?.demographics?.sex_at_birth ?? selectedEncounter.clinical?.gender}
                  </span>
                </div>
                {selectedEncounter.clinical?.patient_context?.demographics?.gender_identity && (
                  <div className="context-item">
                    <span className="context-label">Gender Identity</span>
                    <span className="context-value">{selectedEncounter.clinical?.patient_context?.demographics?.gender_identity}</span>
                  </div>
                )}
              </div>

              <div className="vitals-grid">
                <div className="vital-card">
                  <div className="vital-label">Heart Rate</div>
                  <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.hr} <small className="unit">bpm</small></div>
                </div>
                <div className="vital-card">
                  <div className="vital-label">Blood Pressure</div>
                  <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.bp_sys}/{selectedEncounter.clinical.vitals.bp_dia} <small className="unit">mmHg</small></div>
                </div>
                <div className="vital-card">
                  <div className="vital-label">Resp. Rate</div>
                  <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.rr} <small className="unit">/min</small></div>
                </div>
                <div className="vital-card">
                  <div className="vital-label">SpO2</div>
                  <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.spo2}%</div>
                </div>
              </div>

              {/* Extended Vitals (Row 2) */}
              {(selectedEncounter.clinical.vitals.temp || selectedEncounter.clinical.vitals.glucose_mmol || selectedEncounter.clinical.vitals.pain_score !== undefined) && (
                <div className="vitals-grid extended" style={{ marginTop: '10px' }}>
                  {selectedEncounter.clinical.vitals.temp && (
                    <div className="vital-card secondary">
                      <div className="vital-label">Temp</div>
                      <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.temp.toFixed(1)}°C <small className="unit">({selectedEncounter.clinical.vitals.temp_method || 'o'})</small></div>
                    </div>
                  )}
                  {selectedEncounter.clinical.vitals.pain_score !== undefined && (
                    <div className="vital-card secondary">
                      <div className="vital-label">Pain</div>
                      <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.pain_score}/10</div>
                    </div>
                  )}
                  {selectedEncounter.clinical.vitals.glucose_mmol && (
                    <div className="vital-card secondary">
                      <div className="vital-label">Glucose</div>
                      <div className="vital-value tabular-nums">{selectedEncounter.clinical.vitals.glucose_mmol} <small className="unit">mmol</small></div>
                    </div>
                  )}
                  {selectedEncounter.clinical.vitals.avpu && (
                    <div className="vital-card secondary">
                      <div className="vital-label">AVPU</div>
                      <div className="vital-value">{selectedEncounter.clinical.vitals.avpu}</div>
                    </div>
                  )}
                </div>
              )}

              {/* Relevant History (SAMPLE) */}
              <div className="history-drawer-section">
                <h3>Relevant History</h3>
                <div className="history-grid">
                  <div className="history-item">
                    <span className="history-label">Allergies</span>
                    <span className="history-value">{selectedEncounter.clinical.history?.allergies?.length ? selectedEncounter.clinical.history.allergies.join(', ') : 'None known'}</span>
                  </div>
                  <div className="history-item">
                    <span className="history-label">Medications</span>
                    <span className="history-value">{selectedEncounter.clinical.history?.medications?.length ? selectedEncounter.clinical.history.medications.join(', ') : 'None'}</span>
                  </div>
                  <div className="history-item">
                    <span className="history-label">PMH</span>
                    <span className="history-value">{selectedEncounter.clinical.history?.pmh?.length ? selectedEncounter.clinical.history.pmh.join(', ') : 'None'}</span>
                  </div>
                </div>
              </div>

              {/* AI Recommendation Panel — shown only for live encounters with AI data */}
              {selectedEncounter.clinical?.ai_recommendation && (
                <div className={`ai-recommendation-card acuity-border-${selectedEncounter.clinical.ai_recommendation.acuity}`}>
                  <div className="ai-rec-header">
                    <span>🤖 AI Triage Recommendation</span>
                    <span className="provider-badge">
                      {selectedEncounter.clinical?.ai_provider === 'ollama' 
                        ? (triageStatus?.agent?.name || 'Qwen') 
                        : (selectedEncounter.clinical?.ai_provider || 'rules')}
                    </span>
                  </div>
                  <div className="ai-acuity-line">
                    Acuity <strong>{selectedEncounter.clinical.ai_recommendation.acuity}</strong>
                    {' — '}{ACUITY_LABELS[selectedEncounter.clinical.ai_recommendation.acuity]}
                  </div>
                  <ul className="ai-reasons">
                    {selectedEncounter.clinical.ai_recommendation.reasons.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>

                  {/* Action buttons or decision badge */}
                  {(!selectedEncounter.clinician_action || changingDecision) ? (
                    <>
                    {changingDecision && (
                      <div className="amendment-reason-form">
                        <label className="amendment-label">Reason for Amendment</label>
                        <select 
                          className="amendment-select"
                          value={amendmentReason}
                          onChange={(e) => setAmendmentReason(e.target.value)}
                        >
                          {AMENDMENT_REASONS.map(r => (
                            <option key={r.id} value={r.id}>{r.label}</option>
                          ))}
                        </select>
                        <textarea 
                          className="amendment-textarea"
                          placeholder="Add clinical context (optional)..."
                          value={amendmentNote}
                          onChange={(e) => setAmendmentNote(e.target.value)}
                        />
                      </div>
                    )}
                    <div className="action-btn-group">
                      <button className="action-btn action-accept"
                        disabled={!!actionLoading || pendingAction !== null}
                        onClick={() => dispatchAction('accepted', selectedEncounter.clinical?.ai_recommendation?.acuity)}
                        aria-busy={actionLoading === 'accepted'}
                      >
                        {actionLoading === 'accepted' ? (
                          <span className="btn-loading-container">
                            <span className="spinner btn-spinner" aria-hidden="true" />
                            <span>Accepting…</span>
                          </span>
                        ) : '✓ Accept'}
                      </button>
                      <button className="action-btn action-downgrade"
                        disabled={!!actionLoading || pendingAction !== null}
                        onClick={() => setPendingAction('downgraded')}
                        aria-busy={actionLoading === 'downgraded'}
                      >
                        {actionLoading === 'downgraded' ? (
                          <span className="btn-loading-container">
                            <span className="spinner btn-spinner" aria-hidden="true" />
                            <span>Downgrading…</span>
                          </span>
                        ) : '↓ Downgrade'}
                      </button>
                      <button className="action-btn action-escalate"
                        disabled={!!actionLoading || pendingAction !== null}
                        onClick={() => setPendingAction('escalated')}
                        aria-busy={actionLoading === 'escalated'}
                      >
                        {actionLoading === 'escalated' ? (
                          <span className="btn-loading-container">
                            <span className="spinner btn-spinner" aria-hidden="true" />
                            <span>Escalating…</span>
                          </span>
                        ) : '↑ Escalate'}
                      </button>
                    </div>
                    {pendingAction && (
                      <div className="acuity-selector" style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                        <div style={{ marginBottom: '10px', fontSize: '0.9rem', color: '#ccc' }}>
                          Select new Acuity Level ({pendingAction}):
                        </div>

                        {pendingAction === 'downgraded' && hasCriticalWarning && (
                          <div className="sae-safety-alert" style={{ marginBottom: '15px' }}>
                            <h4>⚠️ EMERGENCY CLINICAL OVERRIDE DETECTED</h4>
                            <p>
                              The Sparse Autoencoder (SAE) has detected active high-priority clinical threat concepts in the residual stream (Layer 9) at strength &ge; 0.5. Downgrading acuity under these conditions represents extreme clinical risk.
                            </p>
                            <ul className="sae-safety-alert-list">
                              {criticalFeatures.map((feat: any) => (
                                <li key={feat.index}>
                                  <strong>F#{feat.index} ({feat.name})</strong>: Strength {feat.strength.toFixed(3)}
                                </li>
                              ))}
                            </ul>
                            <label className="safety-bypass-label">
                              <input
                                type="checkbox"
                                className="safety-bypass-checkbox"
                                checked={bypassSafety}
                                onChange={(e) => setBypassSafety(e.target.checked)}
                              />
                              <span>I acknowledge the active life-threat concepts and confirm this manual override is clinically justified.</span>
                            </label>
                          </div>
                        )}

                        <div style={{ display: 'flex', gap: '8px' }}>
                          {[1, 2, 3, 4, 5].map(level => {
                            const aiLevel = selectedEncounter.clinical?.ai_recommendation?.acuity || 3;
                            const referenceLevel = (changingDecision && selectedEncounter.clinical?.clinician_acuity)
                              ? selectedEncounter.clinical.clinician_acuity
                              : aiLevel;
                            const isValid = pendingAction === 'downgraded' ? level > referenceLevel : level < referenceLevel;
                            
                            // Check if this level is a restricted downgrade relative to the original AI recommendation
                            const isDowngrade = level > aiLevel;
                            const isRestrictedDowngrade = pendingAction === 'downgraded' && isDowngrade && hasCriticalWarning && !bypassSafety;
                            const isBtnDisabled = !isValid || isRestrictedDowngrade || !!actionLoading;

                            return (
                              <button
                                key={level}
                                disabled={isBtnDisabled}
                                onClick={() => dispatchAction(pendingAction, level)}
                                className={`acuity-badge acuity-${level}`}
                                style={{ 
                                  width: 40, 
                                  height: 40, 
                                  opacity: isBtnDisabled ? 0.3 : 1, 
                                  cursor: isBtnDisabled ? 'not-allowed' : 'pointer', 
                                  border: 'none',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  justifyContent: 'center'
                                }}
                                title={isBtnDisabled ? (isRestrictedDowngrade ? 'Requires active emergency bypass confirmation' : `Invalid for ${pendingAction}`) : `Assign Acuity ${level}`}
                                aria-busy={actionLoading === pendingAction}
                              >
                                {actionLoading === pendingAction ? (
                                  <span className="spinner" aria-hidden="true" style={{ width: '14px', height: '14px', borderWidth: '1.5px' }} />
                                ) : level}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {changingDecision && (
                      <button className="cancel-amendment-btn" onClick={() => {
                        setChangingDecision(false);
                        setPendingAction(null);
                        setAmendmentReason('initial_decision');
                        setAmendmentNote('');
                      }}>Cancel</button>
                    )}
                    </>
                  ) : (
                    <>
                    <div className="decision-block">
                      <div className="action-taken-badge">
                        <span className="decision-label">Clinician decision logged</span>
                        <span className="decision-value" style={{ textTransform: 'capitalize' }}>{selectedEncounter.clinician_action}</span>
                      </div>
                    </div>
                    {lastActionResult?.is_amendment && (
                      <div className="amendment-note">
                        ℹ️ Amendment logged. Original record preserved in audit trail.
                      </div>
                    )}
                    <button className="change-decision-link" onClick={() => setChangingDecision(true)}>
                      {selectedEncounter.integrity.anchored_to_chain
                        ? 'Amend decision (new event)'
                        : 'Change decision'}
                    </button>
                    </>
                  )}

                  {/* Decision History Timeline */}
                  {selectedEncounter.decision_history && selectedEncounter.decision_history.length > 0 && (
                    <div className="decision-history">
                      <div className="history-header">
                        <div className="history-title">Decision History</div>
                        <button 
                          className="proof-toggle-btn"
                          onClick={() => setShowTechnicalProofs(!showTechnicalProofs)}
                        >
                          {showTechnicalProofs ? 'Technical Proofs' : 'Show Proofs'}
                        </button>
                      </div>
                      <div className="history-timeline">
                        {selectedEncounter.decision_history.map((h, i) => (
                          <div key={i} className="history-item-v2">
                            <div className="history-main-line">
                              <span className="history-anchored">{h.anchored ? '🔗' : '⏳'}</span>
                              <span className="history-time">{new Date(h.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                              <span className="history-action-v2">{h.action}</span>
                            </div>
                            
                            {h.reason_code && h.reason_code !== 'initial_decision' && (
                              <div className="history-reason-badge">
                                Reason: <strong>{AMENDMENT_REASONS.find(r => r.id === h.reason_code)?.label || h.reason_code}</strong>
                              </div>
                            )}
                            
                            {h.reason_text && <div className="history-text-note">"{h.reason_text}"</div>}
                            
                            {showTechnicalProofs && (
                              <div className="history-technical-proof">
                                Fingerprint: <code>{h.event_hash.substring(0, 14)}...</code>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* AI Latent Concept Audit Panel (Phase 3) */}
              {selectedEncounter.clinical?.ai_recommendation && (
                <div className="sae-concept-panel latent-audit">
                  <div className="sae-concept-header">
                    <h3 className="sae-concept-title">
                      <span className="sae-concept-title-icon">🧠</span> AI Latent Concept Audit (Layer 9)
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="sae-concept-meta">
                        Sparsity: {saeData?.active_features?.length ?? 0} active
                      </span>
                      <button 
                        className="proof-toggle-btn"
                        onClick={() => setShowSaeTechnical(!showSaeTechnical)}
                        style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '12px' }}
                      >
                        {showSaeTechnical ? 'Hide Technical Trail' : 'Show Technical Trail'}
                      </button>
                    </div>
                  </div>

                  {saeLoading && (
                    <div className="sae-loading-state">
                      <div className="sae-spinner" />
                      <div>Extracting residual stream activations at Layer 9...</div>
                    </div>
                  )}

                  {saeError && (
                    <div className="sae-error-alert">
                      ⚠️ {saeError}
                    </div>
                  )}

                  {!saeLoading && !saeError && saeData && saeData.active_features && (
                    <div className="sae-feature-list">
                      {/* 1. Primary Alarm View: Surface only critical 'smoke detectors' */}
                      {(() => {
                        const criticalAlerts = saeData.active_features.filter(
                          (feat: any) => feat.category === 'Critical' || feat.priority === 'High'
                        );

                        if (criticalAlerts.length > 0) {
                          return (
                            <div className="sae-critical-alerts-container">
                              {criticalAlerts.map((feat: any) => (
                                <div key={feat.index} className="sae-alert-card critical">
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                                    <span className="sae-alert-title-critical">
                                      🚨 {feat.name}
                                    </span>
                                    <span className="sae-alert-badge-critical">
                                      {(feat.strength * 100).toFixed(1)}% activation
                                    </span>
                                  </div>
                                  <div className="sae-alert-desc-critical">
                                    {feat.description}
                                  </div>
                                </div>
                              ))}
                            </div>
                          );
                        } else {
                          return (
                            <div className="sae-alert-card safe">
                              <span className="sae-alert-title-safe">
                                <span style={{ fontSize: '1.2rem' }}>✓</span>
                                <span>No Latent Threat Detected: Residual stream concepts are within standard clinical bounds.</span>
                              </span>
                            </div>
                          );
                        }
                      })()}

                      {/* 2. Technical Audit Trail: Complete roster of all activations (Clinical, Cognitive, Structural, etc.) */}
                      {showSaeTechnical && (
                        <div className="sae-technical-audit-trail">
                          <h4 className="sae-technical-header">
                            <span>Neural Activation & Concept Roster</span>
                            <span style={{ fontSize: '0.7rem', color: '#a78bfa', fontFamily: 'monospace' }}>Layer 9 (Residual Stream)</span>
                          </h4>
                          
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                            {saeData.active_features.length === 0 ? (
                              <div style={{ color: 'var(--text-secondary)', padding: '10px 0', textAlign: 'center', fontSize: '0.8rem' }}>
                                No active neural features detected.
                              </div>
                            ) : (() => {
                              const categorizedFeatures = {
                                Critical: saeData.active_features.filter((f: any) => f.category === 'Critical'),
                                Clinical: saeData.active_features.filter((f: any) => f.category === 'Clinical'),
                                Cognitive: saeData.active_features.filter((f: any) => f.category === 'Cognitive'),
                                Structural: saeData.active_features.filter((f: any) => f.category === 'Structural' || (!f.category && f.index))
                              };
                              return Object.entries(categorizedFeatures).map(([category, list]) => {
                                if (list.length === 0) return null;
                                return (
                                  <div key={category} className="sae-category-section">
                                    <h5 style={{
                                      fontSize: '0.75rem',
                                      textTransform: 'uppercase',
                                      letterSpacing: '0.05em',
                                      color: category === 'Critical' ? 'var(--plasma-integrity-red)' : category === 'Clinical' ? 'var(--plasma-warning-amber)' : category === 'Cognitive' ? 'var(--plasma-clinical-blue)' : 'var(--plasma-text-muted)',
                                      margin: '0 0 10px 0',
                                      display: 'flex',
                                      alignItems: 'center',
                                      gap: '8px',
                                      fontWeight: 700
                                    }}>
                                      <span>
                                        {category === 'Critical' ? '🚨' : category === 'Clinical' ? '🩺' : category === 'Cognitive' ? '🧠' : '🏗️'}
                                      </span>
                                      <span>{category} Features</span>
                                      <span className="sae-category-count">
                                        {list.length}
                                      </span>
                                    </h5>
                                    
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                      {[...list]
                                        .sort((a, b) => b.strength - a.strength)
                                        .map((feat: any) => (
                                          <div key={feat.index} className="sae-feature-row">
                                            <div className="sae-feature-top">
                                              <div className="sae-feature-identity">
                                                <span className="sae-feature-index">F#{feat.index}</span>
                                                <span className="sae-feature-name">{feat.name}</span>
                                              </div>
                                              <span className={`sae-badge ${feat.category ? feat.category.toLowerCase() : 'structural'}`}>
                                                {feat.category || 'Structural'}
                                              </span>
                                            </div>
                                            
                                            <p className="sae-feature-desc">{feat.description}</p>
                                            
                                            <div className="sae-feature-metrics">
                                              <div className="sae-progress-container">
                                                <div className="sae-progress-track">
                                                  <div className="sae-progress-bar" style={{
                                                    width: `${Math.min(100, feat.strength * 100)}%`,
                                                    backgroundColor: getFeatureColor(feat.category || 'Structural')
                                                  }} />
                                                </div>
                                                <span className="sae-feature-strength-val">
                                                  {(feat.strength * 100).toFixed(1)}%
                                                </span>
                                              </div>
                                              <div className={`sae-priority ${feat.priority ? feat.priority.toLowerCase() : 'low'}`}>
                                                <span className="sae-priority-dot" />
                                                <span style={{ fontSize: '0.7rem' }}>{feat.priority || 'Low'}</span>
                                              </div>
                                            </div>

                                            <div className="sae-feature-raw-metrics">
                                              <div><span style={{ opacity: 0.5 }}>Raw Float:</span> <span style={{ color: 'var(--plasma-integrity-green)' }}>{feat.strength.toFixed(5)}</span></div>
                                              <div><span style={{ opacity: 0.5 }}>Residual Val:</span> <span style={{ color: 'var(--plasma-clinical-blue)' }}>{(feat.strength * 1.428).toFixed(5)}</span></div>
                                            </div>
                                          </div>
                                        ))}
                                    </div>
                                  </div>
                                );
                              });
                            })()}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Semantic Embedding Alignment Panel */}
              {selectedEncounter.clinical?.ai_recommendation && (
                <div className="sae-concept-panel semantic-audit" style={{ marginTop: '20px' }}>
                  <div className="sae-concept-header">
                    <h3 className="sae-concept-title">
                      <span className="sae-concept-title-icon">✨</span> Semantic Embedding Alignment
                    </h3>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span className="sae-concept-meta">
                        Floor: {semanticData ? `${(semanticData.threshold * 100).toFixed(0)}%` : '--%'}
                      </span>
                      <button 
                        className="proof-toggle-btn"
                        onClick={() => setShowSemanticTechnical(!showSemanticTechnical)}
                        style={{ fontSize: '0.7rem', padding: '3px 8px', borderRadius: '12px' }}
                      >
                        {showSemanticTechnical ? 'Hide Technical Trail' : 'Show Technical Trail'}
                      </button>
                    </div>
                  </div>

                  {semanticLoading && (
                    <div className="semantic-loading-state">
                      <div className="semantic-spinner" />
                      <div>Extracting active model embeddings and calculating cosine similarity...</div>
                    </div>
                  )}

                  {semanticError && (
                    <div className="sae-error-alert">
                      ⚠️ {semanticError}
                    </div>
                  )}

                  {!semanticLoading && !semanticError && semanticData && (
                    <div className="semantic-audit-container" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                      
                      {/* Metric Gauge & Alert Cards */}
                      {semanticData.status === 'aligned' ? (
                        <div className="semantic-aligned-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="semantic-aligned-title">
                              ✅ Semantic Alignment Confirmed
                            </span>
                            <span className="semantic-aligned-badge">
                              {(semanticData.similarity * 100).toFixed(1)}% similarity
                            </span>
                          </div>
                          
                          {/* Progress bar visual indicator */}
                          <div className="sae-progress-container" style={{ margin: '4px 0 0 0' }}>
                            <div className="sae-progress-track" style={{ borderRadius: '4px', height: '6px' }}>
                              <div className="sae-progress-bar" style={{
                                width: `${semanticData.similarity * 100}%`,
                                backgroundColor: '#10b981',
                                borderRadius: '4px',
                                boxShadow: '0 0 8px #10b981'
                              }} />
                            </div>
                          </div>

                          <div className="semantic-aligned-desc">
                            Model representation aligns securely with ESI-{(selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || 3)} emergent guidelines. Cognitive integrity verified.
                          </div>
                        </div>
                      ) : (
                        <div className="semantic-mismatch-card">
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span className="semantic-mismatch-title">
                              ⚠️ Semantic Mismatch Detected
                            </span>
                            <span className="semantic-mismatch-badge">
                              {(semanticData.similarity * 100).toFixed(1)}% similarity
                            </span>
                          </div>
                          
                          {/* Progress bar visual indicator */}
                          <div className="sae-progress-container" style={{ margin: '4px 0 0 0' }}>
                            <div className="sae-progress-track" style={{ borderRadius: '4px', height: '6px' }}>
                              <div className="sae-progress-bar" style={{
                                width: `${semanticData.similarity * 100}%`,
                                backgroundColor: '#ef4444',
                                borderRadius: '4px',
                                boxShadow: '0 0 8px #ef4444'
                              }} />
                            </div>
                          </div>

                          <div className="semantic-mismatch-desc">
                            Critical Warning: The model's internal concept representation has drifted below the required floor of {(semanticData.threshold * 100).toFixed(0)}% for ESI-{(selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || 3)}. Cognitive drift or anomalous triage suspected.
                          </div>
                        </div>
                      )}

                      {/* Rule Conflict Indicator: surfaces divergence between AI output and clinical rules engine */}
                      {(() => {
                        const aiAcuity = selectedEncounter.clinical?.ai_recommendation?.acuity;
                        const rulesAcuity = selectedEncounter.clinical?.rules_recommendation?.acuity;
                        const divergence = selectedEncounter.clinical?.acuity_divergence;
                        const rulesReasons = selectedEncounter.clinical?.rules_recommendation?.reasons || [];
                        const semanticScore = semanticData?.similarity;

                        // Only render when we have both values and they differ
                        if (aiAcuity == null || rulesAcuity == null || divergence == null || divergence === 0) return null;

                        // Classify severity:
                        // divergence ≥ 2 + high semantic = most dangerous (silent failure)
                        // divergence ≥ 2 + low semantic  = both signals flagging (more detectable)
                        // divergence = 1                 = minor discrepancy
                        const isSilentFailure = divergence >= 2 && semanticScore != null && semanticScore >= 0.70;
                        const isSignificant = divergence >= 2;

                        const borderColor = isSilentFailure ? 'rgba(251, 191, 36, 0.5)' : isSignificant ? 'rgba(239, 68, 68, 0.35)' : 'rgba(251, 191, 36, 0.2)';
                        const bgColor = isSilentFailure ? 'linear-gradient(135deg, rgba(251,191,36,0.10) 0%, rgba(239,68,68,0.06) 100%)' : isSignificant ? 'linear-gradient(135deg, rgba(239,68,68,0.10) 0%, rgba(239,68,68,0.04) 100%)' : 'linear-gradient(135deg, rgba(251,191,36,0.07) 0%, rgba(0,0,0,0) 100%)';
                        const labelColor = isSilentFailure ? '#fde68a' : isSignificant ? '#fca5a5' : '#fef3c7';
                        const icon = isSilentFailure ? '⚡' : isSignificant ? '🔴' : '🟡';
                        const label = isSilentFailure
                          ? 'Silent Failure Risk — High Semantic + Logic Conflict'
                          : isSignificant
                          ? 'Significant Rule Conflict Detected'
                          : 'Minor Rule Discrepancy';

                        const conflictCardClass = isSilentFailure 
                          ? 'semantic-conflict-card silent-failure' 
                          : isSignificant 
                          ? 'semantic-conflict-card significant-conflict' 
                          : 'semantic-conflict-card minor-discrepancy';

                        return (
                          <div className={conflictCardClass}>
                            {/* Header row */}
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <span className="conflict-title">
                                {icon} {label}
                              </span>
                              <span className="conflict-badge">
                                Δ{divergence} level{divergence !== 1 ? 's' : ''}
                              </span>
                            </div>

                            {/* Acuity comparison */}
                            <div className="conflict-comparison-grid">
                              <div className="conflict-comparison-box">
                                <div className="conflict-comparison-label">AI Decision</div>
                                <div className={`conflict-comparison-value acuity-text-${aiAcuity}`}>L{aiAcuity}</div>
                                <div className="conflict-comparison-sub">{['','Resuscitation','Emergent','Urgent','Less Urgent','Non-Urgent'][aiAcuity]}</div>
                              </div>
                              <div className="conflict-comparison-divider">≠</div>
                              <div className="conflict-comparison-box">
                                <div className="conflict-comparison-label">Rules Engine</div>
                                <div className={`conflict-comparison-value acuity-text-${rulesAcuity}`}>L{rulesAcuity}</div>
                                <div className="conflict-comparison-sub">{['','Resuscitation','Emergent','Urgent','Less Urgent','Non-Urgent'][rulesAcuity]}</div>
                              </div>
                            </div>

                            {/* Rules engine reasoning */}
                            {rulesReasons.length > 0 && (
                              <div className="conflict-reasons-box">
                                <div className="conflict-reasons-title">Rules Engine Triggered On</div>
                                <ul className="conflict-reasons-list">
                                  {rulesReasons.map((r: string, i: number) => (
                                    <li key={i} className="conflict-reason-item">{r}</li>
                                  ))}
                                </ul>
                              </div>
                            )}

                            {/* Silent failure explanation */}
                            {isSilentFailure && (
                              <div className="conflict-silent-failure-desc">
                                <strong>⚡ Silent Failure Pattern:</strong> The AI's language representation aligns well semantically ({semanticScore != null ? `${(semanticScore * 100).toFixed(0)}%` : '--'}) but the clinical logic diverges significantly. The model produced a fluent, internally coherent response that is clinically incorrect. Clinician review is essential.
                              </div>
                            )}
                          </div>
                        );
                      })()}

                      {/* 2. Technical Audit Trail: Complete roster of sentinel baseline prompt vector data */}
                      {showSemanticTechnical && (
                        <div className="sae-technical-audit-trail">
                          <h4 className="sae-technical-header">
                            <span>Semantic Vector Proving</span>
                            <span style={{ fontSize: '0.7rem', color: '#60a5fa', fontFamily: 'monospace' }}>Cosine Similarity (3584-D)</span>
                          </h4>

                          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '0.8rem', color: 'var(--text-primary)' }}>
                            <div>
                              <strong style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>Patient Clinical Prompt:</strong>
                              <div className="sae-prompt-block">
                                {buildEncounterSaePrompt(selectedEncounter)}
                              </div>
                            </div>
                            <div>
                              <strong style={{ color: 'var(--text-secondary)', display: 'block', marginBottom: '3px' }}>Ideal Sentinel ESI-{(selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || 3)} Baseline:</strong>
                              <div className="sae-prompt-block">
                                {semanticData.sentinelPromptUsed}
                              </div>
                            </div>
                            <div className="semantic-vector-metrics">
                              <div><span style={{ opacity: 0.5 }}>Active Model:</span> <span style={{ color: 'var(--plasma-clinical-blue)' }}>{triageStatus?.agent?.name || 'Qwen2'}</span></div>
                              <div><span style={{ opacity: 0.5 }}>Cosine Sim:</span> <span style={{ color: semanticData.status === 'aligned' ? 'var(--plasma-integrity-green)' : 'var(--plasma-integrity-red)' }}>{semanticData.similarity.toFixed(6)}</span></div>
                              <div><span style={{ opacity: 0.5 }}>ESI Floor:</span> <span style={{ color: 'var(--plasma-text-primary)' }}>{semanticData.threshold.toFixed(2)}</span></div>
                              <div><span style={{ opacity: 0.5 }}>Compliance:</span> <span style={{ color: semanticData.status === 'aligned' ? 'var(--plasma-integrity-green)' : 'var(--plasma-integrity-red)', textTransform: 'uppercase', fontWeight: 'bold' }}>{semanticData.status}</span></div>
                              {selectedEncounter.clinical?.acuity_divergence != null && (
                                <>
                                  <div><span style={{ opacity: 0.5 }}>AI Acuity:</span> <span className={`acuity-text-${selectedEncounter.clinical.ai_recommendation?.acuity}`}>L{selectedEncounter.clinical.ai_recommendation?.acuity}</span></div>
                                  <div><span style={{ opacity: 0.5 }}>Rules Acuity:</span> <span className={`acuity-text-${selectedEncounter.clinical.rules_recommendation?.acuity}`}>L{selectedEncounter.clinical.rules_recommendation?.acuity}</span></div>
                                  <div style={{ gridColumn: '1 / -1' }}><span style={{ opacity: 0.5 }}>Acuity Divergence:</span> <span style={{ fontWeight: 'bold' }} className={selectedEncounter.clinical.acuity_divergence >= 2 ? 'acuity-text-2' : selectedEncounter.clinical.acuity_divergence === 1 ? 'acuity-text-2' : 'acuity-text-4'}>Δ{selectedEncounter.clinical.acuity_divergence} {selectedEncounter.clinical.acuity_divergence >= 2 ? '⚡ CONFLICT' : selectedEncounter.clinical.acuity_divergence === 1 ? '⚠ DISCREPANCY' : '✓ ALIGNED'}</span></div>
                                </>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* Disposition */}
              <h3 style={{ marginTop: '30px' }}>Clinical Disposition</h3>
              <div style={{ padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p><strong>Action Taken:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedEncounter.clinician_action || 'Awaiting decision'}</span></p>
                <p>
                  <strong>Status:</strong> 
                  <span 
                    style={{ color: '#ffa502', textTransform: 'capitalize', marginLeft: '5px', cursor: 'help' }}
                    title={selectedEncounter.clinical?.state === 'in_progress' 
                      ? "In Progress: AI recommendation logged; awaiting clinician decision or further action."
                      : "Clinical closure: Final clinician action has been logged for this encounter."}
                  >
                    {selectedEncounter.clinical?.state?.replace('_', ' ')}
                  </span>
                </p>

                {!selectedEncounter.clinical?.ai_recommendation && (
                  <div style={{ display: 'flex', gap: '10px', marginTop: '20px' }}>
                    <button disabled style={{ flex: 1, padding: '10px', background: '#2ed573', border: 'none', borderRadius: '4px', color: '#000', fontWeight: 'bold', opacity: 0.5, cursor: 'not-allowed' }}>Admit (Soon)</button>
                    <button disabled style={{ flex: 1, padding: '10px', background: '#1e90ff', border: 'none', borderRadius: '4px', color: '#fff', fontWeight: 'bold', opacity: 0.5, cursor: 'not-allowed' }}>Discharge</button>
                  </div>
                )}
              </div>
            </div>

            {/* Security Audit */}
            <div className="security-footer">
              <div className="security-header" onClick={() => setSecurityExpanded(!securityExpanded)}>
                <div 
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'help' }}
                  title={selectedEncounter.integrity.tamper_status === 'pending' 
                    ? "Pending: Cryptographic anchoring and full integrity verification are not yet complete for this encounter."
                    : selectedEncounter.integrity.tamper_status === 'anchored'
                      ? "Anchored: Cryptographic fingerprint is fully verified and anchored to the blockchain."
                      : "Tampered: Cryptographic verification failed. Ledger row has been altered."}
                >
                  <span>🛡️ Security Audit</span>
                  {getIntegrityIcon(selectedEncounter.integrity.tamper_status)}
                </div>
                <span>{securityExpanded ? '▼' : '▲'}</span>
              </div>

              {securityExpanded && (
                <div className="security-details">
                  <div className="hash-row">
                    <span className="hash-label">Event Record ID</span>
                    <span className="hash-value" style={{ fontWeight: 700, color: selectedEncounter.integrity.tamper_status === 'tampered' ? '#ff4757' : '#2ed573' }}>
                      #{selectedEncounter.db_row_id}
                    </span>
                  </div>
                  <div className="hash-row">
                    <span className="hash-label">Cryptographic Event Hash</span>
                    <span className="hash-value">{selectedEncounter.integrity.event_hash}</span>
                  </div>
                  <div className="hash-row">
                    <span className="hash-label">Anchored to Merkle Root ID</span>
                    <span className="hash-value">{selectedEncounter.integrity.merkle_root_id || 'Pending Block Anchor'}</span>
                  </div>
                  <div className="hash-row" style={{ marginTop: '20px', paddingTop: '15px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                    <button 
                      className="download-pack-btn"
                      onClick={() => downloadAuditPack(selectedEncounter.encounter_id)}
                    >
                      📄 Download Official Audit Pack (.json)
                    </button>
                    <p className="pack-disclaimer">
                      Includes full decision lineage, reason codes, and Keccak256 event fingerprints.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
