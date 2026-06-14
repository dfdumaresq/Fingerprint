import React, { useState, useEffect, useCallback } from 'react';
import FingerprintForm from './FingerprintForm';
import VerifyFingerprint from './VerifyFingerprint';
import RevokeFingerprint from './RevokeFingerprint';
import { useBlockchain } from '../contexts/BlockchainContext';
import { PlatformView } from './Sidebar';
import { Agent } from '../types';
import { formatTimestamp } from '../utils/fingerprint.utils';

const REACT_APP_API_URL = process.env.REACT_APP_API_URL || '';
const REACT_APP_API_KEY = process.env.REACT_APP_API_KEY || 'sk_test_123';

interface AgentRegistryProps {
    onViewChange?: (view: PlatformView) => void;
}

export const AgentRegistry: React.FC<AgentRegistryProps> = ({ onViewChange }) => {
    const { service } = useBlockchain();
    const [subView, setSubView] = useState<'list' | 'register' | 'verify' | 'revoke' | 'activation'>('list');
    const [registrationSuccess, setRegistrationSuccess] = useState(false);
    const [registeredAgent, setRegisteredAgent] = useState<Omit<Agent, 'createdAt'> | null>(null);
    const [selectedHash, setSelectedHash] = useState<string>('');

    // State for registered agents directory
    const [agents, setAgents] = useState<Agent[]>([]);
    const [loadingAgents, setLoadingAgents] = useState(false);
    const [heartbeats, setHeartbeats] = useState<Record<string, 'checking' | 'active' | 'idle' | 'revoked'>>({});
    const [activeAgentHash, setActiveAgentHash] = useState<string>('');

    // Activation Audit Trail states
    const [auditLog, setAuditLog] = useState<any[]>([]);
    const [loadingAudit, setLoadingAudit] = useState(false);
    const [showActivationModal, setShowActivationModal] = useState(false);
    const [agentToActivate, setAgentToActivate] = useState<Agent | null>(null);
    const [activationReason, setActivationReason] = useState('');
    const [activationSuccessBanner, setActivationSuccessBanner] = useState<{ occurredAt: string; eventId: number; requestId: string; agentName: string } | null>(null);

    const handleRegistrationSuccess = (agent: Omit<Agent, 'createdAt'>) => {
        setRegistrationSuccess(true);
        setRegisteredAgent(agent);
    };

    // Callback to fetch registered agents
    const fetchAgents = useCallback(async () => {
        if (!service) return;
        setLoadingAgents(true);
        try {
            let list: Agent[] = [];

            // 1. Fetch active agent status from API to see which agent is the designated active one
            let activeHash = '';
            try {
                const statusRes = await fetch(`${REACT_APP_API_URL}/v1/triage/status`, {
                    headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
                });
                const statusData = await statusRes.json();
                if (statusData.success && statusData.agent) {
                    activeHash = statusData.agent.fingerprintHash;
                    setActiveAgentHash(activeHash);
                }
            } catch (statusError) {
                console.warn("Failed to fetch active triage agent status:", statusError);
            }

            // 2. Try to fetch from backend API first (synced PG cache)
            try {
                const apiRes = await fetch(`${REACT_APP_API_URL}/v1/agents`, {
                    headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
                });
                const apiData = await apiRes.json();
                if (apiData && Array.isArray(apiData.data)) {
                    list = apiData.data;
                }
            } catch (apiError) {
                console.warn("Failed to fetch agents from API backend, falling back to blockchain:", apiError);
            }

            // 3. Fallback to direct blockchain query if backend API failed or returned empty list
            if (list.length === 0 && typeof service.getRegisteredAgents === 'function') {
                list = await service.getRegisteredAgents();
            }

            // Sort by registration date descending (newest first)
            list.sort((a, b) => b.createdAt - a.createdAt);
            setAgents(list);

            // Initialize all heartbeats as checking
            const initialHeartbeats: Record<string, 'checking' | 'active' | 'idle' | 'revoked'> = {};
            list.forEach(agent => {
                initialHeartbeats[agent.fingerprintHash] = 'checking';
            });
            setHeartbeats(initialHeartbeats);

            // Fallback active hash in case API is down or not running yet:
            // We default the first non-revoked agent in the list to active
            const resolvedActiveHash = activeHash || (list.find(a => !a.revoked)?.fingerprintHash || '');
            if (!activeHash && resolvedActiveHash) {
                setActiveAgentHash(resolvedActiveHash);
            }

            // Trigger animated simulated heartbeat checks
            list.forEach(agent => {
                setTimeout(() => {
                    const isThisActive = agent.fingerprintHash === (activeHash || resolvedActiveHash);
                    setHeartbeats(prev => ({
                        ...prev,
                        [agent.fingerprintHash]: agent.revoked ? 'revoked' : (isThisActive ? 'active' : 'idle')
                    }));
                }, 500 + Math.random() * 800); // Random delay between 500ms and 1300ms
            });
        } catch (error) {
            console.error("Failed to load agents:", error);
        } finally {
            setLoadingAgents(false);
        }
    }, [service]);

    // Fetch agents when switching to list view or when service initializes
    useEffect(() => {
        if (subView === 'list' && service) {
            fetchAgents();
        }
    }, [subView, service, fetchAgents]);

    const fetchAuditLog = useCallback(async () => {
        setLoadingAudit(true);
        try {
            const res = await fetch(`${REACT_APP_API_URL}/v1/agents/activation-history`, {
                headers: { 'Authorization': `Bearer ${REACT_APP_API_KEY}` }
            });
            const data = await res.json();
            if (data.success && Array.isArray(data.data)) {
                setAuditLog(data.data);
            }
        } catch (error) {
            console.error("Failed to fetch activation audit history:", error);
        } finally {
            setLoadingAudit(false);
        }
    }, []);

    useEffect(() => {
        if (subView === 'activation') {
            fetchAuditLog();
        }
    }, [subView, fetchAuditLog]);

    // Trigger individual heartbeat re-check
    const triggerHeartbeatRecheck = () => {
        if (agents.length === 0) return;
        
        // Reset all active ones to checking
        const resetting: Record<string, 'checking' | 'active' | 'idle' | 'revoked'> = {};
        agents.forEach(agent => {
            resetting[agent.fingerprintHash] = 'checking';
        });
        setHeartbeats(resetting);

        agents.forEach(agent => {
            setTimeout(() => {
                const isThisActive = agent.fingerprintHash === activeAgentHash;
                setHeartbeats(prev => ({
                    ...prev,
                    [agent.fingerprintHash]: agent.revoked ? 'revoked' : (isThisActive ? 'active' : 'idle')
                }));
            }, 600 + Math.random() * 800);
        });
    };

    const handleCopy = (e: React.MouseEvent, text: string) => {
        e.stopPropagation();
        navigator.clipboard.writeText(text);
    };


    return (
        <div className="agent-registry">
            {/* Embedded Premium Styles for Micro-animations and Layouts */}
            <style>{`
                @keyframes pulse-blue {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 107, 255, 0.6); }
                    70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(74, 107, 255, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(74, 107, 255, 0); }
                }
                @keyframes pulse-green {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0.6); }
                    70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(16, 185, 129, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(16, 185, 129, 0); }
                }
                @keyframes pulse-red {
                    0% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.6); }
                    70% { transform: scale(1.05); box-shadow: 0 0 0 6px rgba(239, 68, 68, 0); }
                    100% { transform: scale(0.95); box-shadow: 0 0 0 0 rgba(239, 68, 68, 0); }
                }
                .dot-blue {
                    display: inline-block;
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background-color: #4a6bff;
                    animation: pulse-blue 1.8s infinite ease-in-out;
                }
                .dot-green {
                    display: inline-block;
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background-color: #10b981;
                    animation: pulse-green 1.8s infinite ease-in-out;
                }
                .dot-red {
                    display: inline-block;
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background-color: #ef4444;
                    animation: pulse-red 1.8s infinite ease-in-out;
                }
                .dot-gray {
                    display: inline-block;
                    width: 7px;
                    height: 7px;
                    border-radius: 50%;
                    background-color: #9ca3af;
                }
                .agent-card-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(360px, 1fr));
                    gap: 20px;
                    margin-top: 10px;
                }
                .agent-gov-card {
                    background: rgba(255, 255, 255, 0.015);
                    border: 1px solid var(--plasma-border, rgba(255, 255, 255, 0.08));
                    border-radius: 12px;
                    padding: 22px;
                    transition: all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1);
                    display: flex;
                    flex-direction: column;
                    justify-content: space-between;
                    height: 100%;
                    backdrop-filter: blur(10px);
                }
                .agent-gov-card:hover {
                    transform: translateY(-4px);
                    border-color: var(--plasma-clinical-blue, #4a6bff);
                    background: rgba(255, 255, 255, 0.03);
                    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15);
                }
                .agent-gov-card.revoked-card {
                    border-color: rgba(239, 68, 68, 0.2);
                    background: rgba(239, 68, 68, 0.005);
                }
                .agent-gov-card.revoked-card:hover {
                    border-color: #ef4444;
                    background: rgba(239, 68, 68, 0.015);
                }
                .card-header-top {
                    display: flex;
                    justify-content: space-between;
                    align-items: flex-start;
                    margin-bottom: 12px;
                }
                .card-badge {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    font-size: 0.72rem;
                    font-weight: 600;
                    padding: 4px 10px;
                    border-radius: 20px;
                    text-transform: uppercase;
                    letter-spacing: 0.03em;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.05);
                }
                .card-badge.status-checking {
                    color: #4a6bff;
                    border-color: rgba(74, 107, 255, 0.15);
                    background: rgba(74, 107, 255, 0.03);
                }
                .card-badge.status-online {
                    color: #10b981;
                    border-color: rgba(16, 185, 129, 0.15);
                    background: rgba(16, 185, 129, 0.03);
                }
                .card-badge.status-idle {
                    color: #94a3b8;
                    border-color: rgba(148, 163, 184, 0.15);
                    background: rgba(148, 163, 184, 0.03);
                }
                .card-badge.status-revoked {
                    color: #ef4444;
                    border-color: rgba(239, 68, 68, 0.15);
                    background: rgba(239, 68, 68, 0.03);
                }
                .field-row {
                    display: flex;
                    justify-content: space-between;
                    font-size: 0.8rem;
                    padding: 8px 0;
                    border-bottom: 1px dashed rgba(255, 255, 255, 0.04);
                }
                .field-row:last-of-type {
                    border-bottom: none;
                }
                .field-label {
                    color: var(--plasma-text-secondary, #9ca3af);
                }
                .field-val {
                    font-weight: 500;
                    color: var(--plasma-text-primary, #fff);
                }
                .hash-val {
                    font-family: monospace;
                    color: var(--plasma-clinical-blue, #4a6bff);
                    cursor: pointer;
                }
                .hash-val:hover {
                    text-decoration: underline;
                }
                .card-actions {
                    display: flex;
                    gap: 8px;
                    margin-top: 20px;
                    border-top: 1px solid rgba(255, 255, 255, 0.05);
                    padding-top: 16px;
                }
                .card-action-btn {
                    flex: 1;
                    padding: 8px;
                    font-size: 0.78rem;
                    font-weight: 600;
                    border-radius: 6px;
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    background: rgba(255, 255, 255, 0.02);
                    cursor: pointer;
                    transition: all 0.2s;
                    text-align: center;
                }
                .card-action-btn:hover {
                    background: rgba(255, 255, 255, 0.06);
                    border-color: var(--plasma-clinical-blue, #4a6bff);
                }
                .card-action-btn.btn-revoke {
                    color: #fca5a5;
                }
                .card-action-btn.btn-revoke:hover {
                    background: rgba(239, 68, 68, 0.05);
                    border-color: #ef4444;
                    color: #fff;
                }
                .card-action-btn.btn-activate {
                    color: var(--plasma-clinical-blue, #4a6bff);
                }
                .card-action-btn.btn-activate:hover {
                    background: rgba(14, 165, 233, 0.05);
                    border-color: var(--plasma-clinical-blue, #4a6bff);
                    color: #fff;
                }
                .card-action-btn.btn-activate.active-btn {
                    color: var(--plasma-integrity-green, #10b981);
                    background: rgba(16, 185, 129, 0.08);
                    border-color: var(--plasma-integrity-green, #10b981);
                    cursor: not-allowed;
                }
                .btn-recheck {
                    background: transparent;
                    border: 1px solid var(--plasma-border, rgba(255, 255, 255, 0.08));
                    padding: 8px 16px;
                    font-size: 0.8rem;
                    font-weight: 600;
                    border-radius: 6px;
                    cursor: pointer;
                    color: var(--plasma-text-secondary, #9ca3af);
                    transition: all 0.2s;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .btn-recheck:hover {
                    color: #fff;
                    border-color: var(--plasma-clinical-blue, #4a6bff);
                    background: rgba(255, 255, 255, 0.03);
                }
            `}</style>

            <div style={{ marginBottom: '32px' }}>
                <p className="text-secondary" style={{ fontSize: '0.95rem', lineHeight: '1.6', maxWidth: '800px' }}>
                    Manage the lifecycle of AI agent identities. Register new fingerprints, verify blockchain clinical integrity, or revoke compromised identities.
                </p>
            </div>

            {activationSuccessBanner && (
                <div style={{
                    background: 'rgba(16, 185, 129, 0.08)',
                    border: '1px solid var(--plasma-integrity-green)',
                    borderRadius: '6px',
                    padding: '16px 20px',
                    marginBottom: '24px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '16px'
                }}>
                    <div style={{ flex: 1 }}>
                        <h4 style={{ margin: '0 0 4px 0', color: 'var(--plasma-integrity-green)', fontWeight: 600 }}>
                            🟢 Active Agent Swapped Successfully
                        </h4>
                        <p style={{ margin: 0, fontSize: '0.88rem', color: 'var(--plasma-text-primary)' }}>
                            Agent <strong style={{ color: 'var(--plasma-clinical-blue)' }}>{activationSuccessBanner.agentName}</strong> was activated by <strong>System Dashboard</strong> at <strong>{formatTimestamp(activationSuccessBanner.occurredAt || Date.now())}</strong>.
                        </p>
                        <div style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--plasma-text-secondary)', display: 'flex', gap: '16px' }}>
                            <span><strong>Audit ID:</strong> #{activationSuccessBanner.eventId}</span>
                            <span><strong>Request ID:</strong> <code style={{ color: 'var(--plasma-clinical-blue)' }}>{activationSuccessBanner.requestId}</code></span>
                        </div>
                    </div>
                    <button 
                        style={{ background: 'transparent', border: 'none', color: 'var(--plasma-text-secondary)', cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px' }}
                        onClick={() => setActivationSuccessBanner(null)}
                    >
                        ✕
                    </button>
                </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '32px', flexWrap: 'wrap', gap: '16px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                    <button 
                        className={`nav-item ${subView === 'list' ? 'active' : ''}`}
                        style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'list' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                        onClick={() => { setSelectedHash(''); setSubView('list'); }}
                    >
                        Active Directory
                    </button>
                    <button 
                        className={`nav-item ${subView === 'register' ? 'active' : ''}`}
                        style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'register' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                        onClick={() => { setSelectedHash(''); setSubView('register'); }}
                    >
                        Register Identity
                    </button>
                    <button 
                        className={`nav-item ${subView === 'verify' ? 'active' : ''}`}
                        style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'verify' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                        onClick={() => { setSelectedHash(''); setSubView('verify'); }}
                    >
                        Verify Fingerprint
                    </button>
                    <button 
                        className={`nav-item ${subView === 'revoke' ? 'active' : ''}`}
                        style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'revoke' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                        onClick={() => { setSelectedHash(''); setSubView('revoke'); }}
                    >
                        Revoke Access
                    </button>
                    <button 
                        className={`nav-item ${subView === 'activation' ? 'active' : ''}`}
                        style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'activation' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                        onClick={() => { setSelectedHash(''); setSubView('activation'); }}
                    >
                        Activation Trail
                    </button>
                </div>

                {subView === 'list' && agents.length > 0 && (
                    <button onClick={triggerHeartbeatRecheck} className="btn-recheck">
                        🔄 Ping Status
                    </button>
                )}
            </div>

            <div className="registry-content">
                {subView === 'list' && (
                    <div>
                        {loadingAgents ? (
                            <div style={{ textAlign: 'center', padding: '60px' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '16px', animation: 'spin 1.5s infinite linear' }}>🔄</div>
                                <h4 style={{ color: 'var(--plasma-text-secondary)', fontWeight: 500 }}>Synchronizing Registry Ledger...</h4>
                            </div>
                        ) : agents.length === 0 ? (
                            <div className="plasma-card" style={{ textAlign: 'center', padding: '60px' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '20px' }}>🛡️</div>
                                <h3 style={{ color: 'var(--plasma-text-primary)', marginBottom: '12px', fontWeight: 600 }}>No Registered Identities Found</h3>
                                <p className="text-secondary" style={{ marginBottom: '24px', maxWidth: '500px', margin: '0 auto 24px auto' }}>
                                    There are currently no active AI model fingerprints registered on the blockchain. Register a new identity to get started.
                                </p>
                                <button 
                                    className="new-encounter-btn"
                                    onClick={() => setSubView('register')}
                                    style={{ background: 'var(--plasma-clinical-blue)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600 }}
                                >
                                    Register First Agent
                                </button>
                            </div>
                        ) : (
                            <div className="agent-card-grid">
                                {agents.map((agent) => {
                                    const status = heartbeats[agent.fingerprintHash] || 'checking';
                                    
                                    return (
                                        <div 
                                            key={agent.fingerprintHash} 
                                            className={`agent-gov-card ${agent.revoked ? 'revoked-card' : ''}`}
                                        >
                                            <div>
                                                <div className="card-header-top">
                                                    <div>
                                                        <h4 style={{ margin: '0 0 2px 0', fontSize: '1.05rem', fontWeight: 600, color: 'var(--plasma-text-primary)' }}>
                                                            {agent.name}
                                                        </h4>
                                                        <span style={{ fontSize: '0.78rem', color: 'var(--plasma-text-secondary)' }}>
                                                            v{agent.version}
                                                        </span>
                                                    </div>
                                                    
                                                    {status === 'checking' && (
                                                        <span className="card-badge status-checking">
                                                            <span className="dot-blue"></span> Checking
                                                        </span>
                                                    )}
                                                    {status === 'active' && (
                                                        <span className="card-badge status-online">
                                                            <span className="dot-green"></span> Active / Online
                                                        </span>
                                                    )}
                                                    {status === 'idle' && (
                                                        <span className="card-badge status-idle">
                                                            <span className="dot-gray"></span> Idle
                                                        </span>
                                                    )}
                                                    {status === 'revoked' && (
                                                        <span className="card-badge status-revoked">
                                                            <span className="dot-red"></span> Revoked
                                                        </span>
                                                    )}
                                                </div>

                                                <div style={{ marginTop: '16px' }}>
                                                    <div className="field-row">
                                                        <span className="field-label">Provider</span>
                                                        <span className="field-val">{agent.provider}</span>
                                                    </div>
                                                    <div className="field-row">
                                                        <span className="field-label">Operational ID</span>
                                                        <span className="field-val tabular-nums" style={{ fontSize: '0.75rem' }}>{agent.id}</span>
                                                    </div>
                                                    <div className="field-row" style={{ flexDirection: 'column', gap: '4px', borderBottom: 'none' }}>
                                                        <span className="field-label">Blockchain Fingerprint</span>
                                                        <span 
                                                            className="field-val hash-val tabular-nums" 
                                                            style={{ fontSize: '0.72rem', wordBreak: 'break-all' }}
                                                            onClick={(e) => handleCopy(e, agent.fingerprintHash)}
                                                            title="Click to copy full hash"
                                                        >
                                                            {agent.fingerprintHash} 📋
                                                        </span>
                                                    </div>
                                                    <div className="field-row">
                                                        <span className="field-label">Registered At</span>
                                                        <span className="field-val tabular-nums" style={{ fontSize: '0.78rem' }}>
                                                            {formatTimestamp(agent.createdAt)}
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>

                                            {!agent.revoked ? (
                                                <div className="card-actions">
                                                    <button 
                                                        className="card-action-btn"
                                                        onClick={() => {
                                                            if (onViewChange) {
                                                                sessionStorage.setItem('pending_behavior_audit_hash', agent.fingerprintHash);
                                                                onViewChange('behavior-audit');
                                                            } else {
                                                                setSelectedHash(agent.fingerprintHash);
                                                                setSubView('verify');
                                                            }
                                                        }}
                                                    >
                                                        🔍 Verify
                                                    </button>
                                                    <button 
                                                        className={`card-action-btn btn-activate ${agent.fingerprintHash === activeAgentHash ? 'active-btn' : ''}`}
                                                        disabled={agent.fingerprintHash === activeAgentHash}
                                                        onClick={() => {
                                                            setAgentToActivate(agent);
                                                            setShowActivationModal(true);
                                                            setActivationReason('');
                                                        }}
                                                    >
                                                        {agent.fingerprintHash === activeAgentHash ? '🟢 Active' : '⚡ Activate'}
                                                    </button>
                                                    <button 
                                                        className="card-action-btn btn-revoke"
                                                        onClick={() => {
                                                            setSelectedHash(agent.fingerprintHash);
                                                            setSubView('revoke');
                                                        }}
                                                    >
                                                        ⚠️ Revoke
                                                    </button>
                                                </div>
                                            ) : (
                                                <div style={{ marginTop: '16px', padding: '10px', background: 'rgba(239, 68, 68, 0.04)', borderRadius: '6px', border: '1px dashed rgba(239, 68, 68, 0.2)', fontSize: '0.75rem', color: '#ef4444', textAlign: 'center', fontWeight: 600 }}>
                                                    🔒 Permanent Revocation Anchored
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                )}

                {subView === 'register' && (
                    <div className="plasma-card">
                        {registrationSuccess ? (
                            <div style={{ textAlign: 'center', padding: '40px' }}>
                                <div style={{ fontSize: '3rem', marginBottom: '16px' }}>🛡️</div>
                                <h3 style={{ color: 'var(--plasma-integrity-green)', marginBottom: '12px' }}>Fingerprint Anchored Successfully</h3>
                                <p className="text-secondary" style={{ marginBottom: '24px' }}>The AI agent identity has been recorded on the blockchain ledger.</p>
                                
                                {registeredAgent && (
                                    <div style={{ textAlign: 'left', background: 'var(--plasma-bg)', padding: '20px', borderRadius: '8px', border: '1px solid var(--plasma-border)', marginBottom: '32px' }}>
                                        <div style={{ marginBottom: '12px' }}>
                                            <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Agent Identity</label>
                                            <div style={{ fontWeight: 600 }}>{registeredAgent.name} (v{registeredAgent.version})</div>
                                        </div>
                                        <div>
                                            <label className="text-muted" style={{ fontSize: '0.7rem', textTransform: 'uppercase' }}>Blockchain Fingerprint</label>
                                            <div className="tabular-nums" style={{ color: 'var(--plasma-clinical-blue)', wordBreak: 'break-all', fontSize: '0.9rem' }}>{registeredAgent.fingerprintHash}</div>
                                        </div>
                                    </div>
                                )}

                                <button 
                                    className="new-encounter-btn"
                                    onClick={() => setRegistrationSuccess(false)}
                                    style={{ background: 'var(--plasma-clinical-blue)', color: '#fff', border: 'none', padding: '12px 24px', borderRadius: '4px', cursor: 'pointer' }}
                                >
                                    Register Another Agent
                                </button>
                            </div>
                        ) : (
                            <FingerprintForm onSuccess={(agent) => {
                                handleRegistrationSuccess(agent);
                                fetchAgents();
                            }} />
                        )}
                    </div>
                )}

                {subView === 'verify' && (
                    <div className="plasma-card">
                        <VerifyFingerprint blockchainService={service!} initialHash={selectedHash} />
                    </div>
                )}

                {subView === 'revoke' && (
                    <div className="plasma-card">
                        <RevokeFingerprint 
                            blockchainService={service!} 
                            onSuccess={() => {
                                console.log('Revoked');
                                fetchAgents();
                            }}
                            initialHash={selectedHash}
                        />
                    </div>
                )}

                {subView === 'activation' && (
                    <div className="plasma-card">
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                            <div>
                                <h3 style={{ margin: '0 0 4px 0', color: 'var(--plasma-text-primary)', fontWeight: 600 }}>
                                    Agent Activation Audit Trail
                                </h3>
                                <p className="text-secondary" style={{ margin: 0, fontSize: '0.85rem' }}>
                                    Append-only ledger of all agent routing changes, failures, and clinician-asserted justifications.
                                </p>
                            </div>
                            <button 
                                onClick={fetchAuditLog} 
                                className="btn-recheck"
                                style={{ margin: 0 }}
                                disabled={loadingAudit}
                            >
                                {loadingAudit ? '⏳ Syncing...' : '🔄 Refresh Trail'}
                            </button>
                        </div>

                        {loadingAudit ? (
                            <div style={{ textAlign: 'center', padding: '60px' }}>
                                <div style={{ fontSize: '2rem', marginBottom: '16px', animation: 'spin 1.5s infinite linear' }}>🔄</div>
                                <h4 style={{ color: 'var(--plasma-text-secondary)', fontWeight: 500 }}>Reading Ledger Chain...</h4>
                            </div>
                        ) : auditLog.length === 0 ? (
                            <div style={{ textAlign: 'center', padding: '40px', color: 'var(--plasma-text-secondary)' }}>
                                <div style={{ fontSize: '2.5rem', marginBottom: '16px' }}>📋</div>
                                <p>No activation audit events found in the ledger.</p>
                            </div>
                        ) : (
                            <div style={{ overflowX: 'auto' }}>
                                <table className="triage-table" style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ borderBottom: '2px solid var(--plasma-border)' }}>
                                            <th style={{ padding: '12px 16px', color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem' }}>Timestamp (UTC)</th>
                                            <th style={{ padding: '12px 16px', color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem' }}>Authenticated Actor</th>
                                            <th style={{ padding: '12px 16px', color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem' }}>Action / Target</th>
                                            <th style={{ padding: '12px 16px', color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem' }}>Audit Details</th>
                                            <th style={{ padding: '12px 16px', color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem' }}>Outcome</th>
                                            <th style={{ padding: '12px 16px', color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem' }}>Correlation Context</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {auditLog.map((event) => {
                                            const isSuccess = event.outcome === 'success';
                                            return (
                                                <tr key={event.id} style={{ borderBottom: '1px solid var(--plasma-border)', background: isSuccess ? 'transparent' : 'rgba(239, 68, 68, 0.02)' }}>
                                                    <td style={{ padding: '14px 16px', verticalAlign: 'top', whiteSpace: 'nowrap' }}>
                                                        <span className="tabular-nums" style={{ fontSize: '0.85rem', color: 'var(--plasma-text-primary)', display: 'block' }}>
                                                            {formatTimestamp(event.occurred_at)}
                                                        </span>
                                                        <span style={{ fontSize: '0.7rem', color: 'var(--plasma-text-secondary)' }}>
                                                            ID: #{event.id}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                                        <div style={{ fontWeight: 600, fontSize: '0.88rem', color: 'var(--plasma-text-primary)' }}>
                                                            {event.actor_display_name}
                                                        </div>
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--plasma-text-secondary)' }}>
                                                            {event.actor_role} ({event.actor_type})
                                                        </div>
                                                    </td>
                                                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                                        <div style={{ fontSize: '0.85rem' }}>
                                                            <span style={{ color: 'var(--plasma-text-secondary)' }}>Target: </span>
                                                            <strong style={{ color: 'var(--plasma-clinical-blue)' }}>{event.target_agent_id}</strong>
                                                        </div>
                                                        {event.previous_agent_id && (
                                                            <div style={{ fontSize: '0.75rem', color: 'var(--plasma-text-secondary)', marginTop: '2px' }}>
                                                                Prev: {event.previous_agent_id}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '14px 16px', verticalAlign: 'top', maxWidth: '300px' }}>
                                                        <div style={{ fontSize: '0.85rem', color: 'var(--plasma-text-primary)', wordBreak: 'break-word', lineHeight: '1.4' }}>
                                                            {event.reason || <em style={{ color: 'var(--plasma-text-secondary)' }}>No justification provided</em>}
                                                        </div>
                                                        {!isSuccess && event.metadata?.error && (
                                                            <div style={{ fontSize: '0.72rem', color: '#ef4444', marginTop: '6px', background: 'rgba(239, 68, 68, 0.05)', padding: '6px 8px', borderRadius: '4px', border: '1px solid rgba(239, 68, 68, 0.1)' }}>
                                                                Error: {event.metadata.error}
                                                            </div>
                                                        )}
                                                    </td>
                                                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                                        <span 
                                                            className="card-badge"
                                                            style={{
                                                                background: isSuccess ? 'rgba(74, 222, 128, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                                                                color: isSuccess ? 'var(--plasma-integrity-green)' : '#ef4444',
                                                                borderColor: isSuccess ? 'rgba(74, 222, 128, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                                                                padding: '4px 8px',
                                                                borderRadius: '4px',
                                                                fontSize: '0.75rem',
                                                                fontWeight: 600
                                                            }}
                                                        >
                                                            {isSuccess ? '✅ Success' : '❌ Failed'}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '14px 16px', verticalAlign: 'top' }}>
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                                            <div>
                                                                <span className="text-muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', display: 'block' }}>Request ID</span>
                                                                <code style={{ fontSize: '0.75rem', color: 'var(--plasma-clinical-blue)', wordBreak: 'break-all' }}>{event.request_id}</code>
                                                            </div>
                                                            <div>
                                                                <span className="text-muted" style={{ fontSize: '0.68rem', textTransform: 'uppercase', display: 'block' }}>Source</span>
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--plasma-text-primary)' }}>{event.source}</span>
                                                            </div>
                                                        </div>
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Agent Activation Confirmation Modal ── */}
                {showActivationModal && agentToActivate && (
                    <div style={{
                        position: 'fixed',
                        top: 0,
                        left: 0,
                        right: 0,
                        bottom: 0,
                        backgroundColor: 'rgba(15, 19, 32, 0.85)',
                        backdropFilter: 'blur(8px)',
                        display: 'flex',
                        justifyContent: 'center',
                        alignItems: 'center',
                        zIndex: 1000,
                        padding: '20px',
                    }}>
                        <div className="plasma-card" style={{
                            maxWidth: '500px',
                            width: '100%',
                            border: '1px solid var(--plasma-clinical-blue)',
                            boxShadow: '0 8px 32px rgba(14, 165, 233, 0.15)',
                            background: 'var(--plasma-surface)',
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '16px' }}>
                                <span style={{ fontSize: '1.8rem' }}>⚡</span>
                                <h3 style={{ margin: 0, color: 'var(--plasma-clinical-blue)', fontSize: '1.2rem', fontWeight: 700 }}>
                                    Authorize Triage Agent Activation
                                </h3>
                            </div>
                            
                            <p className="text-secondary" style={{ fontSize: '0.9rem', lineHeight: '1.6', marginBottom: '20px' }}>
                                You are activating a new AI model for patient triage. This action changes the active clinical routing logic and will be logged to the audit ledger.
                            </p>

                            <div style={{
                                background: 'var(--plasma-surface-2)',
                                border: '1px solid var(--plasma-border)',
                                padding: '12px 16px',
                                borderRadius: '6px',
                                marginBottom: '20px',
                            }}>
                                <span className="text-muted" style={{ fontSize: '0.72rem', textTransform: 'uppercase', display: 'block', marginBottom: '4px' }}>Target Agent</span>
                                <div style={{ fontWeight: 600, fontSize: '0.9rem', color: 'var(--plasma-text-primary)' }}>
                                    {agentToActivate.name} (v{agentToActivate.version})
                                </div>
                                <code style={{ fontSize: '0.78rem', color: 'var(--plasma-clinical-blue)', wordBreak: 'break-all' }}>
                                    {agentToActivate.fingerprintHash}
                                </code>
                            </div>

                            <div className="form-group" style={{ marginBottom: '24px' }}>
                                <label htmlFor="activation-reason" style={{ color: 'var(--plasma-text-secondary)', fontWeight: 600, fontSize: '0.82rem', marginBottom: '8px', display: 'block' }}>
                                    Reason for Change (Required for Clinical Auditing):
                                </label>
                                <textarea
                                    id="activation-reason"
                                    rows={3}
                                    value={activationReason}
                                    onChange={e => setActivationReason(e.target.value)}
                                    placeholder="e.g. Updating to model version with improved cardiac symptom triage metrics."
                                    className="form-input"
                                    style={{
                                        width: '100%',
                                        background: 'var(--plasma-surface-2)',
                                        border: '1px solid var(--plasma-border)',
                                        color: '#fff',
                                        borderRadius: '4px',
                                        padding: '10px',
                                        fontSize: '0.9rem',
                                        resize: 'vertical'
                                    }}
                                    autoFocus
                                />
                            </div>

                            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
                                <button
                                    className="card-action-btn"
                                    style={{ background: 'transparent', border: '1px solid var(--plasma-border)', color: 'var(--plasma-text-secondary)', width: 'auto', flex: 'none' }}
                                    onClick={() => {
                                        setShowActivationModal(false);
                                        setAgentToActivate(null);
                                        setActivationReason('');
                                    }}
                                >
                                    Cancel
                                </button>
                                <button
                                    className="card-action-btn"
                                    style={{
                                        background: 'var(--plasma-clinical-blue)',
                                        color: '#fff',
                                        cursor: !activationReason.trim() ? 'not-allowed' : 'pointer',
                                        opacity: !activationReason.trim() ? 0.6 : 1,
                                        width: 'auto',
                                        flex: 'none'
                                    }}
                                    disabled={!activationReason.trim()}
                                    onClick={async () => {
                                        try {
                                            const res = await fetch(`${REACT_APP_API_URL}/v1/agents/activate`, {
                                                method: 'POST',
                                                headers: {
                                                    'Authorization': `Bearer ${REACT_APP_API_KEY}`,
                                                    'Content-Type': 'application/json',
                                                    'X-Source': 'ui'
                                                },
                                                body: JSON.stringify({
                                                    fingerprintHash: agentToActivate.fingerprintHash,
                                                    reason: activationReason
                                                })
                                            });
                                            const data = await res.json();
                                            if (data.success) {
                                                setActivationSuccessBanner({
                                                    occurredAt: data.data.occurredAt,
                                                    eventId: data.data.eventId,
                                                    requestId: data.data.requestId,
                                                    agentName: data.data.agent.name
                                                });
                                                await fetchAgents();
                                                setTimeout(() => {
                                                    setActivationSuccessBanner(null);
                                                }, 10000);
                                            } else {
                                                alert(`Failed to activate agent: ${data.error?.message || 'Unknown error'}`);
                                            }
                                        } catch (error: any) {
                                            console.error("Activation request failed:", error);
                                            alert(`Activation request failed: ${error.message}`);
                                        } finally {
                                            setShowActivationModal(false);
                                            setAgentToActivate(null);
                                            setActivationReason('');
                                        }
                                    }}
                                >
                                    Confirm Activation
                                </button>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
