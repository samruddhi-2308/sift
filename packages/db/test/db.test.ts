import { describe, it, expect } from 'vitest';
import { REQUIRED_INDEXES } from '../src/indexes.js';
import { COLLECTIONS } from '../src/collections.js';

describe('Database Schema & Indexes', () => {
  it('defines the required collection names', () => {
    expect(COLLECTIONS.DOCUMENTS).toBe('documents');
    expect(COLLECTIONS.FRONTIER_STATE).toBe('frontier_state');
    expect(COLLECTIONS.DLQ_JOBS).toBe('dlq_jobs');
  });

  it('defines unique index on urlHash for O(1) deduplication', () => {
    const urlHashIdx = REQUIRED_INDEXES.find(
      (idx) => idx.collection === 'documents' && idx.options.name === 'uniq_url_hash'
    );
    expect(urlHashIdx).toBeDefined();
    expect(urlHashIdx?.options.unique).toBe(true);
    expect(urlHashIdx?.spec).toEqual({ urlHash: 1 });
  });

  it('defines compound index on domain and recency', () => {
    const domainIdx = REQUIRED_INDEXES.find(
      (idx) => idx.collection === 'documents' && idx.options.name === 'idx_domain_fetched_at'
    );
    expect(domainIdx).toBeDefined();
    expect(domainIdx?.spec).toEqual({ domain: 1, fetchedAt: -1 });
  });

  it('defines weighted full-text search index', () => {
    const textIdx = REQUIRED_INDEXES.find(
      (idx) => idx.collection === 'documents' && idx.options.name === 'text_search_weighted'
    );
    expect(textIdx).toBeDefined();
    expect(textIdx?.options.weights).toEqual({
      title: 10,
      headings: 5,
      text: 1,
    });
  });

  it('defines partial index for unembedded documents', () => {
    const partialIdx = REQUIRED_INDEXES.find(
      (idx) => idx.collection === 'documents' && idx.options.name === 'partial_unembedded_scan'
    );
    expect(partialIdx).toBeDefined();
    expect(partialIdx?.options.partialFilterExpression).toEqual({ embedding: null });
  });
});
