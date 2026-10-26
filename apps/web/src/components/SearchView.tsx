import React, { useState, useEffect, useRef } from 'react';
import { SearchResponse, SearchResultItem, SearchMode } from '../types';

export const SearchView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [mode, setMode] = useState<SearchMode>('hybrid_rerank');
  const [domain, setDomain] = useState('');
  const [limit, setLimit] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<SearchResponse | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcut: '/' focuses search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === '/' && document.activeElement !== inputRef.current) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: query.trim(),
        mode,
        limit: limit.toString(),
      });
      if (domain.trim()) {
        params.set('domain', domain.trim());
      }

      const res = await fetch(`/search?${params.toString()}`);
      if (!res.ok) {
        throw new Error(`Search failed: HTTP ${res.status}`);
      }
      const data: SearchResponse = await res.json();
      setResults(data);
    } catch (err: any) {
      setError(err.message || 'An error occurred while executing search');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <form onSubmit={handleSearch}>
          <div className="search-bar">
            <span style={{ fontSize: '1.25rem', opacity: 0.6 }}>🔍</span>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search across ingested web corpora, docs, or schemas... (Press '/' to focus)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="kbd">/</span>
            <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: '1rem',
              alignItems: 'center',
              marginTop: '1.25rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-color)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Retrieval Mode:</span>
              <div style={{ display: 'inline-flex', background: 'var(--bg-card)', padding: '3px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                {(['hybrid_rerank', 'hybrid', 'vector', 'keyword'] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setMode(m)}
                    className="btn"
                    style={{
                      padding: '4px 10px',
                      fontSize: '0.78rem',
                      background: mode === m ? 'var(--accent-primary)' : 'transparent',
                      color: mode === m ? '#fff' : 'var(--text-muted)',
                      border: 'none',
                    }}
                  >
                    {m === 'hybrid_rerank' ? 'Hybrid + Re-rank' : m.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Domain Filter:</span>
              <input
                type="text"
                placeholder="e.g. books.toscrape.com"
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                }}
              />
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginLeft: 'auto' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Limit:</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  padding: '6px 12px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                }}
              >
                <option value={5}>5</option>
                <option value={10}>10</option>
                <option value={20}>20</option>
                <option value={50}>50</option>
              </select>
            </div>
          </div>
        </form>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Error executing search: </span>
          <span>{error}</span>
        </div>
      )}

      {results && results.timing && (
        <div className="card" style={{ marginBottom: '1.5rem', padding: '0.75rem 1.25rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
            <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-muted)' }}>
              ⚡ LATENCY BREAKDOWN (Found {results.total} results in {results.timing.totalMs}ms)
            </span>
            <div className="latency-bar">
              {results.timing.embedMs !== undefined && (
                <div className="latency-pill embed">
                  Embed: <strong>{results.timing.embedMs}ms</strong>
                </div>
              )}
              {results.timing.keywordMs !== undefined && (
                <div className="latency-pill keyword">
                  BM25 Keyword: <strong>{results.timing.keywordMs}ms</strong>
                </div>
              )}
              {results.timing.vectorMs !== undefined && (
                <div className="latency-pill vector">
                  Vector (HNSW): <strong>{results.timing.vectorMs}ms</strong>
                </div>
              )}
              {results.timing.fusionMs !== undefined && (
                <div className="latency-pill fusion">
                  RRF Fusion: <strong>{results.timing.fusionMs}ms</strong>
                </div>
              )}
              {results.timing.rerankMs !== undefined && (
                <div className="latency-pill rerank">
                  Cross-Encoder: <strong>{results.timing.rerankMs}ms</strong>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="status-indicator active" style={{ width: '14px', height: '14px', margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--text-muted)' }}>Executing multi-stage retrieval pipeline...</p>
        </div>
      )}

      {results && results.results && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {results.results.length === 0 ? (
            <div className="card empty-state">
              <span className="empty-state-icon">📭</span>
              <h3>No matching results</h3>
              <p>Try refining your query keywords or clearing domain filters.</p>
            </div>
          ) : (
            results.results.map((item: SearchResultItem, idx: number) => (
              <div key={item.documentId || item.urlHash || idx} className="result-card">
                <div className="result-card-header">
                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="result-title"
                  >
                    {item.title || item.url}
                  </a>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <span className="badge badge-primary">
                      Score: {item.score ? item.score.toFixed(4) : 'N/A'}
                    </span>
                    <span className="badge badge-purple">{results.mode}</span>
                  </div>
                </div>

                <div className="result-url">{item.url}</div>

                <div
                  className="result-snippet"
                  dangerouslySetInnerHTML={{ __html: item.snippet }}
                />

                <div className="result-meta">
                  <span>🌐 {item.domain}</span>
                  {item.source && <span>📂 Source: {item.source}</span>}
                  {item.fetchedAt && (
                    <span>📅 {new Date(item.fetchedAt).toLocaleDateString()}</span>
                  )}
                  {item.matchedTerms && item.matchedTerms.slice(0, 3).map((term: string, tIdx: number) => (
                    <span key={tIdx} style={{ background: 'var(--bg-input)', padding: '2px 8px', borderRadius: '4px' }}>
                      #{term}
                    </span>
                  ))}
                  <span style={{ marginLeft: 'auto', opacity: 0.6 }}>Doc ID: {item.documentId.slice(0, 12)}...</span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
