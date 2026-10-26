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
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
        <div>
          <h2 style={{ fontSize: '1.4rem', fontWeight: 700, margin: 0 }}>🤖 Autonomous Agent Trace Inspector</h2>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.85rem', margin: '0.25rem 0 0' }}>
            Replay agent step-by-step reasoning, DOM snapshots, action logs, and screenshot artifacts.
          </p>
        </div>

        <button className="btn btn-secondary" onClick={fetchTraces}>
          🔄 Refresh Traces
        </button>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Error: </span>
          <span>{error}</span>
        </div>
      )}

      {loading && traces.length === 0 && (
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="status-indicator active" style={{ width: '14px', height: '14px', margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--text-muted)' }}>Retrieving agent trajectory runs from trace repository...</p>
        </div>
      )}

      {traces.length === 0 && !loading && (
        <div className="card empty-state">
          <span className="empty-state-icon">🤖</span>
          <h3>No Agent Traces Found</h3>
          <p>Run autonomous browser tasks using the CLI or agent scripts to populate interactive traces.</p>
        </div>
      )}

      {traces.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem' }}>
          {/* Traces Sidebar */}
          <div className="card" style={{ padding: '1rem', maxHeight: '780px', overflowY: 'auto' }}>
            <h3 style={{ fontSize: '0.95rem', fontWeight: 600, marginBottom: '0.75rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
              Execution Sessions ({traces.length})
            </h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
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
                      padding: '0.75rem',
                      borderRadius: '8px',
                      cursor: 'pointer',
                      background: isSelected ? 'rgba(59, 130, 246, 0.15)' : 'var(--bg-input)',
                      border: isSelected ? '1px solid var(--accent-primary)' : '1px solid transparent',
                      transition: 'all 0.2s',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                      <span className={`badge ${t.status === 'success' ? 'badge-success' : 'badge-error'}`}>
                        {t.status.toUpperCase()}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                        {t.steps ? `${t.steps.length} steps` : '0 steps'}
                      </span>
                    </div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: 'var(--text-main)', marginBottom: '0.25rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {t.goal}
                    </div>
                    <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
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
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        Run ID: {selectedTrace.runId}
                      </span>
                    </div>
                    <h3 style={{ fontSize: '1.15rem', fontWeight: 600, margin: '0 0 0.5rem' }}>
                      {selectedTrace.goal}
                    </h3>
                    <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)', flexWrap: 'wrap' }}>
                      <span>🌐 Target: <strong style={{ color: 'var(--accent-cyan)' }}>{selectedTrace.url}</strong></span>
                      <span>⏱️ Duration: {selectedTrace.durationMs ? `${(selectedTrace.durationMs / 1000).toFixed(2)}s` : 'N/A'}</span>
                      <span>🔢 Tokens: {selectedTrace.totalTokens ?? 0}</span>
                      <span>💰 Cost: ${selectedTrace.estimatedCostUsd ? selectedTrace.estimatedCostUsd.toFixed(5) : '0.00000'}</span>
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
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', borderBottom: '1px solid var(--border-color)', paddingBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem' }}>Step Timeline</span>
                      <span className="badge badge-purple">
                        {activeStepIndex + 1} of {selectedTrace.steps.length}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: '0.5rem' }}>
                      <button
                        className="btn btn-secondary"
                        disabled={activeStepIndex === 0}
                        onClick={() => setActiveStepIndex((prev) => Math.max(0, prev - 1))}
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                      >
                        ◀ Previous Step
                      </button>
                      <button
                        className="btn btn-secondary"
                        disabled={activeStepIndex === selectedTrace.steps.length - 1}
                        onClick={() => setActiveStepIndex((prev) => Math.min(selectedTrace.steps.length - 1, prev + 1))}
                        style={{ padding: '4px 10px', fontSize: '0.8rem' }}
                      >
                        Next Step ▶
                      </button>
                    </div>
                  </div>

                  {/* Step Selector Pills */}
                  <div style={{ display: 'flex', gap: '0.4rem', overflowX: 'auto', paddingBottom: '0.75rem', marginBottom: '1rem' }}>
                    {selectedTrace.steps.map((st: AgentStepRecord, i: number) => (
                      <button
                        key={i}
                        onClick={() => setActiveStepIndex(i)}
                        className="btn"
                        style={{
                          padding: '4px 8px',
                          fontSize: '0.75rem',
                          background: activeStepIndex === i ? 'var(--accent-primary)' : 'var(--bg-input)',
                          color: activeStepIndex === i ? '#fff' : 'var(--text-muted)',
                          border: 'none',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        #{i + 1} {st.action?.name ? st.action.name.toUpperCase() : 'STEP'}
                      </button>
                    ))}
                  </div>

                  {/* Current Step Content */}
                  {currentStep && (
                    <div style={{ display: 'grid', gridTemplateColumns: currentStep.screenshotBase64 ? '1fr 1fr' : '1fr', gap: '1.25rem' }}>
                      <div>
                        <div style={{ marginBottom: '1rem' }}>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Action Executed
                          </span>
                          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.25rem' }}>
                            <span className="badge badge-primary" style={{ fontSize: '0.85rem' }}>
                              {currentStep.action?.name ? currentStep.action.name.toUpperCase() : 'ACTION'}
                            </span>
                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                              Duration: {currentStep.durationMs ? `${currentStep.durationMs}ms` : 'N/A'}
                            </span>
                            <span className={`badge ${currentStep.actionResult?.success ? 'badge-success' : 'badge-error'}`}>
                              {currentStep.actionResult?.success ? 'Success' : 'Failed'}
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
                                background: 'rgba(59, 130, 246, 0.08)',
                                borderLeft: '3px solid var(--accent-primary)',
                                padding: '0.75rem',
                                borderRadius: '4px',
                                fontSize: '0.82rem',
                                marginTop: '0.25rem',
                                color: 'var(--text-main)',
                                lineHeight: 1.5,
                              }}
                            >
                              💭 {currentStep.action.thought}
                            </div>
                          </div>
                        )}

                        <div>
                          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                            Parameters & Payloads
                          </span>
                          <pre
                            style={{
                              background: 'var(--bg-input)',
                              padding: '0.75rem',
                              borderRadius: '6px',
                              fontSize: '0.75rem',
                              fontFamily: 'var(--font-mono)',
                              maxHeight: '220px',
                              overflowY: 'auto',
                              marginTop: '0.25rem',
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
                            Page Viewport Snapshot
                          </span>
                          <div
                            style={{
                              marginTop: '0.25rem',
                              border: '1px solid var(--border-color)',
                              borderRadius: '8px',
                              overflow: 'hidden',
                              background: '#000',
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
