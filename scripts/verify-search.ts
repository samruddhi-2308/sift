import { connectMongo, closeMongo } from '@sift/db';
import { createRedisConnection } from '@sift/queue';
import { QdrantManager, getEmbeddingProvider } from '@sift/embeddings';
import { HybridSearchService, SemanticReranker } from '@sift/search';
import { createLogger } from '@sift/core';

const logger = createLogger('verify-search');

async function main() {
  logger.info('Starting Search Verification & Latency Benchmark...');

  const { db } = await connectMongo();
  const redis = createRedisConnection();
  const qdrant = new QdrantManager();
  const provider = getEmbeddingProvider();
  const reranker = new SemanticReranker();

  const service = new HybridSearchService(db, qdrant, provider, redis, reranker);

  const testQueries = [
    'distributed database architecture',
    'vector search indexing',
    'high performance systems',
    'machine learning embeddings',
  ];

  console.log('\n========================================================================================');
  console.log('                            SIFT SEARCH RETRIEVAL BENCHMARK                             ');
  console.log('========================================================================================');

  for (const q of testQueries) {
    console.log(`\nQuery: "${q}"`);
    console.log('----------------------------------------------------------------------------------------');

    // 1. Keyword-only
    const kwRes = await service.search({ query: q, mode: 'keyword', limit: 5 });
    console.log(
      `🔹 KEYWORD-ONLY    | Found: ${kwRes.total.toString().padStart(3)} | Latency: ${kwRes.timing.totalMs.toFixed(2)}ms | Top: "${kwRes.results[0]?.title || 'N/A'}"`
    );

    // 2. Vector-only
    const vecRes = await service.search({ query: q, mode: 'vector', limit: 5 });
    console.log(
      `🔹 VECTOR-ONLY     | Found: ${vecRes.total.toString().padStart(3)} | Latency: ${vecRes.timing.totalMs.toFixed(2)}ms | Top: "${vecRes.results[0]?.title || 'N/A'}"`
    );

    // 3. Hybrid (RRF)
    const hybridRes = await service.search({ query: q, mode: 'hybrid', limit: 5 });
    console.log(
      `🔹 HYBRID (RRF)   | Found: ${hybridRes.total.toString().padStart(3)} | Latency: ${hybridRes.timing.totalMs.toFixed(2)}ms (kw: ${hybridRes.timing.keywordMs || 0}ms, vec: ${hybridRes.timing.vectorMs || 0}ms, fuse: ${hybridRes.timing.fusionMs || 0}ms) | Top: "${hybridRes.results[0]?.title || 'N/A'}"`
    );

    // 4. Hybrid + Re-rank (Gemini Flash)
    const rerankRes = await service.search({ query: q, mode: 'hybrid_rerank', rerank: true, limit: 5 });
    console.log(
      `🔹 HYBRID + RERANK | Found: ${rerankRes.total.toString().padStart(3)} | Latency: ${rerankRes.timing.totalMs.toFixed(2)}ms (rerank: ${rerankRes.timing.rerankMs || 0}ms) | Top: "${rerankRes.results[0]?.title || 'N/A'}"`
    );
  }

  console.log('\n========================================================================================\n');

  await redis.quit();
  await closeMongo();
}

import { fileURLToPath } from 'node:url';
import path from 'node:path';

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      logger.error({ err }, 'Verification encountered error');
      process.exit(1);
    });
}
