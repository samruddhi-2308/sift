import type { Db } from '@sift/db';
import type { Redis } from '@sift/queue';
import { createLogger, searchLatencySeconds, searchQueriesTotal } from '@sift/core';
import type { QdrantManager, EmbeddingProvider } from '@sift/embeddings';
import type {
  SearchOptions,
  SearchResponse,
  SearchCompareResponse,
  SearchResultItem,
  CandidateItem,
  SearchMode,
  SearchStageTiming,
} from './types.js';
import { KeywordSearch } from './keyword.js';
import { VectorSearch } from './vector.js';
import { reciprocalRankFusion } from './fusion.js';
import { SemanticReranker } from './rerank.js';
import { generateSnippet } from './snippets.js';

const logger = createLogger('search-service');

export class HybridSearchService {
  private keywordSearch: KeywordSearch;
  private vectorSearch: VectorSearch;
  private reranker: SemanticReranker;
  private redis?: Redis;

  constructor(
    db: Db,
    qdrant: QdrantManager,
    provider: EmbeddingProvider,
    redis?: Redis,
    reranker?: SemanticReranker
  ) {
    this.keywordSearch = new KeywordSearch(db);
    this.vectorSearch = new VectorSearch(db, qdrant, provider, redis);
    this.reranker = reranker || new SemanticReranker();
    this.redis = redis;
  }

  /**
   * Helper to execute an async operation with a strict timeout limit
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    let timer: NodeJS.Timeout;
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        reject(new Error(`${operationName} timed out after ${timeoutMs}ms`));
      }, timeoutMs);
    });

    try {
      return await Promise.race([promise, timeoutPromise]);
    } finally {
      clearTimeout(timer!);
    }
  }

  /**
   * Executes a hybrid search query with parallel legs, RRF fusion, optional re-ranking,
   * snippet generation, and graceful degradation
   */
  async search(options: SearchOptions): Promise<SearchResponse> {
    const totalStart = performance.now();
    const query = options.query.trim();
    const mode: SearchMode = options.mode || (options.rerank ? 'hybrid_rerank' : 'hybrid');
    const limit = Math.min(Math.max(options.limit || 10, 1), 100);
    const offset = Math.max(options.offset || 0, 0);
    const timeoutMs = options.timeoutMs || 2500;

    // Check Redis search response cache (TTL 30s)
    const cacheKey = `sift:search_cache:${mode}:${query}:${options.domain || ''}:${options.lang || ''}:${limit}:${offset}`;
    if (this.redis) {
      try {
        const cached = await this.redis.get(cacheKey);
        if (cached) {
          const parsed = JSON.parse(cached) as SearchResponse;
          return {
            ...parsed,
            timing: {
              ...parsed.timing,
              totalMs: Number((performance.now() - totalStart).toFixed(2)),
            },
          };
        }
      } catch (err) {
        logger.warn({ err }, 'Search response cache read error');
      }
    }

    const timing: SearchStageTiming = { totalMs: 0 };
    let degraded = false;
    let degradationReason: string | undefined;

    let keywordCandidates: CandidateItem[] = [];
    let vectorCandidates: CandidateItem[] = [];

    // --- 1. Pure Keyword Mode ---
    if (mode === 'keyword') {
      const kwStart = performance.now();
      try {
        keywordCandidates = await this.keywordSearch.search({ ...options, limit: 100 });
        timing.keywordMs = Number((performance.now() - kwStart).toFixed(2));
        searchLatencySeconds.observe({ mode, stage: 'keyword' }, timing.keywordMs / 1000);
      } catch (err) {
        searchQueriesTotal.inc({ mode, status: 'error' });
        throw err;
      }

      return this.formatResponse(query, keywordCandidates, timing, totalStart, limit, offset, mode, cacheKey);
    }

    // --- 2. Pure Vector Mode ---
    if (mode === 'vector') {
      const vecStart = performance.now();
      try {
        vectorCandidates = await this.vectorSearch.search({ ...options, limit: 100 });
        timing.vectorMs = Number((performance.now() - vecStart).toFixed(2));
        searchLatencySeconds.observe({ mode, stage: 'vector' }, timing.vectorMs / 1000);
      } catch (err) {
        searchQueriesTotal.inc({ mode, status: 'error' });
        throw err;
      }

      return this.formatResponse(query, vectorCandidates, timing, totalStart, limit, offset, mode, cacheKey);
    }

    // --- 3. Parallel Hybrid Mode (with graceful fallback) ---
    const kwPromise = (async () => {
      const start = performance.now();
      const res = await this.withTimeout(
        this.keywordSearch.search({ ...options, limit: 100 }),
        timeoutMs,
        'Keyword leg'
      );
      const ms = Number((performance.now() - start).toFixed(2));
      searchLatencySeconds.observe({ mode, stage: 'keyword' }, ms / 1000);
      return { res, ms };
    })();

    const vecPromise = (async () => {
      const start = performance.now();
      const res = await this.withTimeout(
        this.vectorSearch.search({ ...options, limit: 100 }),
        timeoutMs,
        'Vector leg'
      );
      const ms = Number((performance.now() - start).toFixed(2));
      searchLatencySeconds.observe({ mode, stage: 'vector' }, ms / 1000);
      return { res, ms };
    })();

    const [kwResult, vecResult] = await Promise.allSettled([kwPromise, vecPromise]);

    if (kwResult.status === 'fulfilled') {
      keywordCandidates = kwResult.value.res;
      timing.keywordMs = kwResult.value.ms;
    } else {
      degraded = true;
      degradationReason = `Keyword leg failed: ${kwResult.reason instanceof Error ? kwResult.reason.message : String(kwResult.reason)}`;
      logger.warn({ reason: degradationReason }, 'Keyword leg degraded');
    }

    if (vecResult.status === 'fulfilled') {
      vectorCandidates = vecResult.value.res;
      timing.vectorMs = vecResult.value.ms;
    } else {
      degraded = true;
      const vecReason = `Vector leg failed: ${vecResult.reason instanceof Error ? vecResult.reason.message : String(vecResult.reason)}`;
      degradationReason = degradationReason ? `${degradationReason}; ${vecReason}` : vecReason;
      logger.warn({ reason: vecReason }, 'Vector leg degraded');
    }

    if (kwResult.status === 'rejected' && vecResult.status === 'rejected') {
      searchQueriesTotal.inc({ mode, status: 'error' });
      throw new Error(`Both retrieval legs failed: ${degradationReason}`);
    }

    // --- 4. Reciprocal Rank Fusion ---
    const fusionStart = performance.now();
    let candidates = reciprocalRankFusion(keywordCandidates, vectorCandidates);
    timing.fusionMs = Number((performance.now() - fusionStart).toFixed(2));
    searchLatencySeconds.observe({ mode, stage: 'fusion' }, timing.fusionMs / 1000);

    // --- 5. Semantic Re-ranking ---
    if (mode === 'hybrid_rerank' || options.rerank) {
      const rerankStart = performance.now();
      try {
        candidates = await this.withTimeout(
          this.reranker.rerank(query, candidates, 20),
          5500,
          'Re-ranker'
        );
        timing.rerankMs = Number((performance.now() - rerankStart).toFixed(2));
        searchLatencySeconds.observe({ mode, stage: 'rerank' }, timing.rerankMs / 1000);
      } catch (err) {
        logger.warn({ err }, 'Re-ranking step failed; retaining RRF rank order');
        degraded = true;
        degradationReason = degradationReason
          ? `${degradationReason}; Re-ranker timed out`
          : 'Re-ranker timed out, returning RRF rankings';
      }
    }

    searchQueriesTotal.inc({ mode, status: degraded ? 'degraded' : 'ok' });

    return this.formatResponse(
      query,
      candidates,
      timing,
      totalStart,
      limit,
      offset,
      mode,
      cacheKey,
      degraded,
      degradationReason
    );
  }

  /**
   * Helper to format candidate items into paginated SearchResponse with snippets and caching
   */
  private async formatResponse(
    query: string,
    candidates: CandidateItem[],
    timing: SearchStageTiming,
    totalStart: number,
    limit: number,
    offset: number,
    mode: SearchMode,
    cacheKey: string,
    degraded = false,
    degradationReason?: string
  ): Promise<SearchResponse> {
    const total = candidates.length;
    const paginated = candidates.slice(offset, offset + limit);

    const results: SearchResultItem[] = paginated.map((c) => {
      const { snippet, matchedTerms } = generateSnippet(c.text, query, {
        bestPassage: c.bestChunkText,
        maxChars: 220,
      });

      // Score representation based on mode
      let displayScore: number = c.rrfScore || 0;
      if (mode === 'hybrid_rerank' && c.rerankScore !== undefined) {
        displayScore = c.rerankScore / 10.0;
      } else if (mode === 'keyword' && c.keywordScore !== undefined) {
        displayScore = c.keywordScore;
      } else if (mode === 'vector' && c.vectorScore !== undefined) {
        displayScore = c.vectorScore;
      }

      return {
        documentId: c.documentId,
        url: c.url,
        urlHash: c.urlHash,
        domain: c.domain,
        title: c.title,
        snippet,
        score: Number(displayScore.toFixed(4)),
        keywordRank: c.keywordRank,
        vectorRank: c.vectorRank,
        rrfScore: c.rrfScore ? Number(c.rrfScore.toFixed(6)) : undefined,
        rerankScore: c.rerankScore,
        matchedTerms,
        source: c.source,
        fetchedAt: c.fetchedAt,
      };
    });

    timing.totalMs = Number((performance.now() - totalStart).toFixed(2));
    searchLatencySeconds.observe({ mode, stage: 'total' }, timing.totalMs / 1000);

    const response: SearchResponse = {
      query,
      total,
      limit,
      offset,
      mode,
      results,
      timing,
      degraded,
      degradationReason,
    };

    if (this.redis) {
      try {
        await this.redis.set(cacheKey, JSON.stringify(response), 'EX', 30);
      } catch (err) {
        logger.warn({ err }, 'Redis search response cache set error');
      }
    }

    return response;
  }

  /**
   * Executes side-by-side search comparison across all 4 modes for evaluation & UI inspection
   */
  async searchCompare(
    query: string,
    options: Partial<SearchOptions> = {}
  ): Promise<SearchCompareResponse> {
    const start = performance.now();
    const limit = options.limit || 10;

    const [kwRes, vecRes, hybridRes, rerankRes] = await Promise.all([
      this.search({ ...options, query, limit, mode: 'keyword' }),
      this.search({ ...options, query, limit, mode: 'vector' }),
      this.search({ ...options, query, limit, mode: 'hybrid' }),
      this.search({ ...options, query, limit, mode: 'hybrid_rerank', rerank: true }),
    ]);

    return {
      query,
      timing: {
        keywordMs: kwRes.timing.keywordMs,
        vectorMs: vecRes.timing.vectorMs,
        fusionMs: hybridRes.timing.fusionMs,
        rerankMs: rerankRes.timing.rerankMs,
        totalMs: Number((performance.now() - start).toFixed(2)),
      },
      modes: {
        keyword: kwRes.results,
        vector: vecRes.results,
        hybrid: hybridRes.results,
        hybrid_rerank: rerankRes.results,
      },
    };
  }
}
