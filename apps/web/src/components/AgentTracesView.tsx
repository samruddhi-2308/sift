import React, { useState, useEffect } from 'react';
import { AgentTraceItem, AgentStepRecord } from '../types';

export const AgentTracesView: React.FC = () => {
  const [traces, setTraces] = useState<AgentTraceItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedTrace, setSelectedTrace] = useState<AgentTraceItem | null>(null);
  const [activeStepIndex, setActiveStepIndex] = useState(0);

  const fetchTraces = async () => {
    setLoading(true);
    try {
      const res = await fetch('/admin/traces');
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching agent traces`);
      const data: AgentTraceItem[] = await res.json();
      setTraces(data || []);
      if (data && data.length > 0 && !selectedTrace) {
        setSelectedTrace(data[0]);
        setActiveStepIndex(0);
      }
      setError(null);
    } catch (err: any) {
      setError(err.message || 'Error loading agent execution traces');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTraces();
  }, []);

  const exportTraceJson = (trace: AgentTraceItem) => {
    const blob = new Blob([JSON.stringify(trace, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sift-trace-${trace.runId}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const currentStep = selectedTrace && selectedTrace.steps ? selectedTrace.steps[activeStepIndex] : null;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.4rem' }}>
            <span className="badge badge-purple">AUTONOMOUS AGENT REPLAY</span>
          </div>
          <h2 style={{ fontSize: '1.75rem', fontWeight: 800, margin: 0 }}>
            Browser Agent Trace Inspector
          </h2>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', margin: '0.25rem 0 0' }}>
            Replay agent step-by-step reasoning, DOM snapshots, action payloads, and viewport screenshot artifacts.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchTraces}>
          🔄 Refresh Traces
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-rose)', marginBottom: '1.5rem' }}>
          <strong style={{ color: 'var(--accent-rose)' }}>Trace Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {loading && traces.length === 0 && (
        <div className="empty-state">
          <div className="pulse-dot" style={{ width: '16px', height: '16px', margin: '0 auto 1.5rem' }} />
          <h3>Retrieving agent trajectory runs from trace repository...</h3>
          <p>Connecting to MongoDB collection agent_runs.</p>
        </div>
      )}

      {traces.length === 0 && !loading && (
        <div className="empty-state glass-panel">
          <div className="empty-icon">🤖</div>
          <h3>No Agent Traces Recorded Yet</h3>
          <p>Run autonomous browser tasks using the CLI (e.g. <code>pnpm agent:run</code>) to generate interactive traces.</p>
        </div>
      )}

      {traces.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem' }}>
          {/* Traces Sidebar */}
          <div className="card" style={{ padding: '1.25rem', maxHeight: '780px', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '0.85rem', fontWeight: 700, marginBottom: '0.85rem', textTransform: 'uppercase', color: 'var(--text-muted)', letterSpacing: '0.05em' }}>
              Execution Sessions ({traces.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              {traces.map((t: AgentTraceItem) => {
                const isSelected = selectedTrace?.runId === t.runId;
                return (
                  <div
                    key={t.runId}
                    onClick={() => {
                      setSelectedTrace(t);
                      setActiveStepIndex(0);
                    }}
                    style={{
                      padding: '0.85rem 1rem',
                      borderRadius: '12px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(56, 189, 248, 0.12)' : 'rgba(255, 255, 255, 0.03)',
                      border: isSelected ? '1px solid var(--accent-cyan)' : '1px solid var(--border-subtle)',
                      boxShadow: isSelected ? '0 0 15px rgba(56, 189, 248, 0.15)' : 'none',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
                      <span className={`badge ${t.status === 'success' ? 'badge-success' : 'badge-error'}`}>
                        {t.status.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        {t.steps ? `${t.steps.length} steps` : '0 steps'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.86rem', fontWeight: 700, color: '#fff', marginBottom: '0.35rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.goal}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                      {new Date(t.startedAt).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Trace Details & Step Viewer */}
          {selectedTrace && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              {/* Header Card */}
              <div className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '1rem' }}>
                  <div>
                    <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                      <span className={`badge ${selectedTrace.status === 'success' ? 'badge-success' : 'badge-error'}`}>
                        {selectedTrace.status.toUpperCase()}
                      </span>
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.78rem', color: 'var(--accent-cyan)' }}>
                        Run ID: {selectedTrace.runId}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.25rem', fontWeight: 800, margin: '0 0 0.5rem' }}>
                      {selectedTrace.goal}
                    </h3>
                    <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.82rem', color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
                      <span>🌐 Target: <strong style={{ color: 'var(--accent-cyan)' }}>{selectedTrace.url}</strong></span>
                      <span>⏱️ Duration: <strong>{selectedTrace.durationMs ? `${(selectedTrace.durationMs / 1000).toFixed(2)}s` : 'N/A'}</strong></span>
                      <span>🔢 Tokens: <strong>{selectedTrace.totalTokens ?? 0}</strong></span>
                      <span>💰 Cost: <strong>${selectedTrace.estimatedCostUsd ? selectedTrace.estimatedCostUsd.toFixed(5) : '0.00000'}</strong></span>
                    </div>
                  </div>

                  <button
                    className="btn btn-secondary"
                    onClick={() => exportTraceJson(selectedTrace)}
                  >
                    📥 Export JSON
                  </button>
                </div>
              </div>

              {/* Step Carousel / Navigation */}
              {selectedTrace.steps && selectedTrace.steps.length > 0 && (
                <div className="card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-subtle)', paddingBottom: '0.85rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                      <span style={{ fontWeight: 700, fontSize: '1rem' }}>Step Timeline</span>
                      <span className="badge badge-purple">
                        Step {activeStepIndex + 1} of {selectedTrace.steps.length}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-secondary"
                        disabled={activeStepIndex === 0}
                        onClick={() => setActiveStepIndex((prev) => Math.max(0, prev - 1))}
                        style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
                      >
                        ◀ Previous
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={activeStepIndex === selectedTrace.steps.length - 1}
                        onClick={() => setActiveStepIndex((prev) => Math.min(selectedTrace.steps!.length - 1, prev + 1))}
                        style={{ padding: '0.4rem 0.85rem', fontSize: '0.8rem' }}
                      >
                        Next ▶
                      </button>
                    </div>
                  </div>

                  {/* Step Selector Pills */}
                  <div style={{ display: 'flex', gap: '0.5rem', overflowX: 'auto', paddingBottom: '0.75rem', marginBottom: '1.25rem' }}>
                    {selectedTrace.steps.map((st: AgentStepRecord, i: number) => (
                      <button
                        key={i}
                        onClick={() => setActiveStepIndex(i)}
                        className="btn"
                        style={{
                          padding: '0.4rem 0.85rem',
                          fontSize: '0.78rem',
                          background: activeStepIndex === i ? 'var(--accent-indigo)' : 'rgba(255, 255, 255, 0.05)',
                          color: activeStepIndex === i ? '#fff' : 'var(--text-secondary)',
                          border: activeStepIndex === i ? '1px solid rgba(99, 102, 241, 0.5)' : '1px solid var(--border-subtle)',
                          boxShadow: activeStepIndex === i ? '0 0 12px rgba(99, 102, 241, 0.35)' : 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        #{i + 1} {st.action?.name ? st.action.name.toUpperCase() : 'STEP'}
                      </button>
                    ))}
                  </div>

                  {/* Current Step Content */}
                  {currentStep && (
                    <div style={{ display: 'grid', gridTemplateColumns: currentStep.screenshotBase64 ? '1fr 1fr' : '1fr', gap: '1.5rem' }}>
                      <div>
                        <div style={{ marginBottom: '1rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Action Executed
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.35rem' }}>
                            <span className="badge badge-primary" style={{ fontSize: '0.9rem', padding: '4px 10px' }}>
                              {currentStep.action?.name ? currentStep.action.name.toUpperCase() : 'ACTION'}
                            </span>
                            <span style={{ fontSize: '0.82rem', color: 'var(--text-secondary)' }}>
                              Duration: <strong>{currentStep.durationMs ? `${currentStep.durationMs}ms` : 'N/A'}</strong>
                            </span>
                            <span className={`badge ${currentStep.actionResult?.success ? 'badge-success' : 'badge-error'}`}>
                              {currentStep.actionResult?.success ? 'Executed Successfully' : 'Action Failed'}
                            </span>
                          </div>
                        </div>

                        {currentStep.action?.thought && (
                          <div style={{ marginBottom: '1rem' }}>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                              Planner Reasoning & Mental Model
                            </span>
                            <div
                              style={{
                                background: 'rgba(56, 189, 248, 0.08)',
                                borderLeft: '3px solid var(--accent-cyan)',
                                padding: '0.85rem 1rem',
                                borderRadius: '8px',
                                fontSize: '0.88rem',
                                marginTop: '0.35rem',
                                color: '#f1f5f9',
                                lineHeight: 1.6,
                              }}
                            >
                              💭 {currentStep.action.thought}
                            </div>
                          </div>
                        )}

                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Action Parameters & Payloads
                          </span>
                          <pre
                            style={{
                              background: 'rgba(5, 8, 20, 0.85)',
                              padding: '1rem',
                              borderRadius: '10px',
                              fontSize: '0.78rem',
                              fontFamily: 'var(--font-mono)',
                              maxHeight: '220px',
                              overflowY: 'auto',
                              marginTop: '0.35rem',
                              border: '1px solid var(--border-subtle)',
                              color: '#cbd5e1',
                            }}
                          >
                            {JSON.stringify(currentStep.action.args, null, 2)}
                          </pre>
                        </div>
                      </div>

                      {/* Screenshot / Artifact Column */}
                      {currentStep.screenshotBase64 && (
                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Live Page Viewport Snapshot
                          </span>
                          <div
                            style={{
                              marginTop: '0.35rem',
                              border: '1px solid rgba(56, 189, 248, 0.3)',
                              borderRadius: '12px',
                              overflow: 'hidden',
                              background: '#000',
                              boxShadow: '0 8px 25px rgba(0, 0, 0, 0.6)',
                            }}
                          >
                            <img
                              src={
                                currentStep.screenshotBase64.startsWith('data:')
                                  ? currentStep.screenshotBase64
                                  : `data:image/png;base64,${currentStep.screenshotBase64}`
                              }
                              alt={`Step ${activeStepIndex + 1} Screenshot`}
                              style={{ width: '100%', height: 'auto', display: 'block' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};
