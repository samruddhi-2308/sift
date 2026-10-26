import { describe, it, expect } from 'vitest';
import { SemanticReranker } from '../src/rerank.js';
import type { CandidateItem } from '../src/types.js';

describe('Semantic Reranker', () => {
  it('rescores candidates using local fallback when no API key provided', async () => {
    const reranker = new SemanticReranker(''); // Empty key triggers fallback

    const candidates: CandidateItem[] = [
      {
        documentId: 'doc1',
        url: 'https://example.com/1',
        urlHash: 'hash1',
        domain: 'example.com',
        title: 'Random Cooking Recipes',
        text: 'Learn how to bake bread and pastry.',
        headings: [],
        lang: 'en',
        source: 'test',
        fetchedAt: new Date(),
        rrfScore: 0.016,
      },
      {
        documentId: 'doc2',
        url: 'https://example.com/2',
        urlHash: 'hash2',
        domain: 'example.com',
        title: 'Qdrant Vector Database Guide',
        text: 'A deep dive into HNSW vector search indexing and cosine distance.',
        headings: ['Vector Indexing'],
        lang: 'en',
        source: 'test',
        fetchedAt: new Date(),
        rrfScore: 0.015,
      },
    ];

    const reranked = await reranker.rerank('vector search qdrant', candidates);

    expect(reranked.length).toBe(2);
    // doc2 should be promoted to rank 1 because of strong title, heading, and body match
    expect(reranked[0]!.documentId).toBe('doc2');
    expect(reranked[0]!.rerankScore).toBeGreaterThan(reranked[1]!.rerankScore!);
  });
});
