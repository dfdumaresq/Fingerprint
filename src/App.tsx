import React, { useState, useEffect } from 'react';
import './styles.css';
import './css/clinical-theme.css'; 
import ConnectWallet from './components/ConnectWallet';
import { BehavioralRegistration } from './components/BehavioralRegistration';
import { BehavioralVerification } from './components/BehavioralVerification';
import { MedicalAuditDashboard } from './components/MedicalAuditDashboard';
import { TriageDashboard } from './components/TriageDashboard';
import { AgentRegistry } from './components/AgentRegistry';
import { BlockchainProvider, useBlockchain } from './contexts/BlockchainContext';
import { PlatformLayout } from './components/PlatformLayout';
import { PlatformView } from './components/Sidebar';

const AppContent: React.FC = () => {
    const { isConnected } = useBlockchain();
  
    const [activeView, setActiveView] = useState<PlatformView>(() => {
        const hash = window.location.hash.replace('#', '');
        const validViews: PlatformView[] = ['triage', 'medical-audit', 'governance', 'behavior-audit'];
        if (validViews.includes(hash as any)) {
            return hash as any;
        }
        return 'triage'; 
    });

    useEffect(() => {
        const handleHashChange = () => {
            const hash = window.location.hash.replace('#', '');
            const validViews: PlatformView[] = ['triage', 'medical-audit', 'governance', 'behavior-audit'];
            if (validViews.includes(hash as any)) {
                setActiveView(hash as any);
            }
        };
        window.addEventListener('hashchange', handleHashChange);
        return () => window.removeEventListener('hashchange', handleHashChange);
    }, []);

    const handleViewChange = (view: PlatformView) => {
        setActiveView(view);
        window.location.hash = view;
    };

    const [fingerprintHashForBehavior, setFingerprintHashForBehavior] = useState<string>('');
    const [inputHash, setInputHash] = useState<string>('');
    const [behaviorSubView, setBehaviorSubView] = useState<'audit' | 'baseline'>('audit');

    if (!isConnected) {
        return (
            <div className="platform-shell" style={{ justifyContent: 'center', alignItems: 'center' }}>
                <div className="plasma-card" style={{ maxWidth: '450px', textAlign: 'center' }}>
                    <div className="sidebar-logo" style={{ marginBottom: '24px', fontSize: '1.8rem', display: 'flex', justifyContent: 'center' }}>FINGERPRINT.AI</div>
                    <h2 style={{ marginBottom: '16px', color: 'var(--plasma-text-primary)' }}>Clinical Access Required</h2>
                    <p className="text-secondary" style={{ marginBottom: '32px' }}>
                        Connect your provider wallet to access the Clinical Triage and Audit Platform.
                    </p>
                    <ConnectWallet />
                    <div style={{ marginTop: '24px', paddingTop: '24px', borderTop: '1px solid var(--plasma-border)' }}>
                        <p style={{ fontSize: '0.8rem', color: 'var(--plasma-text-muted)' }}>
                            Sepolia Testnet Required for Blockchain Integrity.
                        </p>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <PlatformLayout activeView={activeView} onViewChange={handleViewChange}>
            {activeView === 'triage' && <TriageDashboard />}
            
            {activeView === 'medical-audit' && <MedicalAuditDashboard />}

            {activeView === 'governance' && <AgentRegistry />}

            {activeView === 'behavior-audit' && (
                <div className="plasma-card">
                    {!fingerprintHashForBehavior ? (
                        <div style={{ padding: '20px' }}>
                            <h3>Behavioral Audit Initialization</h3>
                            <p className="text-secondary" style={{ marginBottom: '20px' }}>
                                Enter the agent fingerprint hash to verify behavioral consistency against historical baselines.
                            </p>
                            <input
                                type="text"
                                placeholder="0x..."
                                className="form-input"
                                value={inputHash}
                                onChange={(e) => setInputHash(e.target.value)}
                                style={{ 
                                    width: '100%', 
                                    padding: '12px', 
                                    background: 'var(--plasma-bg)', 
                                    border: '1px solid var(--plasma-border)',
                                    color: '#fff',
                                    borderRadius: '4px',
                                    marginBottom: '16px' 
                                }}
                            />
                            <button
                                onClick={() => {
                                    if (inputHash.trim()) {
                                        setFingerprintHashForBehavior(inputHash.trim());
                                    }
                                }}
                                disabled={!inputHash.trim()}
                                className="new-encounter-btn"
                                style={{ width: '100%' }}
                            >
                                Start Behavioral Verification
                            </button>
                            
                            <div style={{ marginTop: '32px', paddingTop: '24px', borderTop: '1px solid var(--plasma-border)' }}>
                                <p className="text-muted" style={{ fontSize: '0.8rem' }}>
                                    Note: This process detects model drift or unauthorized substitution by analyzing response variance in high-fidelity clinical simulations.
                                </p>
                            </div>
                        </div>
                    ) : (
                        <>
                            <button
                                onClick={() => {
                                    setFingerprintHashForBehavior('');
                                    setInputHash('');
                                }}
                                style={{ marginBottom: '20px', background: 'none', border: 'none', color: 'var(--plasma-clinical-blue)', cursor: 'pointer', textDecoration: 'underline' }}
                            >
                                ← Return to Hash Entry
                            </button>
                            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '32px' }}>
                                <div style={{ display: 'flex', gap: '8px', background: 'var(--plasma-surface-2)', padding: '4px', borderRadius: '8px', border: '1px solid var(--plasma-border)' }}>
                                    <button 
                                        className={`nav-item ${behaviorSubView === 'audit' ? 'active' : ''}`}
                                        style={{ border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, fontSize: '0.85rem' }}
                                        onClick={() => setBehaviorSubView('audit')}
                                    >
                                        Run Drift Audit
                                    </button>
                                    <button 
                                        className={`nav-item ${behaviorSubView === 'baseline' ? 'active' : ''}`}
                                        style={{ border: 'none', borderRadius: '6px', padding: '8px 16px', fontWeight: 600, fontSize: '0.85rem' }}
                                        onClick={() => setBehaviorSubView('baseline')}
                                    >
                                        Establish Baseline
                                    </button>
                                </div>
                            </div>

                            <div className="registry-content">
                                {behaviorSubView === 'audit' ? (
                                    <BehavioralVerification fingerprintHash={fingerprintHashForBehavior} />
                                ) : (
                                    <BehavioralRegistration fingerprintHash={fingerprintHashForBehavior} />
                                )}
                            </div>
                        </>
                    )}
                </div>
            )}
        </PlatformLayout>
    );
};

const AppWrapper: React.FC = () => {
    return (
        <BlockchainProvider>
            <AppContent />
        </BlockchainProvider>
    );
};

export default AppWrapper;
