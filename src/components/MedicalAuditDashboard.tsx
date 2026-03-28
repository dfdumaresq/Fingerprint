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

export const MedicalAuditDashboard: React.FC = () => {
  const [events, setEvents] = useState<ClinicalEvent[]>([]);
  const [registeredAgents, setRegisteredAgents] = useState<RegisteredAgent[]>([]);
  const [loading, setLoading] = useState(false);
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  
  // Filters
  const [agentFilter, setAgentFilter] = useState('');
  const [daysBack, setDaysBack] = useState<number | ''>('');
  
  // Health
  const [auditResult, setAuditResult] = useState<any>(null);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (agentFilter) qs.append('agent_fingerprint_id', agentFilter);
      if (daysBack) qs.append('days_back', daysBack.toString());
      
      const res = await fetch(`${REACT_APP_API_URL}/v1/events?${qs.toString()}`, {
        headers: {
          'Authorization': 'Bearer dd3d02cb017e4ea2ab904ec98e211eeb'
        }
      });
      const data = await res.json();
      if (data.success) {
        setEvents(data.data);
      }
      
      const agentsRes = await fetch(`${REACT_APP_API_URL}/v1/agents`, {
        headers: { 'Authorization': 'Bearer dd3d02cb017e4ea2ab904ec98e211eeb' }
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
          'Authorization': 'Bearer dd3d02cb017e4ea2ab904ec98e211eeb'
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
  }, [agentFilter, daysBack]);

  return (
    <div className="medical-dashboard" style={{ padding: '20px', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>Clinical AI Audit Trail</h2>
      <p>Immutable, Merkle-anchored history of AI actions in clinical workflows.</p>

      {/* Global Controls */}
      <div style={{ display: 'flex', gap: '15px', marginBottom: '20px', background: '#f5f5f5', padding: '15px', borderRadius: '8px', alignItems: 'flex-start' }}>
        <div>
          <label style={{ display: 'block', marginBottom: '5px' }}><strong>Registered Agent: </strong></label>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <select 
              value={agentFilter} 
              onChange={(e) => setAgentFilter(e.target.value)}
              style={{ padding: '8px', width: '320px', borderRadius: '4px', border: '1px solid #ccc' }}
            >
              <option value="">All Agents</option>
              {registeredAgents.map(a => (
                <option key={a.fingerprintHash} value={a.fingerprintHash}>
                  {a.name} - {a.fingerprintHash.substring(0, 10)}...
                </option>
              ))}
            </select>
            {/* Behavioral Badge Drop-in */}
            {agentFilter && registeredAgents.find(a => a.fingerprintHash === agentFilter)?.hasBehavioralTrait && (
              <span style={{ background: '#e0f2fe', color: '#0369a1', padding: '5px 10px', borderRadius: '12px', fontSize: '12px', fontWeight: 'bold' }}>
                🛡️ Active Behavioral Profile
              </span>
            )}
          </div>
          <div style={{ fontSize: '12px', color: '#666', marginTop: '6px' }}>
            Choose a fingerprint registered in the 'Register AI Agent' tab.
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '15px', alignItems: 'flex-start' }}>
          <div>
            <label style={{ display: 'block', marginBottom: '5px' }}><strong>Timeframe: </strong></label>
            <select value={daysBack} onChange={(e) => setDaysBack(e.target.value === '' ? '' : Number(e.target.value))} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc' }}>
              <option value="">All Time</option>
              <option value={1}>Last 24 Hours</option>
              <option value={7}>Last 7 Days</option>
            </select>
          </div>
          <button onClick={fetchEvents} style={{ marginTop: '24px', padding: '8px 15px', background: '#4a6cf7', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
            Refresh Ledger
          </button>
        </div>
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
        <div style={{ background: auditResult.is_healthy ? '#d4edda' : '#f8d7da', padding: '10px', marginBottom: '20px', borderRadius: '4px' }}>
          <strong>Health Audit Result:</strong> {auditResult.is_healthy ? '✅ DB is Cryptographically Sound' : '❌ Tampering Detected!'}
          <br/>
          Checked {auditResult.total_events_checked} events. Faults: {auditResult.faults_detected}.
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
            {events.map((ev) => (
              <React.Fragment key={ev.id}>
                <tr 
                  onClick={() => setExpandedRow(expandedRow === ev.id ? null : ev.id)}
                  style={{ borderBottom: '1px solid #eee', cursor: 'pointer', background: expandedRow === ev.id ? '#f9f9f9' : 'transparent' }}
                >
                  <td style={{ padding: '10px' }}>{new Date(ev.timestamp).toLocaleString()}</td>
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
            ))}
          </tbody>
        </table>
      )}
      
      {events.length === 0 && !loading && <p>No events found matching the criteria.</p>}
    </div>
  );
};
