import React, { useState, useEffect } from 'react';
import { Navbar, NavTab } from './components/Navbar';
import { SearchView } from './components/SearchView';
import { CompareView } from './components/CompareView';
import { AdminView } from './components/AdminView';
import { DlqView } from './components/DlqView';
import { AgentTracesView } from './components/AgentTracesView';

export const App: React.FC = () => {
  const [tab, setTab] = useState<NavTab>('search');
  const [systemHealth, setSystemHealth] = useState<'healthy' | 'degraded' | 'checking'>('checking');

  // Check backend health on mount and every 10s
  useEffect(() => {
    const checkHealth = async () => {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          setSystemHealth('healthy');
        } else {
          setSystemHealth('degraded');
        }
      } catch (e) {
        setSystemHealth('degraded');
      }
    };

    checkHealth();
    const interval = setInterval(checkHealth, 10000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="app-container">
      <Navbar currentTab={tab} onTabChange={setTab} systemHealth={systemHealth} />

      <main className="main-content">
        {tab === 'search' && <SearchView />}
        {tab === 'compare' && <CompareView />}
        {tab === 'admin' && <AdminView />}
        {tab === 'dlq' && <DlqView />}
        {tab === 'traces' && <AgentTracesView />}
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--border-color)',
          padding: '1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.8rem',
          marginTop: 'auto',
        }}
      >
        <div>
          <strong>SIFT Search & Autonomous Agent Platform</strong> • Distributed Crawling, BM25 Lexical + Qdrant Dense Vector + RRF Re-ranking
        </div>
      </footer>
    </div>
  );
};
