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
  age: number;
  gender: string;
  red_flags?: string[];
  ai_recommendation?: { acuity: number; reasons: string[] };
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

interface NewEncounterForm {
  chief_complaint: string;
  custom_complaint: string;
  
  // Vitals Row 1 (Core)
  hr: string;
  bp_sys: string;
  bp_dia: string;
  rr: string;
  spo2: string;
  spo2_support: 'room_air' | 'supplemental';
  
  // Vitals Row 2 (Extended)
  temp: string;
  temp_method: 'oral' | 'tympanic' | 'axillary' | 'rectal';
  pain_score: string;
  weight_kg: string;
  height_cm: string;
  glucose_mmol: string;
  avpu: 'A' | 'V' | 'P' | 'U' | '';
  
  age: string;
  sex: 'M' | 'F' | '';
  
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

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

// ─── Component ────────────────────────────────────────────────────────────────

export const TriageDashboard: React.FC = () => {
  const [encounters, setEncounters] = useState<TriageEncounter[]>([]);
  const [selectedEncounter, setSelectedEncounter] = useState<TriageEncounter | null>(null);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<TriageMode>('all');
  const [showNewForm, setShowNewForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [triageStatus, setTriageStatus] = useState<{ available: boolean; agent?: any; error?: string } | null>(null);
  const [changingDecision, setChangingDecision] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [lastActionResult, setLastActionResult] = useState<{ is_amendment: boolean; previous_action: string | null } | null>(null);
  const [amendmentReason, setAmendmentReason] = useState('initial_decision');
  const [amendmentNote, setAmendmentNote] = useState('');
  const [showTechnicalProofs, setShowTechnicalProofs] = useState(false);
  const [showExtendedVitals, setShowExtendedVitals] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [form, setForm] = useState<NewEncounterForm>({
    chief_complaint: '', custom_complaint: '',
    hr: '', bp_sys: '', bp_dia: '', rr: '', spo2: '',
    spo2_support: 'room_air',
    temp: '', temp_method: 'oral',
    pain_score: '', weight_kg: '', height_cm: '', glucose_mmol: '',
    avpu: '',
    age: '', sex: '',
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

  useEffect(() => { 
    fetchEncounters(); 
    fetchStatus();
  }, [fetchEncounters, fetchStatus]);

  // Poll to keep queue fresh when form is closed
  useEffect(() => {
    const interval = setInterval(fetchEncounters, 15000);
    return () => clearInterval(interval);
  }, [fetchEncounters]);

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
    if (!form.chief_complaint || !form.hr || !form.bp_sys || !form.bp_dia) return;
    setSubmitting(true);
    const complaint = form.chief_complaint === 'Other…' ? form.custom_complaint : form.chief_complaint;
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
        age: Number(form.age || 0),
        sex: form.sex || 'F',
        history: {
          allergies: form.history.allergies.split(',').map(s => s.trim()).filter(Boolean),
          medications: form.history.medications.split(',').map(s => s.trim()).filter(Boolean),
          pmh: form.history.pmh.split(',').map(s => s.trim()).filter(Boolean),
          notes: form.history.notes
        },
        red_flags: form.red_flags,
        clinician_name: form.clinician_name || 'clinician',
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
                <button key={m} className={`mode-btn${mode === m ? ' active' : ''}`} onClick={() => setMode(m)}>
                  {m === 'all' ? 'All' : m === 'live' ? '● Live' : '● Scenario'}
                </button>
              ))}
            </div>
            {/* New Encounter */}
            <button 
              className="new-encounter-btn" 
              onClick={() => setShowNewForm(true)}
              disabled={triageStatus?.available === false}
              title={triageStatus?.available === false ? "AI Triage is disabled: No active agent found." : ""}
            >
              + New Encounter
            </button>
          </div>
        </div>
        
        {triageStatus?.available === false && (
          <div className="agent-status-banner error" style={{ marginTop: '16px', padding: '12px', background: 'rgba(239, 68, 68, 0.1)', border: '1px solid #ef4444', borderRadius: '8px', color: '#ef4444', fontSize: '0.85rem' }}>
            <strong>🚨 Triage Blocked:</strong> {triageStatus.error || "No active non-revoked triage agent resolved. Please update Governance registry."}
          </div>
        )}

        {triageStatus?.available && (
          <div className="agent-status-banner success" style={{ marginTop: '16px', padding: '12px', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid #10b981', borderRadius: '8px', color: '#10b981', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span><strong>✅ Active Agent Resolved:</strong> {triageStatus.agent.name} (v{triageStatus.agent.version})</span>
            <span style={{ fontFamily: 'monospace', fontSize: '0.75rem', opacity: 0.8 }}>{triageStatus.agent.fingerprintHash.substring(0, 16)}...</span>
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
              onChange={e => setForm(f => ({ ...f, chief_complaint: e.target.value }))}>
              <option value="">Select…</option>
              {CHIEF_COMPLAINTS.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            {form.chief_complaint === 'Other…' && (
              <input className="form-input" style={{ marginTop: 8 }} placeholder="Describe complaint…"
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
                <div className="vital-input-box">
                  <span className="vital-unit">Pain</span>
                  <input className="form-input tabular-nums" type="number" min="0" max="10" placeholder="0" value={form.pain_score} onChange={e => setForm(f => ({ ...f, pain_score: e.target.value }))} />
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
            <label className="form-label">Patient</label>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
              <input className="form-input" type="number" placeholder="Age" style={{ width: 80 }}
                value={form.age} onChange={e => setForm(f => ({ ...f, age: e.target.value }))} />
              <div className="sex-toggle">
                {(['M', 'F'] as const).map(s => (
                  <button key={s} className={`sex-btn${form.sex === s ? ' active' : ''}`}
                    onClick={() => setForm(f => ({ ...f, sex: f.sex === s ? '' : s }))}>{s}</button>
                ))}
              </div>
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Red Flags</label>
            <div className="flag-checkboxes">
              {RED_FLAG_OPTIONS.map(flag => (
                <label key={flag.id} className="flag-label">
                  <input type="checkbox" checked={form.red_flags.includes(flag.id)}
                    onChange={() => toggleRedFlag(flag.id)} />
                  {flag.label}
                </label>
              ))}
            </div>
          </div>

          <div className="form-section">
            <label className="form-label">Clinician Name</label>
            <input className="form-input" placeholder="Dr. Smith" value={form.clinician_name}
              onChange={e => setForm(f => ({ ...f, clinician_name: e.target.value }))} />
          </div>

          <button
            className="submit-btn"
            disabled={submitting || !form.chief_complaint || !form.hr || !form.bp_sys || !form.bp_dia}
            onClick={submitEncounter}
          >
            {submitting ? '⏳ Running AI Triage…' : '→ Submit & Triage'}
          </button>
        </div>
      )}

      {/* ── Triage Queue Table ── */}
      <table className="triage-queue">
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
                {enc.clinical?.clinician_acuity ? (
                  <span className={`acuity-badge acuity-${enc.clinical.clinician_acuity}`} style={{ border: '2px solid #555' }}>
                    {enc.clinical.clinician_acuity} <span style={{fontSize: '0.6em'}}>OVR</span>
                  </span>
                ) : (
                  <span className={`acuity-badge acuity-${enc.clinical?.ai_recommendation?.acuity || enc.clinical?.acuity || 0}`}>
                    {enc.clinical?.ai_recommendation?.acuity || enc.clinical?.acuity || '-'}
                  </span>
                )}
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
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>Loading queue…</td></tr>
          )}
        </tbody>
      </table>

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
                <div className={`acuity-badge acuity-${selectedEncounter.clinical?.clinician_acuity || selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || 0}`} style={{ width: 40, height: 40, fontSize: '1.2rem', border: selectedEncounter.clinical?.clinician_acuity ? '2px solid #555' : 'none' }}>
                  {selectedEncounter.clinical?.clinician_acuity || selectedEncounter.clinical?.ai_recommendation?.acuity || selectedEncounter.clinical?.acuity || '-'}
                </div>
                <div>
                  <div style={{ color: '#8c9bb4', fontSize: '0.85rem', textTransform: 'uppercase' }}>
                    {selectedEncounter.clinical?.clinician_acuity ? 'Assigned Acuity' : 'AI Triage Level'}
                  </div>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>
                    {ACUITY_LABELS[selectedEncounter.clinical?.clinician_acuity as number || selectedEncounter.clinical?.ai_recommendation?.acuity as number || selectedEncounter.clinical?.acuity as number] || 'Unknown'}
                  </div>
                </div>
              </div>

              {/* Vitals */}
              <h3>Current Vitals</h3>
              {/* Patient Context Block (Age/Gender) */}
              <div className="patient-context-grid">
                <div className="context-item">
                  <span className="context-label">Age</span>
                  <span className="context-value">{selectedEncounter.clinical?.age}</span>
                </div>
                <div className="context-item">
                  <span className="context-label">Sex</span>
                  <span className="context-value">{selectedEncounter.clinical?.gender}</span>
                </div>
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
                    <span className="provider-badge">{selectedEncounter.clinical?.ai_provider || 'rules'}</span>
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
                        onClick={() => dispatchAction('accepted', selectedEncounter.clinical?.ai_recommendation?.acuity)}>
                        {actionLoading === 'accepted' ? '…' : '✓ Accept'}
                      </button>
                      <button className="action-btn action-downgrade"
                        disabled={!!actionLoading || pendingAction !== null}
                        onClick={() => setPendingAction('downgraded')}>
                        {actionLoading === 'downgraded' ? '…' : '↓ Downgrade'}
                      </button>
                      <button className="action-btn action-escalate"
                        disabled={!!actionLoading || pendingAction !== null}
                        onClick={() => setPendingAction('escalated')}>
                        {actionLoading === 'escalated' ? '…' : '↑ Escalate'}
                      </button>
                    </div>
                    {pendingAction && (
                      <div className="acuity-selector" style={{ marginTop: '15px', padding: '15px', background: 'rgba(255,255,255,0.05)', borderRadius: '8px' }}>
                        <div style={{ marginBottom: '10px', fontSize: '0.9rem', color: '#ccc' }}>
                          Select new Acuity Level ({pendingAction}):
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          {[1, 2, 3, 4, 5].map(level => {
                            const aiLevel = selectedEncounter.clinical?.ai_recommendation?.acuity || 3;
                            const isValid = pendingAction === 'downgraded' ? level > aiLevel : level < aiLevel;
                            return (
                              <button
                                key={level}
                                disabled={!isValid || !!actionLoading}
                                onClick={() => dispatchAction(pendingAction, level)}
                                className={`acuity-badge acuity-${level}`}
                                style={{ width: 40, height: 40, opacity: isValid ? 1 : 0.3, cursor: isValid ? 'pointer' : 'not-allowed', border: 'none' }}
                                title={isValid ? `Assign Acuity ${level}` : `Invalid for ${pendingAction}`}
                              >
                                {level}
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
