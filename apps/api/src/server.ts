import fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import type { Db } from '@sift/db';
import type { Redis } from '@sift/queue';
import { QdrantManager, getEmbeddingProvider } from '@sift/embeddings';
import { HybridSearchService, SemanticReranker } from '@sift/search';
import { healthRoutes } from './routes/health.routes.js';
import { metricsRoutes } from './routes/metrics.routes.js';
import { searchRoutes } from './routes/search.routes.js';

export interface ServerContext {
  db: Db;
  redis?: Redis;
  qdrant?: QdrantManager;
  searchService?: HybridSearchService;
}

export async function buildServer(ctx: ServerContext): Promise<FastifyInstance> {
  const app = fastify({
    logger: false, // We use structured Pino logging via @sift/core
  });

  // 1. CORS plugin
  await app.register(cors, {
    origin: true,
    methods: ['GET', 'POST', 'OPTIONS'],
  });

  // 2. IP Rate limiting plugin (120 req/min per IP)
  await app.register(rateLimit, {
    max: 120,
    timeWindow: '1 minute',
  });

  // 3. Dependency injection
  const qdrant = ctx.qdrant || new QdrantManager();
  const provider = getEmbeddingProvider();
  const reranker = new SemanticReranker();

  const searchService =
    ctx.searchService ||
    new HybridSearchService(ctx.db, qdrant, provider, ctx.redis, reranker);

  // 4. Register Route Plugins
  await app.register(healthRoutes, { qdrant });
  await app.register(metricsRoutes);
  await app.register(searchRoutes, { searchService });

  return app;
}
