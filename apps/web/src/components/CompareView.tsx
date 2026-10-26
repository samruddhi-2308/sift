import React, { useState } from 'react';
import { SearchCompareResponse, SearchResultItem } from '../types';

export const CompareView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [domain, setDomain] = useState('');
  const [limit, setLimit] = useState(5);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchCompareResponse | null>(null);

  const handleCompare = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!query.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const p = new URLSearchParams({
        q: query.trim(),
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

  // Helper to check if a document URL exists in other modes
  const getOverlapBadge = (currentUrl: string, otherLists: SearchResultItem[][]) => {
    const presentIn = otherLists.filter((list) => list.some((r) => r.url === currentUrl)).length;
    if (presentIn === 3) {
      return <span className="badge badge-success" title="Present in all 4 retrieval modes">Universal 🎯</span>;
    } else if (presentIn === 0) {
      return <span className="badge badge-warning" title="Unique to this retrieval method">Unique ⭐</span>;
    }
    return <span className="badge" style={{ opacity: 0.7 }}>Shared ({presentIn + 1}/4)</span>;
  };

  return (
    <div>
      <div className="card" style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '0.5rem', fontWeight: 600 }}>
          ⚖️ Side-by-Side 4-Way Search Mode Comparison
        </h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '0.88rem', marginBottom: '1.25rem' }}>
          Evaluate retrieval quality, ranking alignment, and latency across Keyword (BM25), Dense Vector (Qdrant HNSW),
          Hybrid Reciprocal Rank Fusion, and Cross-Encoder Re-ranking in real time.
        </p>

        <form onSubmit={handleCompare}>
          <div className="search-bar">
            <span style={{ fontSize: '1.25rem', opacity: 0.6 }}>🔍</span>
            <input
              type="text"
              placeholder="Enter evaluation query (e.g. 'deep learning transformer architecture')..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <button type="submit" className="btn btn-primary" disabled={loading || !query.trim()}>
              {loading ? 'Evaluating...' : 'Run 4-Way Comparison'}
            </button>
          </div>

          <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Domain:</span>
              <input
                type="text"
                placeholder="Optional filter..."
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                }}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Top K per column:</span>
              <select
                value={limit}
                onChange={(e) => setLimit(Number(e.target.value))}
                style={{
                  background: 'var(--bg-input)',
                  border: '1px solid var(--border-color)',
                  color: 'var(--text-main)',
                  padding: '6px 10px',
                  borderRadius: '6px',
                  fontSize: '0.82rem',
                }}
              >
                <option value={3}>3</option>
                <option value={5}>5</option>
                <option value={10}>10</option>
              </select>
            </div>
          </div>
        </form>
      </div>

      {error && (
        <div className="card" style={{ borderLeft: '4px solid var(--accent-red)', marginBottom: '1.5rem' }}>
          <span style={{ color: 'var(--accent-red)', fontWeight: 600 }}>Error: </span>
          <span>{error}</span>
        </div>
      )}

      {loading && (
        <div style={{ textAlign: 'center', padding: '3rem 0' }}>
          <div className="status-indicator active" style={{ width: '14px', height: '14px', margin: '0 auto 1rem' }} />
          <p style={{ color: 'var(--text-muted)' }}>Dispatching parallel queries to all 4 retrieval engines...</p>
        </div>
      )}

      {data && data.modes && (
        <div>
          <div className="card" style={{ marginBottom: '1.25rem', padding: '0.75rem 1.25rem' }}>
            <span style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              ⚡ Total comparison pipeline execution: <strong>{data.timing.totalMs}ms</strong>
            </span>
          </div>

          <div className="compare-grid">
            {/* Column 1: Keyword */}
            <div className="compare-col">
              <div className="compare-header">
                <span className="title">1. Keyword (BM25)</span>
                <span className="badge badge-purple">{data.modes.keyword.length} docs</span>
              </div>
              <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                Lexical exact & prefix match via MongoDB compound indices.
              </div>
              {data.modes.keyword.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.vector, data.modes.hybrid, data.modes.hybrid_rerank])}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginBottom: '0.4rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>

            {/* Column 2: Vector */}
            <div className="compare-col">
              <div className="compare-header">
                <span className="title">2. Dense Vector (Qdrant)</span>
                <span className="badge badge-purple">{data.modes.vector.length} docs</span>
              </div>
              <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                Cosine similarity over BGE-base embeddings via HNSW.
              </div>
              {data.modes.vector.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.keyword, data.modes.hybrid, data.modes.hybrid_rerank])}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginBottom: '0.4rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>

            {/* Column 3: Hybrid RRF */}
            <div className="compare-col">
              <div className="compare-header">
                <span className="title">3. Hybrid (RRF k=60)</span>
                <span className="badge badge-purple">{data.modes.hybrid.length} docs</span>
              </div>
              <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                Reciprocal Rank Fusion interleaving lexical and semantic scores.
              </div>
              {data.modes.hybrid.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.keyword, data.modes.vector, data.modes.hybrid_rerank])}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginBottom: '0.4rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>

            {/* Column 4: Hybrid + Re-rank */}
            <div className="compare-col" style={{ borderColor: 'var(--accent-primary)' }}>
              <div className="compare-header" style={{ background: 'rgba(59, 130, 246, 0.15)' }}>
                <span className="title" style={{ color: 'var(--accent-cyan)' }}>4. Hybrid + Re-ranked ✨</span>
                <span className="badge badge-primary">{data.modes.hybrid_rerank.length} docs</span>
              </div>
              <div style={{ padding: '0.5rem 0.75rem', fontSize: '0.78rem', color: 'var(--text-muted)', borderBottom: '1px solid var(--border-color)' }}>
                Top candidates evaluated by BGE Cross-Encoder reranker.
              </div>
              {data.modes.hybrid_rerank.map((r: SearchResultItem, i: number) => (
                <div key={r.documentId || r.urlHash || i} className="compare-item" style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '0.5rem', marginBottom: '0.35rem' }}>
                    <strong style={{ fontSize: '0.82rem', color: 'var(--text-main)' }}>#{i + 1} {r.title || 'Untitled'}</strong>
                    {getOverlapBadge(r.url, [data.modes.keyword, data.modes.vector, data.modes.hybrid])}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--accent-cyan)', marginBottom: '0.4rem', wordBreak: 'break-all' }}>
                    {r.url}
                  </div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', lineHeight: 1.4 }} dangerouslySetInnerHTML={{ __html: r.snippet }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
