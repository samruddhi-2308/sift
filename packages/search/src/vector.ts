import crypto from 'node:crypto';
import { COLLECTIONS, type Db } from '@sift/db';
import type { Redis } from '@sift/queue';
import type { QdrantManager, EmbeddingProvider, VectorSearchResult } from '@sift/embeddings';
import type { CandidateItem, SearchOptions } from './types.js';
import { createLogger } from '@sift/core';

const logger = createLogger('vector-search');

export class VectorSearch {
  private db: Db;
  private qdrant: QdrantManager;
  private provider: EmbeddingProvider;
  private redis?: Redis;

  constructor(
    db: Db,
    qdrant: QdrantManager,
    provider: EmbeddingProvider,
    redis?: Redis
  ) {
    this.db = db;
    this.qdrant = qdrant;
    this.provider = provider;
    this.redis = redis;
  }

  /**
   * Retrieves or computes dense vector embedding for search query, leveraging Redis cache
   */
  async getQueryEmbedding(query: string): Promise<number[]> {
    const clean = query.trim().toLowerCase();
    const queryHash = crypto.createHash('sha256').update(clean).digest('hex');
    const cacheKey = `sift:query_emb:${this.provider.name}:${this.provider.model}:${queryHash}`;

    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          return JSON.parse(cached) as number[];
        }
      } catch (err) {
        logger.warn({ err }, 'Redis query embedding cache read failed; continuing with provider');
      }
    }

    const vector = await this.provider.embedQuery(query);

    if (this.redis && vector) {
      try {
        // Cache popular query embeddings for 7 days
        await this.redis.set(cacheKey, JSON.stringify(vector), 'EX', 7 * 86400);
      } catch (err) {
        logger.warn({ err }, 'Redis query embedding cache write failed');
      }
    }

    return vector;
  }

  /**
   * Performs vector semantic retrieval:
   * 1. Embeds query (cached)
   * 2. Qdrant HNSW cosine nearest neighbor search (top 100 chunks)
   * 3. Groups chunks by document urlHash, selecting top chunk score and passage
   * 4. Populates full document metadata from MongoDB
   */
  async search(options: SearchOptions): Promise<CandidateItem[]> {
    const limit = Math.min(Math.max(options.limit || 100, 1), 100);

    try {
      const queryVector = await this.getQueryEmbedding(options.query);

      // Search Qdrant for top matching chunks
      const points: VectorSearchResult[] = await this.qdrant.search(queryVector, {
        limit: Math.max(limit * 3, 50), // Over-fetch chunks to ensure distinct documents
        domain: options.domain,
        lang: options.lang,
      });

      if (points.length === 0) {
        return [];
      }

      // Group chunks by document urlHash, capturing maximum chunk score and best passage
      interface GroupedDoc {
        urlHash: string;
        bestScore: number;
        bestChunkText: string;
        url: string;
        domain: string;
        title: string;
        lang: string;
        fetchedAt: string;
      }

      const docMap = new Map<string, GroupedDoc>();

      for (const p of points) {
        const payload = p.payload;
        const urlHash = payload.urlHash;
        if (!urlHash) continue;

        const existing = docMap.get(urlHash);
        if (!existing || p.score > existing.bestScore) {
          docMap.set(urlHash, {
            urlHash,
            bestScore: p.score,
            bestChunkText: payload.text || '',
            url: payload.url,
            domain: payload.domain,
            title: payload.title,
            lang: payload.lang,
            fetchedAt: payload.fetchedAt,
          });
        }
      }

      // Sort unique documents descending by vector score
      const sortedGrouped = Array.from(docMap.values())
        .sort((a, b) => b.bestScore - a.bestScore)
        .slice(0, limit);

      const urlHashes = sortedGrouped.map((d) => d.urlHash);

      // Hydrate full document fields from MongoDB
      const col = this.db.collection(COLLECTIONS.DOCUMENTS);
      const mongoDocs = await col
        .find({ urlHash: { $in: urlHashes } })
        .project({
          _id: 1,
          url: 1,
          urlHash: 1,
          domain: 1,
          title: 1,
          text: 1,
          headings: 1,
          lang: 1,
          source: 1,
          fetchedAt: 1,
        })
        .toArray();

      const mongoMap = new Map<string, (typeof mongoDocs)[0]>();
      for (const d of mongoDocs) {
        mongoMap.set(d.urlHash as string, d);
      }

      // Assemble final ranked candidate list preserving vector order
      const candidates: CandidateItem[] = [];

      for (let i = 0; i < sortedGrouped.length; i++) {
        const g = sortedGrouped[i]!;
        const m = mongoMap.get(g.urlHash);

        candidates.push({
          documentId: m ? m._id.toString() : g.urlHash,
          url: m ? (m.url as string) : g.url,
          urlHash: g.urlHash,
          domain: m ? (m.domain as string) : g.domain,
          title: m ? (m.title as string) : g.title,
          text: m ? (m.text as string) : g.bestChunkText,
          headings: m ? ((m.headings || []) as string[]) : [],
          lang: m ? ((m.lang || 'en') as string) : g.lang || 'en',
          source: m ? ((m.source || 'other') as string) : 'other',
          fetchedAt: m ? ((m.fetchedAt || new Date()) as Date) : new Date(g.fetchedAt || Date.now()),
          vectorScore: g.bestScore,
          vectorRank: i + 1,
          bestChunkText: g.bestChunkText,
        });
      }

      return candidates;
    } catch (err) {
      logger.error({ err, query: options.query }, 'Vector search encountered error');
      throw err;
    }
  }
}
