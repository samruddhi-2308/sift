import React from 'react';

export type NavTab = 'search' | 'compare' | 'admin' | 'dlq' | 'traces';

interface NavbarProps {
  currentTab: NavTab;
  onTabChange: (tab: NavTab) => void;
  systemHealth: 'healthy' | 'degraded' | 'checking';
}

export const Navbar: React.FC<NavbarProps> = ({ currentTab, onTabChange, systemHealth }) => {
  return (
    <header className="navbar">
      <div className="navbar-brand" onClick={() => onTabChange('search')} style={{ cursor: 'pointer' }}>
        <div className="navbar-logo">⚡</div>
        <div>
          <span className="navbar-title">SIFT</span>
          <span className="navbar-badge">v1.0 • OBSERVER</span>
        </div>
      </div>

      <nav className="navbar-nav">
        <button
          className={`nav-btn ${currentTab === 'search' ? 'active' : ''}`}
          onClick={() => onTabChange('search')}
        >
          🔍 Search
        </button>
        <button
          className={`nav-btn ${currentTab === 'compare' ? 'active' : ''}`}
          onClick={() => onTabChange('compare')}
        >
          ⚖️ Compare (4-Way)
        </button>
        <button
          className={`nav-btn ${currentTab === 'admin' ? 'active' : ''}`}
          onClick={() => onTabChange('admin')}
        >
          📊 Admin & Queues
        </button>
        <button
          className={`nav-btn ${currentTab === 'dlq' ? 'active' : ''}`}
          onClick={() => onTabChange('dlq')}
        >
          ⚠️ DLQ Browser
        </button>
        <button
          className={`nav-btn ${currentTab === 'traces' ? 'active' : ''}`}
          onClick={() => onTabChange('traces')}
        >
          🤖 Agent Traces
        </button>
      </nav>

      <div className="navbar-status">
        <span
          className={`status-indicator ${
            systemHealth === 'healthy' ? 'healthy' : systemHealth === 'degraded' ? 'error' : ''
          }`}
        />
        <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
          {systemHealth === 'healthy' ? 'Cluster Active' : systemHealth === 'degraded' ? 'Degraded' : 'Connecting...'}
        </span>
      </div>
    </header>
  );
};
