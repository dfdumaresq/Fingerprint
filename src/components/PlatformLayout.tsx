import React from 'react';
import { Sidebar, PlatformView } from './Sidebar';
import { useBlockchain } from '../contexts/BlockchainContext';

interface PlatformLayoutProps {
  children: React.ReactNode;
  activeView: PlatformView;
  onViewChange: (view: PlatformView) => void;
}

export const PlatformLayout: React.FC<PlatformLayoutProps> = ({ children, activeView, onViewChange }) => {
  const { walletAddress, isConnected, isSandbox } = useBlockchain();
  const [copied, setCopied] = React.useState(false);

  const handleCopy = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="platform-shell">
      <Sidebar activeView={activeView} onViewChange={onViewChange} />
      
      <main className="main-content">
        <header className="platform-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <h1 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0, color: 'var(--plasma-clinical-blue)', letterSpacing: '-0.5px' }}>
              {activeView === 'triage' ? 'Clinical Triage Dashboard' :
               activeView === 'medical-audit' ? 'Medical Audit Trail' :
               'Agent Governance Registry'}
            </h1>
            {isSandbox && (
              <span style={{ 
                background: 'rgba(245, 158, 11, 0.1)', 
                color: '#f59e0b', 
                padding: '2px 10px', 
                borderRadius: '12px', 
                fontSize: '0.7rem', 
                fontWeight: 700,
                border: '1px solid rgba(245, 158, 11, 0.2)'
              }}>
                SANDBOX MODE
              </span>
            )}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
            {isConnected ? (
              <div style={{ 
                display: 'flex',
                alignItems: 'center',
                background: 'var(--plasma-surface-2)',
                padding: '6px 12px', 
                borderRadius: '6px', 
                fontSize: '0.85rem',
                border: '1px solid var(--plasma-border)'
              }}>
                <span style={{ color: 'var(--plasma-text-muted)', marginRight: '8px' }}>Wallet:</span>
                <span className="tabular-nums" style={{ marginRight: '10px' }}>
                  {walletAddress ? (`${walletAddress.substring(0, 6)}...${walletAddress.substring(walletAddress.length - 4)}`) : 'Loading...'}
                </span>
                <button
                  onClick={handleCopy}
                  className="icon-btn"
                  style={{
                    color: copied ? 'var(--plasma-integrity-green)' : 'inherit',
                  }}
                  aria-label="Copy wallet address"
                  title="Copy full address"
                >
                  {copied ? '✓' : '📋'}
                </button>
              </div>
            ) : (
              <span style={{ color: 'var(--plasma-text-secondary)', fontSize: '0.9rem' }}>Disconnected</span>
            )}
          </div>
        </header>

        <div className="content-viewport">
          {children}
        </div>
      </main>
    </div>
  );
};
