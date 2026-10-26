import type { CandidateItem } from './types.js';

export interface RrfOptions {
  k?: number; // Smoothing constant, default 60
}

/**
 * Combines ranked lists from distinct retrieval algorithms using Reciprocal Rank Fusion (RRF):
 * RRF(d) = sum_{m in M} (1 / (k + rank_m(d)))
 *
 * @param keywordCandidates Ranked list of keyword search results (rank 1-indexed)
 * @param vectorCandidates Ranked list of dense vector search results (rank 1-indexed)
 * @param options Fusion parameters (default k=60)
 */
export function reciprocalRankFusion(
  keywordCandidates: CandidateItem[],
  vectorCandidates: CandidateItem[],
  options: RrfOptions = {}
): CandidateItem[] {
  const k = options.k || 60;
  const merged = new Map<string, CandidateItem>();

  // 1. Process keyword leg candidates
  for (let rank = 1; rank <= keywordCandidates.length; rank++) {
    const item = keywordCandidates[rank - 1]!;
    const key = item.urlHash || item.documentId;
    const itemCopy = {
      ...item,
      keywordRank: rank,
      rrfScore: 1 / (k + rank),
    };
    merged.set(key, itemCopy);
  }

  // 2. Process vector leg candidates and blend
  for (let rank = 1; rank <= vectorCandidates.length; rank++) {
    const item = vectorCandidates[rank - 1]!;
    const key = item.urlHash || item.documentId;
    const existing = merged.get(key);

    const vectorRrfContribution = 1 / (k + rank);

    if (existing) {
      existing.vectorRank = rank;
      existing.vectorScore = item.vectorScore;
      existing.bestChunkText = existing.bestChunkText || item.bestChunkText;
      existing.rrfScore = (existing.rrfScore || 0) + vectorRrfContribution;
    } else {
      const itemCopy = {
        ...item,
        vectorRank: rank,
        rrfScore: vectorRrfContribution,
      };
      merged.set(key, itemCopy);
    }
  }

  // 3. Sort descending by combined RRF score
  const fusedList = Array.from(merged.values()).sort((a, b) => {
    const scoreDiff = (b.rrfScore || 0) - (a.rrfScore || 0);
    if (Math.abs(scoreDiff) > 1e-9) return scoreDiff;

    // Tie-breaker 1: Present in both legs beats present in single leg
    const aBoth = a.keywordRank && a.vectorRank ? 1 : 0;
    const bBoth = b.keywordRank && b.vectorRank ? 1 : 0;
    if (aBoth !== bBoth) return bBoth - aBoth;

    // Tie-breaker 2: Best individual rank
    const aBestRank = Math.min(a.keywordRank || 9999, a.vectorRank || 9999);
    const bBestRank = Math.min(b.keywordRank || 9999, b.vectorRank || 9999);
    return aBestRank - bBestRank;
  });

  return fusedList;
}
