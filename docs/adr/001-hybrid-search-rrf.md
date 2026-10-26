# ADR 001: Reciprocal Rank Fusion (RRF) for Hybrid Search

## Status
Accepted

## Context
A major challenge in hybrid retrieval systems combining lexical search (BM25) and dense vector search (HNSW Cosine similarity) is score calibration:
- BM25 produces unbounded positive floating-point scores ($[0, \infty)$) dependent on document length and term frequencies.
- Cosine similarity produces bounded values ($[-1, 1]$ or $[0, 1]$).
- Linear combination ($S = \alpha \cdot S_{\text{bm25}} + (1 - \alpha) \cdot S_{\text{vector}}$) requires query-by-query normalization (e.g. min-max scaling) that is extremely sensitive to outlier scores and requires calibration of $\alpha$ across distinct query distributions.

## Decision
We adopted **Reciprocal Rank Fusion (RRF)** as the default ranking mechanism for interleaving candidates from lexical and vector retrieval systems, configured with the standard smoothing constant $k = 60$:

$$RRF(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$$

Where:
- $M = \{\text{lexical}, \text{vector}\}$
- $r_m(d)$ is the 1-based ordinal rank of document $d$ in the results of engine $m$.
- $k = 60$ is the ranking constant empirically proven in TREC evaluations to dampen the impact of top-ranked outliers while rewarding documents appearing high in both lists.

## Consequences

### Positive
- **Scale Invariant**: Operates purely on ordinal ranks, entirely bypassing score distribution discrepancies and normalization anomalies.
- **Robust Out-of-the-Box**: Outperforms uncalibrated linear combination on heterogeneous search corpora without requiring training data or parameter re-tuning.
- **Efficient Computation**: $O(N \log N)$ where $N \le 100$ candidate documents, executing in under 1ms of CPU time.

### Trade-offs
- Rank-only fusion does not reflect the *relative margin* between candidates within a single retrieval method (e.g. if rank 1 has score 0.99 and rank 2 has score 0.50).
- To resolve fine-grained relevance margins where needed, an optional Cross-Encoder re-ranker stage (`mode=hybrid_rerank`) is provided downstream.
