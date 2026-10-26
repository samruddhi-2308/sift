import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { connectMongo, closeMongo } from '@sift/db';
import { buildServer } from '../src/server.js';
import { LocalDeterministicEmbeddingProvider } from '@sift/embeddings';
import { HybridSearchService, SemanticReranker } from '@sift/search';

describe('Search API Integration Tests', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    const { db } = await connectMongo();

    // Use mock/local provider and local reranker for isolated API testing
    const provider = new LocalDeterministicEmbeddingProvider();
    const reranker = new SemanticReranker(''); // Triggers fast local fallback

    // Mock Qdrant manager returning sample chunk
    const mockQdrant = {
      search: async () => [
        {
          id: 'point-1',
          score: 0.92,
          payload: {
            urlHash: 'hash_test_1',
            url: 'https://arxiv.org/abs/2106.12345',
            domain: 'arxiv.org',
            title: 'Distributed Vector Retrieval in Search Engines',
            lang: 'en',
            chunkIndex: 0,
            text: 'Hybrid search combines dense embeddings with traditional inverted indexing for high precision.',
            fetchedAt: new Date().toISOString(),
          },
        },
      ],
      ping: async () => ({ ok: true, latencyMs: 5 }),
    } as any;

    const searchService = new HybridSearchService(
      db,
      mockQdrant,
      provider,
      undefined,
      reranker
    );

    app = await buildServer({ db, qdrant: mockQdrant, searchService });
    await app.ready();
  });

  afterAll(async () => {
    if (app) await app.close();
    await closeMongo();
  });

  it('GET /health returns 200 with service status payload', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/health',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBeDefined();
    expect(body.services.mongodb.healthy).toBe(true);
    expect(body.services.qdrant.healthy).toBe(true);
  });

  it('GET /metrics returns Prometheus metric scrape text', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/plain');
    expect(res.payload).toContain('sift_search_latency_seconds');
  });

  it('GET /search returns 400 when "q" is missing or empty', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/search',
    });

    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.error).toBe('Bad Request');
  });

  it('GET /search returns 200 with structured results for valid query', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/search?q=distributed%20vector&limit=5',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.query).toBe('distributed vector');
    expect(body.limit).toBe(5);
    expect(Array.isArray(body.results)).toBe(true);
    expect(body.timing).toBeDefined();
    expect(body.timing.totalMs).toBeGreaterThanOrEqual(0);
  });

  it('GET /search supports explicit mode selection and re-ranking', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/search?q=database&mode=hybrid_rerank&rerank=true',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.mode).toBe('hybrid_rerank');
    expect(Array.isArray(body.results)).toBe(true);
  });

  it('GET /search/compare returns side-by-side mode results', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/search/compare?q=systems&limit=3',
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.modes).toBeDefined();
    expect(body.modes.keyword).toBeDefined();
    expect(body.modes.vector).toBeDefined();
    expect(body.modes.hybrid).toBeDefined();
    expect(body.modes.hybrid_rerank).toBeDefined();
  });
});
