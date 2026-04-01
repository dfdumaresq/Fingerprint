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
  
  // Filters
  const [agentFilter, setAgentFilter] = useState('');
  const [daysBack, setDaysBack] = useState<number | ''>('');
  const [workflowFilter, setWorkflowFilter] = useState('');
  const [anomalyOnly, setAnomalyOnly] = useState(false);
  
  // Health
  const [auditResult, setAuditResult] = useState<any>(null);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (agentFilter) qs.append('agent_fingerprint_id', agentFilter);
      if (daysBack) qs.append('days_back', daysBack.toString());
      if (workflowFilter) qs.append('workflow_type', workflowFilter);
      if (anomalyOnly) qs.append('anomaly_only', 'true');
      
      const res = await fetch(`${REACT_APP_API_URL}/v1/events?${qs.toString()}`, {
        headers: {
          'Authorization': `Bearer ${REACT_APP_API_KEY}`
        }
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

  const triggerAnchor = async () => {
    try {
      const res = await fetch(`${REACT_APP_API_URL}/v1/events/anchor/trigger`, { 
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${REACT_APP_API_KEY}`
        }
      });
      await res.json();
      fetchEvents(); // Refresh
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

  useEffect(() => {
    fetchEvents();
  }, [agentFilter, daysBack, workflowFilter, anomalyOnly]);

  return (
    <div className="medical-dashboard" style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>Clinical AI Audit Trail</h2>
      <p>Immutable, Merkle-anchored history of AI actions in clinical workflows.</p>

      {/* Global Controls */}
      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', padding: '15px', borderRadius: '8px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
        <div style={{ flex: '1 1 250px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.8rem', color: '#8c9bb4', textTransform: 'uppercase' }}>Agent</label>
          <select 
            value={agentFilter} 
            onChange={(e) => setAgentFilter(e.target.value)}
            style={{ padding: '8px', width: '100%', borderRadius: '4px', background: '#1a1f2e', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <option value="">All Agents</option>
            {registeredAgents.map(a => (
              <option key={a.fingerprintHash} value={a.fingerprintHash}>
                {a.name} ({a.fingerprintHash.substring(0, 8)})
              </option>
            ))}
          </select>
        </div>

        <div style={{ flex: '1 1 180px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.8rem', color: '#8c9bb4', textTransform: 'uppercase' }}>Workflow</label>
          <select 
            value={workflowFilter} 
            onChange={(e) => setWorkflowFilter(e.target.value)}
            style={{ padding: '8px', width: '100%', borderRadius: '4px', background: '#1a1f2e', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}
          >
            <option value="">All Workflows</option>
            <option value="triage_recommendation">Triage Recs</option>
            <option value="clinician_action">Actions</option>
            <option value="clinician_amendment">Amendments</option>
          </select>
        </div>

        <div style={{ flex: '1 1 150px' }}>
          <label style={{ display: 'block', marginBottom: '5px', fontSize: '0.8rem', color: '#8c9bb4', textTransform: 'uppercase' }}>Timeframe</label>
          <select value={daysBack} onChange={(e) => setDaysBack(e.target.value === '' ? '' : Number(e.target.value))} style={{ padding: '8px', width: '100%', borderRadius: '4px', background: '#1a1f2e', color: '#fff', border: '1px solid rgba(255,255,255,0.1)' }}>
            <option value="">All Time</option>
            <option value={1}>Last 24 Hours</option>
            <option value={7}>Last 7 Days</option>
            <option value={30}>Last 30 Days</option>
          </select>
        </div>

        <div style={{ paddingBottom: '10px' }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.9rem' }}>
            <input type="checkbox" checked={anomalyOnly} onChange={(e) => setAnomalyOnly(e.target.checked)} />
            <span style={{ color: anomalyOnly ? '#ff4757' : 'inherit' }}>🚩 Anomaly Only</span>
          </label>
        </div>

        <button onClick={fetchEvents} style={{ padding: '8px 15px', background: 'rgba(255,255,255,0.05)', color: 'white', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '4px', cursor: 'pointer' }}>
          ↻ Refresh
        </button>
      </div>

      {/* Admin Actions */}
      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px' }}>
        <button onClick={triggerAnchor} style={{ background: '#0056b3', color: '#fff', padding: '8px 16px', border: 'none', borderRadius: '4px' }}>
          🔒 Trigger Merkle Anchoring
        </button>
        <button onClick={checkHealth} style={{ background: '#28a745', color: '#fff', padding: '8px 16px', border: 'none', borderRadius: '4px' }}>
          🩺 Run Cryptographic Health Check
        </button>
      </div>

      {auditResult && (
        <div style={{ background: auditResult.is_healthy ? '#d4edda' : '#f8d7da', padding: '15px', marginBottom: '20px', borderRadius: '4px', border: auditResult.is_healthy ? '1px solid #c3e6cb' : '1px solid #f5c6cb' }}>
          <div style={{ fontSize: '1.1rem', marginBottom: '5px' }}>
            <strong>Health Audit Result:</strong> {auditResult.is_healthy ? '✅ DB is Cryptographically Sound' : '❌ Tampering Detected!'}
          </div>
          <div style={{ fontSize: '0.9rem', color: '#444' }}>
            Checked <strong>{auditResult.total_events_checked}</strong> total records. Faults found: <strong>{auditResult.faults_detected}</strong>.
          </div>
          {!auditResult.is_healthy && (
            <div style={{ marginTop: '10px', padding: '10px', background: 'rgba(255,255,255,0.4)', borderRadius: '4px', fontSize: '0.85rem' }}>
              <p style={{ margin: '0 0 5px 0' }}><strong>🔍 Investigation Lead:</strong></p>
              <p style={{ margin: 0 }}><strong>Reason:</strong> <code style={{ color: '#721c24' }}>{auditResult.reason?.replace('_', ' ')}</code></p>
              <p style={{ margin: 0 }}><strong>First Affected ID:</strong> <code>{auditResult.first_bad_id}</code></p>
            </div>
          )}
        </div>
      )}

      {/* Ledger Table */}
      {loading ? <p>Loading immutable ledger...</p> : (
        <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #ddd' }}>
              <th style={{ padding: '10px' }}>Timestamp</th>
              <th style={{ padding: '10px' }}>Workflow</th>
              <th style={{ padding: '10px' }}>Agent ID</th>
              <th style={{ padding: '10px' }}>Clinician Action</th>
              <th style={{ padding: '10px' }}>Integrity</th>
            </tr>
          </thead>
          <tbody>
            {events.map((ev) => {
              const isFlagged = auditResult && !auditResult.is_healthy && ev.id >= (auditResult.first_bad_id ?? Infinity);
              return (
              <React.Fragment key={ev.id}>
                <tr 
                  onClick={() => setExpandedRow(expandedRow === ev.id ? null : ev.id)}
                  style={{ 
                    borderBottom: '1px solid #eee', 
                    cursor: 'pointer', 
                    background: expandedRow === ev.id ? '#f9f9f9' : 'transparent',
                    borderLeft: isFlagged ? '3px solid #dc3545' : '3px solid transparent'
                  }}
                >
                  <td style={{ padding: '10px', position: 'relative' }}>
                    {isFlagged && (
                      <span style={{
                        display: 'inline-block',
                        width: '9px',
                        height: '9px',
                        borderRadius: '50%',
                        background: '#dc3545',
                        marginRight: '8px',
                        verticalAlign: 'middle',
                        animation: 'tamper-pulse 1.4s ease-in-out infinite'
                      }} title={`Record ID ${ev.id}: integrity fault detected`} />
                    )}
                    {new Date(ev.timestamp).toLocaleString()}
                  </td>
                  <td style={{ padding: '10px' }}>{ev.workflow_type}</td>
                  <td style={{ padding: '10px' }}>{ev.agent_fingerprint_id.substring(0, 10)}...</td>
                  <td style={{ padding: '10px' }}>
                    <span style={{ 
                      padding: '3px 8px', borderRadius: '12px', fontSize: '12px',
                      background: ev.clinician_action === 'accepted' ? '#d4edda' : ev.clinician_action === 'overridden' ? '#f8d7da' : '#e2e3e5'
                    }}>
                      {ev.clinician_action || 'N/A'}
                    </span>
                  </td>
                  <td style={{ padding: '10px', color: ev.anchored_to_chain ? '#28a745' : '#ffc107', fontWeight: 'bold' }}>
                    {ev.anchored_to_chain ? '🔗 Anchored' : '⏳ Pending'}
                  </td>
                </tr>
                {expandedRow === ev.id && (
                  <tr>
                    <td colSpan={5} style={{ padding: '20px', background: '#f5f5f5', fontSize: '12px', fontFamily: 'monospace' }}>
                      <p><strong>🔒 Cryptographic Event Hash:</strong> {ev.event_hash}</p>
                      <p><strong>🔗 Linked Prior Hash (Chain):</strong> {ev.previous_event_hash || 'GENESIS'}</p>
                      <p><strong>🛡️ Input (De-identified pointer):</strong> {ev.input_ref}</p>
                      <p><strong>🛡️ Output (De-identified pointer):</strong> {ev.output_ref}</p>
                    </td>
                  </tr>
                )}
              </React.Fragment>
              );
            })}
          </tbody>
        </table>
      )}
      
      {events.length === 0 && !loading && <p>No events found matching the criteria.</p>}
    </div>
  );
};
