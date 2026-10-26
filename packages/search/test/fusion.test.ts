import { describe, it, expect } from 'vitest';
import { reciprocalRankFusion } from '../src/fusion.js';
import type { CandidateItem } from '../src/types.js';

function createMockCandidate(id: string, title: string): CandidateItem {
  return {
    documentId: id,
    url: `https://example.com/${id}`,
    urlHash: `hash_${id}`,
    domain: 'example.com',
    title,
    text: `Sample text for ${title}`,
    headings: [],
    lang: 'en',
    source: 'test',
    fetchedAt: new Date(),
  };
}

describe('Reciprocal Rank Fusion (RRF)', () => {
  it('combines keyword and vector rankings using k=60 formula', () => {
    const docA = createMockCandidate('docA', 'Distributed Systems');
    const docB = createMockCandidate('docB', 'Vector Databases');
    const docC = createMockCandidate('docC', 'Neural Search');

    // Keyword leg: docA (rank 1), docB (rank 2)
    const keywordList = [docA, docB];

    // Vector leg: docB (rank 1), docC (rank 2)
    const vectorList = [docB, docC];

    const fused = reciprocalRankFusion(keywordList, vectorList, { k: 60 });

    // docB is present in both legs (keyword rank 2, vector rank 1)
    // score(docB) = 1/(60 + 2) + 1/(60 + 1) = 1/62 + 1/61 = 0.016129 + 0.016393 = 0.032522
    // score(docA) = 1/(60 + 1) = 1/61 = 0.016393
    // score(docC) = 1/(60 + 2) = 1/62 = 0.016129

    expect(fused.length).toBe(3);
    expect(fused[0]!.documentId).toBe('docB');
    expect(fused[1]!.documentId).toBe('docA');
    expect(fused[2]!.documentId).toBe('docC');

    expect(fused[0]!.keywordRank).toBe(2);
    expect(fused[0]!.vectorRank).toBe(1);
    expect(fused[0]!.rrfScore).toBeCloseTo(0.03252, 4);
  });

  it('handles empty lists gracefully', () => {
    const fused = reciprocalRankFusion([], []);
    expect(fused).toEqual([]);
  });

  it('handles single leg presence without error', () => {
    const docA = createMockCandidate('docA', 'Single Leg Doc');
    const fused = reciprocalRankFusion([docA], []);

    expect(fused.length).toBe(1);
    expect(fused[0]!.documentId).toBe('docA');
    expect(fused[0]!.keywordRank).toBe(1);
    expect(fused[0]!.vectorRank).toBeUndefined();
    expect(fused[0]!.rrfScore).toBeCloseTo(1 / 61, 5);
  });
});
