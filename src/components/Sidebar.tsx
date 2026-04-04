import React from 'react';

export type PlatformView = 'triage' | 'medical-audit' | 'governance' | 'behavior-audit';

interface SidebarProps {
  activeView: PlatformView;
  onViewChange: (view: PlatformView) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeView, onViewChange }) => {
  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <div className="sidebar-logo">FINGERPRINT.AI</div>
      </div>

      <nav className="nav-section">
        <div className="nav-section-label">Operations</div>
        <div 
          className={`nav-item ${activeView === 'triage' ? 'active' : ''}`}
          onClick={() => onViewChange('triage')}
        >
          <span className="nav-icon">📊</span>
          <span>Triage Dashboard</span>
        </div>
      </nav>

      <nav className="nav-section">
        <div className="nav-section-label">Trust & Audit</div>
        <div 
          className={`nav-item ${activeView === 'medical-audit' ? 'active' : ''}`}
          onClick={() => onViewChange('medical-audit')}
        >
          <span className="nav-icon">📜</span>
          <span>Medical Audit Trail</span>
        </div>
      </nav>

      <nav className="nav-section">
        <div className="nav-section-label">System Architecture</div>
        <div 
          className={`nav-item ${activeView === 'governance' ? 'active' : ''}`}
          onClick={() => onViewChange('governance')}
        >
          <span className="nav-icon">🛡️</span>
          <span>Agent Governance</span>
        </div>
        <div 
          className={`nav-item ${activeView === 'behavior-audit' ? 'active' : ''}`}
          onClick={() => onViewChange('behavior-audit')}
        >
          <span className="nav-icon">🧬</span>
          <span>Behavioral Drift Audit</span>
        </div>
      </nav>
      
      <div style={{ marginTop: 'auto', padding: '0 24px', opacity: 0.5, fontSize: '0.7rem' }}>
        v1.2.0-stabilized
      </div>
    </aside>
  );
};
