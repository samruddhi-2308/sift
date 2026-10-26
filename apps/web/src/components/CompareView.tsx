import React, { useState } from 'react';
import { SearchCompareResponse, SearchResultItem } from '../types';

export const CompareView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchCompareResponse | null>(null);

  const executeCompare = async (qText: string) => {
    if (!qText.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const p = new URLSearchParams({
        q: qText.trim(),
        limit: limit.toString(),
      });
      if (domain.trim()) p.set('domain', domain.trim());

      const res = await fetch(`/search/compare?${p.toString()}`);
      if (!res.ok) throw new Error(`Comparison failed with status ${res.status}`);
      const compData: SearchCompareResponse = await res.json();
      setData(compData);
    } catch (err: any) {
      setError(err.message || 'Comparison failed');
    } finally {
      setLoading(false);
    }
  };

  const handleCompare = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    executeCompare(query);
  };

  const handleChipClick = (sampleQuery: string) => {
    setQuery(sampleQuery);
    executeCompare(sampleQuery);
  };

  // Helper to check if a document URL exists in other modes
  const getOverlapBadge = (currentUrl: string, otherLists: SearchResultItem[][]) => {
    const presentIn = otherLists.filter((list) => list.some((r) => r.url === currentUrl)).length;
    if (presentIn === 3) {
      return <span className="badge badge-success" title="Present in all 4 retrieval modes">Universal 🎯</span>;
    } else if (presentIn === 0) {
      return <span className="badge badge-warning" title="Unique to this retrieval method">Unique ⭐</span>;
    }
    return <span className="badge" style={{ background: 'rgba(255, 255, 255, 0.08)', color: 'var(--text-secondary)' }}>Shared ({presentIn + 1}/4)</span>;
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '2rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
          <span className="badge badge-purple">4-WAY MULTI-ENGINE BENCHMARK</span>
        </div>
        <h2 style={{ fontSize: '1.6rem', marginBottom: '0.5rem', fontWeight: 800 }}>
          Side-by-Side Retrieval Engine Evaluation
        </h2>
        <p style={{ color: 'var(--text-secondary)', fontSize: '0.92rem', marginBottom: '1.5rem', maxWidth: '800px' }}>
          Inspect ranking variance, candidate overlap, and latency tradeoffs across Lexical BM25, Qdrant Dense Vector HNSW,
          Reciprocal Rank Fusion, and Cross-Encoder Re-ranking on identical query inputs.
        </p>

        <form onSubmit={handleCompare}>
          <div className="search-input-group" style={{ marginBottom: '1rem' }}>
            <span className="search-icon-prefix">🔍</span>
            <input
              type="text"
              className="search-input"
              placeholder="Enter evaluation query (e.g. 'deep learning transformer architecture')..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <div className="search-actions-suffix">
              <button
                type="submit"
                className="btn btn-primary"
                disabled={loading || !query.trim()}
              >
                {loading ? 'Evaluating...' : 'Run 4-Way Comparison'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', alignItems: 'center' }}>
            <div className="filter-group">
              <span className="filter-label">Domain Filter:</span>
              <input
                type="text"
                className="filter-input"
                placeholder="Optional filter..."
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                style={{ width: '180px' }}
              />
            </div>

            <div className="filter-group">
              <span className="filter-label">Top K Candidates:</span>
              <select
                className="filter-input"
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
              >
                <option value={3}>Top 3</option>
                <option value={5}>Top 5</option>
                <option value={10}>Top 10</option>
              </select>
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
              <button
                type="button"
                className="chip"
                onClick={() => handleChipClick('books to scrape')}
              >
                ⚡ books to scrape
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => handleChipClick('machine learning transformer')}
              >
                ⚡ machine learning
              </button>
            </div>
          </div>
        </form>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-rose)', marginBottom: '1.5rem' }}>
          <strong style={{ color: 'var(--accent-rose)' }}>Evaluation Error: </strong>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div className="empty-state">
          <div className="pulse-dot" style={{ width: '16px', height: '16px', margin: '0 auto 1.5rem' }} />
          <h3>Executing 4 Concurrent Retrieval Pipelines...</h3>
          <p>Querying BM25, Qdrant HNSW, RRF aggregator, and Cross-Encoder model.</p>
        </div>
      )}

      {data && data.modes && (
        <div>
          <div className="latency-container" style={{ marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                ⚡ Parallel comparison finished in <strong>{data.timing.totalMs}ms</strong> across all 4 modes.
              </span>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <span className="badge badge-success">Universal = In all 4</span>
                <span className="badge badge-warning">Unique = 1 mode only</span>
              </div>
            </div>
          </div>

          <div className="compare-grid">
            {/* Column 1: Keyword */}
            <div className="compare-col">
              <div className="compare-header">
                <span className="title">1. BM25 Lexical</span>
                <span className="badge badge-primary">{data.modes.keyword.length} docs</span>
              </div>
              <div className="compare-sub">
                Exact & prefix text matching via MongoDB compound B-tree index.
              </div>
              {data.modes.keyword.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <strong style={{ fontSize: '0.86rem', color: '#fff' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.vector, data.modes.hybrid, data.modes.hybrid_rerank])}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', marginBottom: '0.5rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>

            {/* Column 2: Vector */}
            <div className="compare-col">
              <div className="compare-header">
                <span className="title">2. Dense Vector</span>
                <span className="badge badge-purple">{data.modes.vector.length} docs</span>
              </div>
              <div className="compare-sub">
                Qdrant HNSW cosine similarity over 768-dim BGE embeddings.
              </div>
              {data.modes.vector.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <strong style={{ fontSize: '0.86rem', color: '#fff' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.keyword, data.modes.hybrid, data.modes.hybrid_rerank])}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', marginBottom: '0.5rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>

            {/* Column 3: Hybrid RRF */}
            <div className="compare-col">
              <div className="compare-header">
                <span className="title">3. Hybrid RRF (k=60)</span>
                <span className="badge badge-warning">{data.modes.hybrid.length} docs</span>
              </div>
              <div className="compare-sub">
                Reciprocal Rank Fusion interleaving lexical & semantic rankings.
              </div>
              {data.modes.hybrid.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <strong style={{ fontSize: '0.86rem', color: '#fff' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.keyword, data.modes.vector, data.modes.hybrid_rerank])}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', marginBottom: '0.5rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>

            {/* Column 4: Hybrid + Re-rank */}
            <div className="compare-col" style={{ borderColor: 'rgba(56, 189, 248, 0.45)', boxShadow: '0 0 25px rgba(56, 189, 248, 0.12)' }}>
              <div className="compare-header" style={{ background: 'linear-gradient(135deg, rgba(56, 189, 248, 0.2) 0%, rgba(99, 102, 241, 0.2) 100%)' }}>
                <span className="title" style={{ color: 'var(--accent-cyan)' }}>4. Hybrid + Re-rank ✨</span>
                <span className="badge badge-primary">{data.modes.hybrid_rerank.length} docs</span>
              </div>
              <div className="compare-sub">
                Top candidates re-scored by Cross-Encoder deep neural network.
              </div>
              {data.modes.hybrid_rerank.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item" style={{ background: 'rgba(56, 189, 248, 0.03)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.4rem' }}>
                    <strong style={{ fontSize: '0.86rem', color: '#fff' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.keyword, data.modes.vector, data.modes.hybrid])}
                  </div>
                  <div style={{ fontSize: '0.74rem', color: 'var(--accent-cyan)', marginBottom: '0.5rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
