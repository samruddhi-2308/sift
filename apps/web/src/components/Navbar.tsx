import React from 'react';

export type NavTab = 'search' | 'compare' | 'admin' | 'dlq' | 'traces';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  systemHealth: 'healthy' | 'degraded' | 'checking';
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onTabChange, systemHealth }) => {
  return (
    <header className="app-header">
      <div className="logo-group" onClick={() => onTabChange('search')}>
        <div className="logo-icon">⚡</div>
        <div className="logo-text">
          SIFT
          <span className="logo-badge">ENTERPRISE</span>
        </div>
      </div>

      <nav className="nav-tabs">
        <button
          className={`nav-tab-btn ${currentTab === 'search' ? 'active' : ''}`}
          onClick={() => onTabChange('search')}
        >
          <span>🔍</span> Search Engine
        </button>
        <button
          className={`nav-tab-btn ${currentTab === 'compare' ? 'active' : ''}`}
          onClick={() => onTabChange('compare')}
        >
          <span>⚖️</span> 4-Way Compare
        </button>
        <button
          className={`nav-tab-btn ${currentTab === 'admin' ? 'active' : ''}`}
          onClick={() => onTabChange('admin')}
        >
          <span>📊</span> Telemetry & Queues
        </button>
        <button
          className={`nav-tab-btn ${currentTab === 'dlq' ? 'active' : ''}`}
          onClick={() => onTabChange('dlq')}
        >
          <span>⚠️</span> DLQ Triage
        </button>
        <button
          className={`nav-tab-btn ${currentTab === 'traces' ? 'active' : ''}`}
          onClick={() => onTabChange('traces')}
        >
          <span>🤖</span> Agent Traces
        </button>
      </nav>

      <div className="header-status">
        <div className={`live-badge ${systemHealth === 'degraded' ? 'degraded' : ''}`}>
          <div className="pulse-dot" />
          <span>
            {systemHealth === 'healthy' ? 'Cluster Active' : systemHealth === 'degraded' ? 'Degraded' : 'Connecting...'}
          </span>
        </div>
      </div>
    </header>
  );
};
