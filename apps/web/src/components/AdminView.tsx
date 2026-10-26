import React, { useState, useEffect } from 'react';
import { AdminStats, QueueDepthsResponse, QueueCountItem } from '../types';

export const AdminView: React.FC = () => {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [queues, setQueues] = useState<QueueDepthsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);

  const fetchMetrics = async () => {
    try {
      const [sRes, qRes] = await Promise.all([
        fetch('/admin/stats'),
        fetch('/admin/queues'),
      ]);

      if (!sRes.ok || !qRes.ok) {
        throw new Error('Failed to fetch cluster observability metrics');
      }

      const sData: AdminStats = await sRes.json();
      const qData: QueueDepthsResponse = await qRes.json();
      setStats(sData);
      setQueues(qData);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error connecting to admin APIs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics();
    if (!autoRefresh) return;
    const interval = setInterval(fetchMetrics, 3000);
    return () => clearInterval(interval);
  }, [autoRefresh]);

  const totalDlqErrors = stats?.dlqCounts
    ? Object.values(stats.dlqCounts).reduce((a, b) => a + b, 0)
    : 0;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span className="badge badge-primary">OBSERVABILITY & METRICS</span>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>
            Cluster Telemetry & Ingestion Queues
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.25rem 0 0' }}>
            Real-time telemetry across BullMQ ingestion pipelines, MongoDB index cardinality, and Qdrant vector index.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button
            className={`btn ${autoRefresh ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            {autoRefresh ? '⏱️ Polling: 3s Active' : '⏸️ Polling Paused'}
          </button>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '0.82rem', padding: '0.5rem 1rem' }}
            onClick={fetchMetrics}
          >
            🔄 Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-rose)', marginBottom: '1.5rem' }}>
          <strong style={{ color: 'var(--accent-rose)' }}>Cluster Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {loading && !stats && (
        <div className="empty-state">
          <div className="pulse-dot" style={{ width: '16px', height: '16px', margin: '0 auto 1.5rem' }} />
          <h3>Connecting to Sift API Gateway...</h3>
          <p>Aggregating pipeline metrics from Redis and MongoDB.</p>
        </div>
      )}

      {stats && (
        <div className="stats-grid">
          <div className="stat-card">
            <div className="stat-label">Total Ingested Documents</div>
            <div className="stat-value">{stats.totalDocuments.toLocaleString()}</div>
            <div className="stat-sub">Indexed across MongoDB collections</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Vector Embeddings Indexed</div>
            <div className="stat-value" style={{ color: 'var(--accent-cyan)' }}>
              {stats.embeddedDocuments.toLocaleString()}
            </div>
            <div className="stat-sub">Stored in Qdrant HNSW vector index</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Unembedded Queue Backlog</div>
            <div
              className="stat-value"
              style={{ color: stats.unembeddedDocuments > 0 ? 'var(--accent-amber)' : 'var(--accent-emerald)' }}
            >
              {stats.unembeddedDocuments.toLocaleString()}
            </div>
            <div className="stat-sub">Awaiting dense embedding worker</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Unique Domains Crawled</div>
            <div className="stat-value" style={{ color: 'var(--accent-purple)' }}>
              {stats.totalDomains.toLocaleString()}
            </div>
            <div className="stat-sub">Politeness & crawl delay partitioned</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Unresolved DLQ Failures</div>
            <div
              className="stat-value"
              style={{ color: totalDlqErrors > 0 ? 'var(--accent-rose)' : 'var(--accent-emerald)' }}
            >
              {totalDlqErrors}
            </div>
            <div className="stat-sub">Failed jobs pending triage</div>
          </div>

          <div className="stat-card">
            <div className="stat-label">Autonomous Agent Runs</div>
            <div className="stat-value">{stats.totalAgentRuns}</div>
            <div className="stat-sub">Browser automation task sessions</div>
          </div>
        </div>
      )}

      <div className="card" style={{ marginTop: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
          <div>
            <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
              ⚡ BullMQ Queue Depths & Pipeline Velocity
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '0.2rem 0 0' }}>
              Monitored job states across all 6 core ingestion worker queues.
            </p>
          </div>
          <span className="badge badge-primary">6 ACTIVE WORKERS</span>
        </div>

        {queues && queues.queues && (
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Queue Name</th>
                  <th>Waiting</th>
                  <th>Active</th>
                  <th>Delayed</th>
                  <th>Failed</th>
                  <th>Completed</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {queues.queues.map((q: QueueCountItem) => {
                  const hasPending = q.waiting > 0 || q.active > 0;
                  const hasErrors = q.failed > 0;
                  return (
                    <tr key={q.name}>
                      <td style={{ fontWeight: 700, fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>
                        sift-{q.name}
                      </td>
                      <td>
                        <span style={{ color: q.waiting > 0 ? 'var(--accent-amber)' : 'var(--text-muted)', fontWeight: q.waiting > 0 ? 700 : 400 }}>
                          {q.waiting}
                        </span>
                      </td>
                      <td>
                        <span style={{ color: q.active > 0 ? 'var(--accent-cyan)' : 'var(--text-muted)', fontWeight: q.active > 0 ? 700 : 400 }}>
                          {q.active}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{q.delayed}</td>
                      <td>
                        <span style={{ color: q.failed > 0 ? 'var(--accent-rose)' : 'var(--text-muted)', fontWeight: q.failed > 0 ? 700 : 400 }}>
                          {q.failed}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-secondary)' }}>{q.completed.toLocaleString()}</td>
                      <td>
                        {hasErrors ? (
                          <span className="badge badge-error">Errors Detected</span>
                        ) : hasPending ? (
                          <span className="badge badge-primary">Processing ⚡</span>
                        ) : (
                          <span className="badge badge-success">Idle / Drained</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
