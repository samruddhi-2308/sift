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
      await fetchDlq();
    } catch (err: any) {
      setError(err.message || 'Replay failed');
    } finally {
      setReplayingId(null);
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span className="badge badge-warning">FAULT TOLERANCE & TRIAGE</span>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>
            Dead Letter Queue (DLQ) Inspector
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.25rem 0 0' }}>
            Review unrecoverable ingestion pipeline failures, inspect error classifications, and execute 1-click re-enqueueing.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchDlq}>
          🔄 Refresh DLQ
        </button>
      </div>

      {replaySuccess && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-emerald)', marginBottom: '1.5rem', background: 'rgba(16, 185, 129, 0.08)' }}>
          <strong style={{ color: 'var(--accent-emerald)' }}>Success: </strong>
          <span>{replaySuccess}</span>
        </div>
      )}

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-rose)', marginBottom: '1.5rem' }}>
          <strong style={{ color: 'var(--accent-rose)' }}>Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {loading && !data && (
        <div className="empty-state">
          <div className="pulse-dot" style={{ width: '16px', height: '16px', margin: '0 auto 1.5rem' }} />
          <h3>Retrieving dead letter queue entries...</h3>
          <p>Connecting to DLQ repository in MongoDB.</p>
        </div>
      )}

      {data && (
        <div style={{ display: 'grid', gridTemplateColumns: selectedJob ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
              <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                Failed Jobs ({data.count} recorded)
              </h3>
              <span className="badge badge-purple">Showing top {data.jobs.length}</span>
            </div>

            {data.jobs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-icon">🎉</div>
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
                          background: selectedJob?.jobId === j.jobId ? 'rgba(56, 189, 248, 0.08)' : 'transparent',
                        }}
                      >
                        <td style={{ fontFamily: 'var(--font-mono)', fontSize: '0.82rem', color: 'var(--accent-cyan)' }}>
                          {j.jobId.slice(0, 16)}...
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
                        <td style={{ textAlign: 'center', fontWeight: 600 }}>{j.attempts}</td>
                        <td style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                          {new Date(j.failedAt).toLocaleTimeString()}
                        </td>
                        <td>
                          <button
                            className="btn btn-primary"
                            style={{ padding: '4px 10px', fontSize: '0.78rem' }}
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
            <div className="card" style={{ borderColor: 'rgba(56, 189, 248, 0.3)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 700, margin: 0 }}>
                  Job Diagnostics & Stack Trace
                </h3>
                <button
                  className="btn btn-secondary"
                  style={{ padding: '4px 10px', fontSize: '0.78rem' }}
                  onClick={() => setSelectedJob(null)}
                >
                  ✕ Close
                </button>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Job ID
                  </span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', color: '#fff' }}>{selectedJob.jobId}</div>
                </div>

                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Origin Queue
                  </span>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: '0.88rem', color: 'var(--accent-cyan)' }}>{selectedJob.queueName}</div>
                </div>

                {selectedJob.payload && selectedJob.payload.url && (
                  <div>
                    <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                      Target URL
                    </span>
                    <div style={{ fontSize: '0.88rem', color: 'var(--accent-cyan)', wordBreak: 'break-all' }}>
                      {String(selectedJob.payload.url)}
                    </div>
                  </div>
                )}

                <div>
                  <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Error Message & Trace
                  </span>
                  <pre
                    style={{
                      background: 'rgba(5, 8, 20, 0.85)',
                      padding: '1rem',
                      borderRadius: '10px',
                      fontSize: '0.78rem',
                      color: 'var(--accent-rose)',
                      maxHeight: '280px',
                      overflowY: 'auto',
                      whiteSpace: 'pre-wrap',
                      marginTop: '0.4rem',
                      border: '1px solid rgba(244, 63, 94, 0.2)',
                      fontFamily: 'var(--font-mono)',
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
