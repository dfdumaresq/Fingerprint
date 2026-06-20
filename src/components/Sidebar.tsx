import React, { useState } from 'react';

export type PlatformView = 'triage' | 'medical-audit' | 'governance' | 'behavior-audit';

interface SidebarProps {
  activeView: PlatformView;
  onViewChange: (view: PlatformView) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

interface NavItem {
  view: PlatformView;
  icon: string;
  label: string;
}

const NAV_SECTIONS: { label: string; items: NavItem[] }[] = [
  {
    label: 'Operations',
    items: [
      { view: 'triage',         icon: '📊', label: 'Triage Dashboard' },
    ],
  },
  {
    label: 'Trust & Audit',
    items: [
      { view: 'medical-audit',  icon: '📜', label: 'Medical Audit Trail' },
    ],
  },
  {
    label: 'System Architecture',
    items: [
      { view: 'governance',     icon: '🛡️', label: 'Agent Governance' },
      { view: 'behavior-audit', icon: '🧬', label: 'Behavioral Drift Audit' },
    ],
  },
];

export const Sidebar: React.FC<SidebarProps> = ({
  activeView,
  onViewChange,
  collapsed,
  onToggleCollapse,
}) => {
  return (
    <aside className={`sidebar${collapsed ? ' sidebar--collapsed' : ''}`}>

      {/* Header */}
      <div className="sidebar-header">
        {!collapsed && <div className="sidebar-logo">FINGERPRINT.AI</div>}
        <button
          className="sidebar-toggle"
          onClick={onToggleCollapse}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? '›' : '‹'}
        </button>
      </div>

      {/* Nav sections */}
      {NAV_SECTIONS.map(section => (
        <nav className="nav-section" key={section.label}>
          {!collapsed && (
            <div className="nav-section-label">{section.label}</div>
          )}
          {section.items.map(item => (
            <div
              key={item.view}
              className={`nav-item${activeView === item.view ? ' active' : ''}`}
              onClick={() => onViewChange(item.view)}
              title={collapsed ? item.label : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {!collapsed && <span className="nav-label">{item.label}</span>}
            </div>
          ))}
        </nav>
      ))}

      {/* Version badge */}
      <div className="sidebar-version">
              {collapsed ? 'v1.4' : 'v1.4.0'}
      </div>

    </aside>
  );
};
