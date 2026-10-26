import React, { useState, useEffect } from 'react';
import { DlqJobItem, DlqResponse } from '../types';

export const DlqView: React.FC = () => {
  const [data, setData] = useState<DlqResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedJob, setSelectedJob] = useState<DlqJobItem | null>(null);
  const [replayingId, setReplayingId] = useState<string | null>(null);
  const [replaySuccess, setReplaySuccess] = useState<string | null>(null);

  const fetchDlq = async () => {
    setLoading(true);
    try {
      const res = await fetch('/admin/dlq?limit=50');
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching DLQ`);
      const d: DlqResponse = await res.json();
      setData(d);
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading dead letter queue');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchDlq();
  }, []);

  const handleReplay = async (jobId: string) => {
    setReplayingId(jobId);
    setReplaySuccess(null);
    try {
      const res = await fetch('/admin/dlq/replay', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobId }),
      });
      if (!res.ok) throw new Error(`Replay failed with status ${res.status}`);
      setReplaySuccess(`Job ${jobId} successfully requeued into sift-fetch!`);
      // Refresh list
      await fetchDlq();
    } catch (err: any) {
      setError(err.message || 'Replay failed');
    } finally {
      setReplayingId(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>⚠️ Dead Letter Queue (DLQ) Inspector</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            Review unrecoverable ingestion pipeline failures, inspect error classifications, and re-enqueue jobs.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchDlq}>
          🔄 Refresh DLQ
        </button>
      </div>

      {replaySuccess && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-green)', marginBottom: '1.5rem' }}>
          <span style={{ color: 'var(--accent-green)', fontWeight: 600 }}>Success: </span>
          <span>{replaySuccess}</span>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Error: </span>
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="status-indicator active" style={{ width: '14px', height: '14px', margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--text-muted)' }}>Retrieving dead letter queue entries...</p>
        </div>
      )}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedJob ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>
                Failed Jobs ({data.count} recorded)
              </h3>
              <span className="badge badge-purple">Showing top {data.jobs.length}</span>
            </div>

            {data.jobs.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-icon">🎉</span>
                <h3>Dead Letter Queue is Empty!</h3>
                <p>No unhandled failures have occurred in the crawl or indexing pipelines.</p>
              </div>
            ) : (
              <div style={{ overflowX: 'auto' }}>
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Job ID</th>
                      <th>Error Classification</th>
                      <th>Attempts</th>
                      <th>Failed At</th>
                      <th>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.jobs.map((j: DlqJobItem) => (
                      <tr
                        key={j.jobId}
                        onClick={() => setSelectedJob(j)}
                        style={{
                          cursor: 'pointer',
                          background: selectedJob?.jobId === j.jobId ? 'var(--bg-card-hover)' : 'transparent',
                        }}
                      >
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8rem' }}>
                          {j.jobId.slice(0, 14)}...
                        </td>
                        <td>
                          <span
                            className={`badge ${
                              j.errorClass.includes('TIMEOUT') || j.errorClass.includes('timeout')
                                ? 'badge-warning'
                                : 'badge-error'
                            }`}
                          >
                            {j.errorClass}
                          </span>
                        </td>
                        <td style={{ textAlign: 'center' }}>{j.attempts}</td>
                        <td style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>
                          {new Date(j.failedAt).toLocaleTimeString()}
                        </td>
                        <td>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                            disabled={replayingId === j.jobId || j.replayed}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleReplay(j.jobId);
                            }}
                          >
                            {replayingId === j.jobId ? 'Replaying...' : j.replayed ? 'Replayed' : 'Replay ↻'}
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {selectedJob && (
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 600, margin: 0 }}>
                  Job Diagnostics
                </h3>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                  onClick={() => setSelectedJob(null)}
                >
                  ✕ Close
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Job ID
                  </span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{selectedJob.jobId}</div>
                </div>

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Origin Queue
                  </span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.85rem' }}>{selectedJob.queueName}</div>
                </div>

                {selectedJob.payload && selectedJob.payload.url && (
                  <div>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                      Target URL
                    </span>
                    <div style={{ fontSize: '0.85rem', color: 'var(--accent-cyan)', wordBreak: 'break-all' }}>
                      {String(selectedJob.payload.url)}
                    </div>
                  </div>
                )}

                <div>
                  <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
                    Stack Trace & Diagnostics
                  </span>
                  <pre
                    style={{
                      background: 'var(--bg-input)',
                      padding: '0.75rem',
                      borderRadius: '8px',
                      fontSize: '0.75rem',
                      color: 'var(--accent-red)',
                      maxHeight: '260px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      marginTop: '0.25rem',
                    }}
                  >
                    {selectedJob.errorMessage}
                    {selectedJob.stackTrace ? `\n\n${selectedJob.stackTrace}` : ''}
                  </pre>
                </div>

                <div style={{ marginTop: '0.5rem' }}>
                  <button
                    className="btn btn-primary"
                    style={{ width: '100%' }}
                    disabled={replayingId === selectedJob.jobId || selectedJob.replayed}
                    onClick={() => handleReplay(selectedJob.jobId)}
                  >
                    {replayingId === selectedJob.jobId
                      ? 'Replaying into sift-fetch...'
                      : selectedJob.replayed
                      ? 'Already Replayed'
                      : 'Replay Job into sift-fetch ↻'}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
