import React from 'react';
import { Sidebar, PlatformView } from './Sidebar';
import { useBlockchain } from '../contexts/BlockchainContext';

interface PlatformLayoutProps {
  children: React.ReactNode;
  activeView: PlatformView;
  onViewChange: (view: PlatformView) => void;
  theme: 'dark' | 'light';
  onThemeToggle: () => void;
}

const VIEW_TITLES: Record<PlatformView, string> = {
  'triage':         'Clinical Triage Dashboard',
  'medical-audit':  'Medical Audit Trail',
  'governance':     'Agent Governance Registry',
  'behavior-audit': 'Behavioral Drift Audit',
};

export const PlatformLayout: React.FC<PlatformLayoutProps> = ({ children, activeView, onViewChange, theme, onThemeToggle }) => {
  const { walletAddress, isConnected, isSandbox } = useBlockchain();
  const [copied, setCopied] = React.useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = React.useState(false);

  const handleCopy = () => {
    if (walletAddress) {
      navigator.clipboard.writeText(walletAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const shortAddress = walletAddress
    ? `${walletAddress.substring(0, 6)}…${walletAddress.substring(walletAddress.length - 4)}`
    : 'Loading…';

  return (
    <div className="platform-shell">
      <Sidebar
        activeView={activeView}
        onViewChange={onViewChange}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(c => !c)}
      />

      <main className="main-content">
        <header className="platform-header">

          <div className="platform-header__left">
            <h1 className="platform-header__title">
              {VIEW_TITLES[activeView]}
            </h1>
            {isSandbox && (
              <span className="badge badge--sandbox">SANDBOX MODE</span>
            )}
          </div>

          <div className="platform-header__right">
            <button
              onClick={onThemeToggle}
              className="theme-toggle-btn"
              style={{ marginRight: '8px' }}
              title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
              aria-label="Toggle theme"
            >
              {theme === 'dark' ? '☀️' : '🌙'}
            </button>
            {isConnected ? (
              <div className="wallet-pill">
                <span className="wallet-pill__label">Wallet</span>
                <span className="wallet-pill__address tabular-nums">{shortAddress}</span>
                <button
                  onClick={handleCopy}
                  className={`icon-btn${copied ? ' icon-btn--success' : ''}`}
                  aria-label="Copy wallet address"
                  title="Copy full address"
                >
                  {copied ? '✓' : '📋'}
                </button>
              </div>
            ) : (
              <span className="platform-header__disconnected">Disconnected</span>
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
