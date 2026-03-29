import React, { useState, useEffect } from 'react';
import '../css/triage.css';

interface TriageEncounter {
  encounter_id: string;
  db_row_id: number;
  arrival_time: string;
  clinician_action: string | null;
  agent_id: string;
  clinical: {
    acuity: number;
    chief_complaint: string;
    vitals: { heart_rate: number; blood_pressure: string };
    state: string;
  };
  integrity: {
    event_hash: string;
    merkle_root_id: number | null;
    anchored_to_chain: boolean;
    tamper_status: 'pending' | 'anchored' | 'tampered';
  };
}

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

export const TriageDashboard: React.FC = () => {
  const [encounters, setEncounters] = useState<TriageEncounter[]>([]);
  const [selectedEncounter, setSelectedEncounter] = useState<TriageEncounter | null>(null);
  const [securityExpanded, setSecurityExpanded] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchEncounters();
  }, []);

  const fetchEncounters = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/encounters`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const data = await res.json();
      if (data.success) {
        setEncounters(data.data);
      }
    } catch (err) {
      console.error('Failed to fetch triage encounters', err);
    }
    setLoading(false);
  };

  const getIntegrityIcon = (status: string) => {
    if (status === 'anchored') return <span className="integrity-icon integrity-anchored">🔗 Anchored</span>;
    if (status === 'tampered') return <span className="integrity-icon integrity-tampered">❌ Tampered</span>;
    return <span className="integrity-icon integrity-pending">⏳ Pending</span>;
  };

  return (
    <div className="triage-container">
      <div className="triage-header">
        <h1>Clinician Triage Queue</h1>
        <p>Live AI-assisted emergency department waiting room.</p>
      </div>

      <table className="triage-queue">
        <thead>
          <tr>
            <th>Acuity</th>
            <th>Encounter ID</th>
            <th>Arrival Time</th>
            <th>Chief Complaint</th>
            <th>Vitals (HR / BP)</th>
            <th>Status</th>
            <th>Integrity</th>
          </tr>
        </thead>
        <tbody>
          {encounters.map(enc => (
            <tr key={enc.encounter_id} className={`triage-row${enc.integrity.tamper_status === 'tampered' ? ' row-tampered' : ''}`} onClick={() => { setSelectedEncounter(enc); setSecurityExpanded(false); }}>
              <td>
                <span className={`acuity-badge acuity-${enc.clinical?.acuity}`}>
                  {enc.clinical?.acuity}
                </span>
              </td>
              <td style={{ fontFamily: 'monospace' }}>{enc.encounter_id}</td>
              <td>{new Date(enc.arrival_time).toLocaleTimeString()}</td>
              <td style={{ fontWeight: 600 }}>{enc.clinical.chief_complaint}</td>
              <td>{enc.clinical.vitals.heart_rate} bpm / {enc.clinical.vitals.blood_pressure}</td>
              <td style={{ textTransform: 'capitalize' }}>{enc.clinical?.state?.replace('_', ' ') || 'loading...'}</td>
              <td>{getIntegrityIcon(enc.integrity.tamper_status)}</td>
            </tr>
          ))}
          {encounters.length === 0 && !loading && (
            <tr><td colSpan={7} style={{ textAlign: 'center', padding: '40px' }}>No patients in queue.</td></tr>
          )}
        </tbody>
      </table>

      {/* Drawer Overlay */}
      <div 
        className={`drawer-overlay ${selectedEncounter ? 'open' : ''}`}
        onClick={() => setSelectedEncounter(null)}
      />

      {/* Slide-out Drawer */}
      <div className={`encounter-drawer ${selectedEncounter ? 'open' : ''}`}>
        {selectedEncounter && (
          <>
            <div className="drawer-header">
              <div>
                <h2>{selectedEncounter.clinical.chief_complaint}</h2>
                <div style={{ color: '#8c9bb4', fontSize: '0.85rem', marginTop: '5px', fontFamily: 'monospace' }}>
                  {selectedEncounter.encounter_id}
                </div>
              </div>
              <button className="drawer-close" onClick={() => setSelectedEncounter(null)}>×</button>
            </div>

            <div className="drawer-content">
              <div style={{ display: 'flex', alignItems: 'center', gap: '15px', marginBottom: '30px' }}>
                <div className={`acuity-badge acuity-${selectedEncounter.clinical.acuity}`} style={{ width: 40, height: 40, fontSize: '1.2rem' }}>
                  {selectedEncounter.clinical.acuity}
                </div>
                <div>
                  <div style={{ color: '#8c9bb4', fontSize: '0.85rem', textTransform: 'uppercase' }}>AI Recommended Triage</div>
                  <div style={{ fontWeight: 600, fontSize: '1.1rem' }}>Level {selectedEncounter.clinical.acuity}</div>
                </div>
              </div>

              <h3>Current Vitals</h3>
              <div className="vitals-grid">
                <div className="vital-card">
                  <div className="vital-label">Heart Rate</div>
                  <div className="vital-value">{selectedEncounter.clinical.vitals.heart_rate} bpm</div>
                </div>
                <div className="vital-card">
                  <div className="vital-label">Blood Pressure</div>
                  <div className="vital-value">{selectedEncounter.clinical.vitals.blood_pressure}</div>
                </div>
              </div>

              <h3 style={{ marginTop: '30px' }}>Clinical Disposition</h3>
              <div style={{ padding: '20px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.08)' }}>
                <p><strong>Action Taken:</strong> <span style={{ textTransform: 'capitalize' }}>{selectedEncounter.clinician_action || 'None'}</span></p>
                <p><strong>Status:</strong> <span style={{ color: '#ffa502', textTransform: 'capitalize' }}>{selectedEncounter.clinical?.state?.replace('_', ' ') || 'None'}</span></p>
                
                <div style={{ marginTop: '20px', display: 'flex', gap: '10px' }}>
                   <button disabled style={{ flex: 1, padding: '10px', background: '#2ed573', border: 'none', borderRadius: '4px', color: '#000', fontWeight: 'bold', opacity: 0.5, cursor: 'not-allowed' }}>Admit (Soon)</button>
                   <button disabled style={{ flex: 1, padding: '10px', background: '#1e90ff', border: 'none', borderRadius: '4px', color: '#fff', fontWeight: 'bold', opacity: 0.5, cursor: 'not-allowed' }}>Discharge</button>
                </div>
              </div>
            </div>

            <div className="security-footer">
              <div className="security-header" onClick={() => setSecurityExpanded(!securityExpanded)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span>🛡️ Security Audit</span>
                  {getIntegrityIcon(selectedEncounter.integrity.tamper_status)}
                </div>
                <span>{securityExpanded ? '▼' : '▲'}</span>
              </div>
              
              {securityExpanded && (
                <div className="security-details">
                  <div className="hash-row">
                    <span className="hash-label">Event Record ID</span>
                    <span className="hash-value" style={{ fontWeight: 700, color: selectedEncounter.integrity.tamper_status === 'tampered' ? '#ff4757' : '#2ed573' }}>#{selectedEncounter.db_row_id}</span>
                  </div>
                  <div className="hash-row">
                    <span className="hash-label">Cryptographic Event Hash</span>
                    <span className="hash-value">{selectedEncounter.integrity.event_hash}</span>
                  </div>
                  <div className="hash-row">
                    <span className="hash-label">Anchored to Merkle Root ID</span>
                    <span className="hash-value">{selectedEncounter.integrity.merkle_root_id || 'Pending Block Anchor'}</span>
                  </div>
                  <div className="hash-row">
                    <span className="hash-label">Agent Model Provenance</span>
                    <span className="hash-value">{selectedEncounter.agent_id}</span>
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
