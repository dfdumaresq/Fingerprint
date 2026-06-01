import React, { useState, useEffect } from 'react';
import './styles.css';
import './css/clinical-theme.css'; 
import ConnectWallet from './components/ConnectWallet';
import { BehaviorAuditView } from './components/BehaviorAuditView';
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

            {activeView === 'behavior-audit' && <BehaviorAuditView />}
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
