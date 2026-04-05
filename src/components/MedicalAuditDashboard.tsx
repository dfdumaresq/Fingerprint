import React, { useState, useEffect } from 'react';

interface ClinicalEvent {
  id: number;
  event_id: string;
  timestamp: string;
  agent_fingerprint_id: string;
  workflow_type: string;
  clinician_action: string;
  anchored_to_chain: boolean;
  merkle_root_id?: number;
  input_ref: string;
  output_ref: string;
  event_hash: string;
  previous_event_hash: string;
}

interface RegisteredAgent {
  fingerprintHash: string;
  name: string;
  provider: string;
  isRevoked: boolean;
  hasBehavioralTrait: boolean;
}

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3000';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || '';

export const MedicalAuditDashboard: React.FC = () => {
  const [events, setEvents] = useState<ClinicalEvent[]>([]);
  const [registeredAgents, setRegisteredAgents] = useState<RegisteredAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const [copyToast, setCopyToast] = useState(false);
  
  // Filters
  const [agentFilter, setAgentFilter] = useState('');
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [anomalyOnly, setAnomalyOnly] = useState(false);
  
  // Health
  const [auditResult, setAuditResult] = useState<any>(null);
  const [activeAgentResolved, setActiveAgentResolved] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (agentFilter) qs.append('agent_fingerprint_id', agentFilter);
      if (workflowFilter) qs.append('workflow_type', workflowFilter);
      if (anomalyOnly) qs.append('anomaly_only', 'true');
      
      const res = await fetch(`${REACT_APP_API_URL}/v1/events?${qs.toString()}`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const data = await res.json();
      if (data.success) {
        setEvents(data.data);
      }
      
      const agentsRes = await fetch(`${REACT_APP_API_URL}/v1/agents`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const agentsData = await agentsRes.json();
      if (agentsData.data) {
        setRegisteredAgents(agentsData.data);
      }
    } catch (err) {
      console.error('Failed to fetch events', err);
    }
    setLoading(false);
  };

  const fetchActiveAgent = async () => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/triage/status`, {
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      const data = await res.json();
      if (data.success && data.available && data.agent) {
        setAgentFilter(data.agent.fingerprintHash);
      }
    } catch (err) {
      console.error('Failed to resolve active agent', err);
    } finally {
      setActiveAgentResolved(true);
    }
  };

  const triggerAnchor = async () => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/events/anchor/trigger`, { 
        method: 'POST',
        headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
      });
      await res.json();
      fetchEvents();
      alert('Background Anchoring Triggered');
    } catch (err) {
      console.error(err);
    }
  };

  const checkHealth = async () => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/health/audit`);
      const data = await res.json();
      setAuditResult(data);
    } catch (err) {
      console.error(err);
    }
  };

  const handleCopyHash = () => {
    if (!agentFilter) return;
    navigator.clipboard.writeText(agentFilter);
    setCopyToast(true);
    setTimeout(() => setCopyToast(false), 2000);
  };

  useEffect(() => {
    fetchActiveAgent();
  }, []);

  useEffect(() => { 
    if (activeAgentResolved) {
      fetchEvents(); 
    }
  }, [agentFilter, workflowFilter, anomalyOnly, activeAgentResolved]);

  return (
    <div className="medical-dashboard">
      <div style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 600, color: 'var(--plasma-text-primary)', marginBottom: '8px' }}>
          Clinical AI Audit Trail
        </h2>
        <p className="text-secondary" style={{ fontSize: '0.9rem' }}>
          Immutable, Merkle-anchored history of AI and clinician actions in active clinical workflows.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '3fr 1fr', gap: '24px', alignItems: 'start', marginBottom: '32px' }}>
        <div className="plasma-card" style={{ padding: '20px' }}>
          <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap' }}>
            <div style={{ flex: '1 1 200px', position: 'relative' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
                <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', margin: 0, display: 'block' }}>Executing Agent</label>
                {agentFilter && (
                  <button 
                    onClick={handleCopyHash}
                    className="copy-hash-btn"
                    title="Copy active agent hash"
                    style={{ 
                      background: 'none', 
                      border: 'none', 
                      padding: 0, 
                      cursor: 'pointer', 
                      color: 'var(--plasma-clinical-blue)',
                      display: 'flex',
                      alignItems: 'center',
                      opacity: 0.7,
                      transition: 'opacity 0.2s'
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.opacity = '1')}
                    onMouseOut={(e) => (e.currentTarget.style.opacity = '0.7')}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"></path>
                      <rect x="8" y="2" width="8" height="4" rx="1" ry="1"></rect>
                    </svg>
                  </button>
                )}
              </div>

              {copyToast && (
                <div style={{ 
                  position: 'absolute', 
                  top: '-35px', 
                  right: '0', 
                  background: '#10b981', 
                  color: '#fff', 
                  fontSize: '0.7rem', 
                  padding: '4px 10px', 
                  borderRadius: '4px',
                  fontWeight: 600,
                  boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
                  zIndex: 100,
                  animation: 'fadeOut 2s forwards'
                }}>
                  Active agent hash copied
                </div>
              )}
              <select 
                value={agentFilter} 
                onChange={(e) => setAgentFilter(e.target.value)}
                className="form-input"
                style={{ width: '100%', background: 'var(--plasma-bg)', border: '1px solid var(--plasma-border)', padding: '8px', color: '#fff', borderRadius: '4px' }}
              >
                <option value="">All Agents</option>
                {registeredAgents.map(a => (
                  <option key={a.fingerprintHash} value={a.fingerprintHash}>
                    {a.name} {a.isRevoked ? '(REVOKED)' : ''}
                  </option>
                ))}
              </select>
            </div>
            <div style={{ flex: '1 1 150px' }}>
              <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', marginBottom: '8px', display: 'block' }}>Workflow Type</label>
              <select 
                value={workflowFilter} 
                onChange={(e) => setWorkflowFilter(e.target.value)}
                className="form-input"
                style={{ width: '100%', background: 'var(--plasma-bg)', border: '1px solid var(--plasma-border)', padding: '8px', color: '#fff', borderRadius: '4px' }}
              >
                <option value="">All Types</option>
                <option value="triage_recommendation">Triage Recruitment</option>
                <option value="clinician_action">Decision Logging</option>
                <option value="clinician_amendment">Clinical Amendments</option>
              </select>
            </div>
            <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '4px' }}>
               <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem' }}>
                <input type="checkbox" checked={anomalyOnly} onChange={(e) => setAnomalyOnly(e.target.checked)} />
                <span className={anomalyOnly ? 'text-error' : 'text-secondary'}>Show Anomalies Only</span>
              </label>
            </div>
          </div>
        </div>

        <div className="plasma-card" style={{ padding: '20px' }}>
          <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Ledger Stability</label>
          {auditResult ? (
            <div style={{ marginTop: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: auditResult.is_healthy ? 'var(--plasma-integrity-green)' : 'var(--plasma-integrity-red)' }}></div>
                <span style={{ fontWeight: 600, fontSize: '0.9rem' }}>{auditResult.is_healthy ? 'Synchronized' : 'Desynchronized'}</span>
              </div>
              <p className="text-muted" style={{ fontSize: '0.75rem', margin: 0 }}>Checked {auditResult.total_events_checked} events.</p>
            </div>
          ) : (
            <button 
              onClick={checkHealth} 
              style={{ padding: 0, marginTop: '8px', border: 'none', background: 'none', color: 'var(--plasma-clinical-blue)', cursor: 'pointer', fontSize: '0.85rem' }}
            >
              🩺 Run Health Check
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'flex', gap: '12px', marginBottom: '24px' }}>
         <button onClick={triggerAnchor} className="new-encounter-btn" style={{ background: 'var(--plasma-surface)', border: '1px solid var(--plasma-border)', fontSize: '0.8rem', padding: '6px 12px', color: '#fff', borderRadius: '4px', cursor: 'pointer' }}>
          🔒 Force Merkle Anchor
        </button>
      </div>

      <div className="plasma-card" style={{ padding: 0, overflow: 'hidden' }}>
        <table className="plasma-table">
          <thead>
            <tr>
              <th style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border-strong)' }}>Timestamp</th>
              <th style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border-strong)' }}>Workflow Domain</th>
              <th style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border-strong)' }}>Agent ID</th>
              <th style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border-strong)' }}>Clinical Decision</th>
              <th style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border-strong)', textAlign: 'right' }}>Integrity Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px' }} className="text-secondary">Loading ledger entries...</td></tr>
            ) : events.length === 0 ? (
              <tr><td colSpan={5} style={{ textAlign: 'center', padding: '40px' }} className="text-secondary">No audit logs found.</td></tr>
            ) : (
              events.map((ev) => {
                const isAnomaly = auditResult && !auditResult.is_healthy && ev.id >= auditResult.first_bad_id;
                return (
                  <React.Fragment key={ev.id}>
                    <tr 
                      onClick={() => setExpandedRow(expandedRow === ev.id ? null : ev.id)} 
                      style={{ cursor: 'pointer', opacity: isAnomaly ? 1 : 0.9 }}
                      className={isAnomaly ? 'row-anomaly' : ''}
                    >
                      <td className="tabular-nums" style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border)' }}>{new Date(ev.timestamp).toLocaleString()}</td>
                      <td style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border)' }}>{ev.workflow_type.replace('_', ' ')}</td>
                      <td className="tabular-nums" style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border)', position: 'relative' }}>
                        <div style={{ display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontSize: '0.8rem', fontWeight: 500 }}>
                            {registeredAgents.find(a => a.fingerprintHash === ev.agent_fingerprint_id)?.name || 'Unknown Agent'}
                          </span>
                          <span style={{ fontSize: '0.7rem', opacity: 0.5 }}>
                            {ev.agent_fingerprint_id.substring(0, 10)}...
                          </span>
                          {registeredAgents.find(a => a.fingerprintHash === ev.agent_fingerprint_id)?.isRevoked && (
                            <span style={{ 
                              fontSize: '0.6rem', 
                              color: '#ff4d4f', 
                              border: '1px solid #ff4d4f', 
                              padding: '1px 4px', 
                              borderRadius: '3px',
                              width: 'fit-content',
                              marginTop: '4px',
                              fontWeight: 700
                            }}>
                              REVOKED
                            </span>
                          )}
                        </div>
                      </td>
                      <td style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border)' }}>
                        <span className={`status-pill status-${
                          ev.clinician_action === 'accepted' ? 'completed' : 
                          ev.clinician_action === 'escalated' ? 'critical' : 
                          'neutral'
                        }`} style={{ fontSize: '0.7rem' }}>
                          {ev.clinician_action || 'AI Recommendation'}
                        </span>
                      </td>
                      <td style={{ padding: '16px', borderBottom: '1px solid var(--plasma-border)', textAlign: 'right' }}>
                        <span style={{ 
                          fontSize: '0.8rem', 
                          fontWeight: 700, 
                          color: isAnomaly ? 'var(--plasma-integrity-red)' : ev.anchored_to_chain ? 'var(--plasma-integrity-green)' : 'var(--plasma-warning-amber)' 
                        }}>
                          {isAnomaly ? '🚩 TAMPER FAULT' : ev.anchored_to_chain ? '🔗 ANCHORED' : '⏳ PENDING'}
                        </span>
                      </td>
                    </tr>
                    {expandedRow === ev.id && (
                      <tr style={{ background: 'rgba(0,0,0,0.15)' }}>
                        <td colSpan={5} style={{ padding: '24px' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '20px' }}>
                            <div>
                              <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Event Hash (Keccak256)</label>
                              <div className="tabular-nums" style={{ wordBreak: 'break-all', fontSize: '0.8rem', color: 'var(--plasma-clinical-blue)' }}>{ev.event_hash}</div>
                            </div>
                            <div>
                              <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Prior Linked Hash</label>
                              <div className="tabular-nums" style={{ wordBreak: 'break-all', fontSize: '0.8rem', opacity: 0.6 }}>{ev.previous_event_hash || 'GENESIS'}</div>
                            </div>
                            <div>
                              <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Input Reference</label>
                              <div className="tabular-nums" style={{ fontSize: '0.8rem' }}>{ev.input_ref}</div>
                            </div>
                            <div>
                              <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase', display: 'block', marginBottom: '8px' }}>Output Reference</label>
                              <div className="tabular-nums" style={{ fontSize: '0.8rem' }}>{ev.output_ref}</div>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
