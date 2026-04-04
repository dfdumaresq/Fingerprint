import React, { useState } from 'react';
import FingerprintForm from './FingerprintForm';
import VerifyFingerprint from './VerifyFingerprint';
import RevokeFingerprint from './RevokeFingerprint';
import { useBlockchain } from '../contexts/BlockchainContext';
import { Agent } from '../types';

export const AgentRegistry: React.FC = () => {
    const { service } = useBlockchain();
    const [subView, setSubView] = useState<'list' | 'register' | 'verify' | 'revoke'>('register');
    const [registrationSuccess, setRegistrationSuccess] = useState(false);
    const [registeredAgent, setRegisteredAgent] = useState<Omit<Agent, 'createdAt'> | null>(null);

    const handleRegistrationSuccess = (agent: Omit<Agent, 'createdAt'>) => {
        setRegistrationSuccess(true);
        setRegisteredAgent(agent);
    };

    return (
        <div className="agent-registry">
            <div style={{ marginBottom: '32px' }}>
                <p className="text-secondary" style={{ fontSize: '0.95rem', lineHeight: '1.6', maxWidth: '800px' }}>
                    Manage the lifecycle of AI agent identities. Register new fingerprints, verify blockchain clinical integrity, or revoke compromised identities.
                </p>
            </div>

            <div style={{ display: 'flex', gap: '8px', marginBottom: '32px' }}>
                <button 
                    className={`nav-item ${subView === 'register' ? 'active' : ''}`}
                    style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'register' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                    onClick={() => setSubView('register')}
                >
                    Register Identity
                </button>
                <button 
                    className={`nav-item ${subView === 'verify' ? 'active' : ''}`}
                    style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'verify' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                    onClick={() => setSubView('verify')}
                >
                    Verify Fingerprint
                </button>
                <button 
                    className={`nav-item ${subView === 'revoke' ? 'active' : ''}`}
                    style={{ borderRadius: '4px', border: '1px solid var(--plasma-border)', padding: '10px 20px', background: subView === 'revoke' ? 'var(--plasma-surface-2)' : 'transparent', fontWeight: 600 }}
                    onClick={() => setSubView('revoke')}
                >
                    Revoke Access
                </button>
            </div>

            <div className="registry-content">
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
                            <FingerprintForm onSuccess={handleRegistrationSuccess} />
                        )}
                    </div>
                )}

                {subView === 'verify' && (
                    <div className="plasma-card">
                        <VerifyFingerprint blockchainService={service!} />
                    </div>
                )}

                {subView === 'revoke' && (
                    <div className="plasma-card">
                        <RevokeFingerprint 
                            blockchainService={service!} 
                            onSuccess={() => console.log('Revoked')}
                        />
                    </div>
                )}
            </div>
        </div>
    );
};
