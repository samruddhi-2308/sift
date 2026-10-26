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

  // Check backend health on mount and every 8s
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
    const interval = setInterval(checkHealth, 8000);
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
          borderTop: '1px solid var(--border-subtle)',
          padding: '2rem 1.5rem',
          textAlign: 'center',
          color: 'var(--text-muted)',
          fontSize: '0.85rem',
          background: 'rgba(5, 8, 20, 0.75)',
          backdropFilter: 'blur(16px)',
          marginTop: 'auto',
        }}
      >
        <div style={{ maxWidth: '800px', margin: '0 auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <div>
            <strong style={{ color: '#fff' }}>SIFT AI Search & Autonomous Browser Agent Platform</strong>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            High-Throughput Polite Crawling • Reciprocal Rank Fusion (k=60) • Qdrant HNSW 768d • Cross-Encoder Re-ranker • Playwright Guardrails
          </div>
        </div>
      </footer>
    </div>
  );
};
