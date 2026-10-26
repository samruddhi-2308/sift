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

  const executeSearchWithQuery = async (searchQuery: string) => {
    if (!searchQuery.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        q: searchQuery.trim(),
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

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    executeSearchWithQuery(query);
  };

  const handleChipClick = (sampleQuery: string) => {
    setQuery(sampleQuery);
    executeSearchWithQuery(sampleQuery);
  };

  // Compute percentage widths for stacked latency bar
  const timings = results?.timing;
  const totalMs = timings?.totalMs || 1;
  const embedPct = Math.round(((timings?.embedMs || 0) / totalMs) * 100);
  const keywordPct = Math.round(((timings?.keywordMs || 0) / totalMs) * 100);
  const vectorPct = Math.round(((timings?.vectorMs || 0) / totalMs) * 100);
  const fusionPct = Math.round(((timings?.fusionMs || 0) / totalMs) * 100);
  const rerankPct = Math.round(((timings?.rerankMs || 0) / totalMs) * 100);

  return (
    <div>
      {/* Hero Section */}
      <div className="search-hero">
        <div className="hero-tag">
          <span>⚡</span> Next-Gen Hybrid Search Engine
        </div>
        <h1>Search with Precision & Scale</h1>
        <p>
          Parallel BM25 Lexical + Qdrant Dense Vector retrieval, unified via Reciprocal Rank Fusion & Cross-Encoder re-ranking.
        </p>

        {/* Search Input Box */}
        <div className="search-box-wrap">
          <form onSubmit={handleSearch}>
            <div className="search-input-group">
              <span className="search-icon-prefix">🔍</span>
              <input
                ref={inputRef}
                type="text"
                className="search-input"
                placeholder="Search web documents, articles, book titles... (Press '/' to focus)"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <div className="search-actions-suffix">
                <span className="kbd-shortcut">/</span>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={loading || !query.trim()}
                  style={{ padding: '0.65rem 1.25rem' }}
                >
                  {loading ? 'Searching...' : 'Search'}
                </button>
              </div>
            </div>
          </form>
        </div>

        {/* Suggestion Chips */}
        <div className="suggestion-chips">
          <button className="chip" onClick={() => handleChipClick('machine learning transformer')}>
            ⚡ Try: machine learning transformer
          </button>
          <button className="chip" onClick={() => handleChipClick('books to scrape')}>
            ⚡ Try: books to scrape
          </button>
          <button className="chip" onClick={() => handleChipClick('distributed consensus raft')}>
            ⚡ Try: distributed consensus raft
          </button>
          <button className="chip" onClick={() => handleChipClick('quantum computing')}>
            ⚡ Try: quantum computing
          </button>
        </div>
      </div>

      {/* Filter and Mode Bar */}
      <div className="filter-bar">
        <div className="filter-group">
          <span className="filter-label">Retrieval Mode:</span>
          <div className="mode-selector">
            {(['hybrid_rerank', 'hybrid', 'vector', 'keyword'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`mode-btn ${mode === m ? 'active' : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'hybrid_rerank' ? 'Hybrid + Re-rank ✨' : m.toUpperCase()}
              </button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <div className="filter-group">
            <span className="filter-label">Domain:</span>
            <input
              type="text"
              className="filter-input"
              placeholder="e.g. books.toscrape.com"
              value={domain}
              onChange={(e) => setDomain(e.target.value)}
              style={{ width: '180px' }}
            />
          </div>

          <div className="filter-group">
            <span className="filter-label">Limit:</span>
            <select
              className="filter-input"
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>
          </div>
        </div>
      </div>

      {/* Error Message */}
      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-rose)', marginBottom: '2rem' }}>
          <strong style={{ color: 'var(--accent-rose)' }}>Search Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {/* Latency Telemetry Breakdown */}
      {results && results.timing && (
        <div className="latency-container">
          <div className="latency-header">
            <div className="latency-title">
              <span>⚡</span>
              <span>MULTI-STAGE PIPELINE LATENCY: Found {results.total} results in {results.timing.totalMs}ms</span>
            </div>
            <span className="badge badge-purple">{results.mode.toUpperCase()}</span>
          </div>

          <div className="latency-pills-row">
            {timings?.embedMs !== undefined && (
              <div className="latency-chip embed">
                <span>Embed:</span> <strong>{timings.embedMs}ms</strong>
              </div>
            )}
            {timings?.keywordMs !== undefined && (
              <div className="latency-chip keyword">
                <span>BM25 Lexical:</span> <strong>{timings.keywordMs}ms</strong>
              </div>
            )}
            {timings?.vectorMs !== undefined && (
              <div className="latency-chip vector">
                <span>HNSW Vector:</span> <strong>{timings.vectorMs}ms</strong>
              </div>
            )}
            {timings?.fusionMs !== undefined && (
              <div className="latency-chip fusion">
                <span>RRF Fusion:</span> <strong>{timings.fusionMs}ms</strong>
              </div>
            )}
            {timings?.rerankMs !== undefined && (
              <div className="latency-chip rerank">
                <span>Cross-Encoder:</span> <strong>{timings.rerankMs}ms</strong>
              </div>
            )}
            <div className="latency-chip total">
              <span>Total:</span> <strong>{timings?.totalMs}ms</strong>
            </div>
          </div>

          {/* Visual Stacked Progress Bar */}
          <div className="latency-stacked-bar">
            {embedPct > 0 && <div className="stacked-segment embed" style={{ width: `${embedPct}%` }} title={`Embed: ${timings?.embedMs}ms`} />}
            {keywordPct > 0 && <div className="stacked-segment keyword" style={{ width: `${keywordPct}%` }} title={`Keyword: ${timings?.keywordMs}ms`} />}
            {vectorPct > 0 && <div className="stacked-segment vector" style={{ width: `${vectorPct}%` }} title={`Vector: ${timings?.vectorMs}ms`} />}
            {fusionPct > 0 && <div className="stacked-segment fusion" style={{ width: `${fusionPct}%` }} title={`Fusion: ${timings?.fusionMs}ms`} />}
            {rerankPct > 0 && <div className="stacked-segment rerank" style={{ width: `${rerankPct}%` }} title={`Rerank: ${timings?.rerankMs}ms`} />}
          </div>
        </div>
      )}

      {/* Loading Spinner */}
      {loading && (
        <div className="empty-state">
          <div className="pulse-dot" style={{ width: '16px', height: '16px', margin: '0 auto 1.5rem' }} />
          <h3>Executing Multi-Stage Retrieval...</h3>
          <p>Querying MongoDB compound text index and Qdrant dense vector collection concurrently.</p>
        </div>
      )}

      {/* Results List */}
      {results && results.results && (
        <div className="results-list">
          {results.results.length === 0 ? (
            <div className="empty-state glass-panel">
              <div className="empty-icon">📭</div>
              <h3>No matching documents</h3>
              <p>Try refining your query terms, removing domain filters, or using different keywords.</p>
            </div>
          ) : (
            results.results.map((item: SearchResultItem, idx: number) => (
              <div key={item.documentId || item.urlHash || idx} className="result-card">
                <div className="result-header">
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
                    <span className="badge badge-purple">
                      Rank #{idx + 1}
                    </span>
                  </div>
                </div>

                <div className="result-url">
                  <span>🔗</span> {item.url}
                </div>

                <div
                  className="result-snippet"
                  dangerouslySetInnerHTML={{ __html: item.snippet }}
                />

                <div className="result-meta-footer">
                  <span>🌐 <strong>{item.domain}</strong></span>
                  {item.source && <span>📂 Source: {item.source}</span>}
                  {item.fetchedAt && (
                    <span>📅 {new Date(item.fetchedAt).toLocaleDateString()}</span>
                  )}
                  {item.matchedTerms && item.matchedTerms.slice(0, 3).map((term: string, tIdx: number) => (
                    <span key={tIdx} style={{ background: 'rgba(255, 255, 255, 0.06)', padding: '2px 8px', borderRadius: '4px' }}>
                      #{term}
                    </span>
                  ))}
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', opacity: 0.5 }}>
                    ID: {item.documentId ? item.documentId.slice(0, 10) : item.urlHash?.slice(0, 10)}...
                  </span>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};
