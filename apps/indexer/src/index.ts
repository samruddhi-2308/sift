import { connectMongo, closeMongo, DocumentRepository } from '@sift/db';
import {
  createRedisConnection,
  getQueue,
  closeAllQueues,
  QUEUE_NAMES,
  type FetchJobPayload,
  type IngestJobPayload,
} from '@sift/queue';
import { getEmbeddingProvider, QdrantManager } from '@sift/embeddings';
import { createIngestWorker } from './ingest-worker.js';
import { createEmbedWorker, EmbedService } from './embed-worker.js';
import { EmbeddingCache } from '@sift/embeddings';
import { createLogger } from '@sift/core';

const logger = createLogger('indexer-service');

export async function startIndexer(): Promise<{ stop: () => Promise<void> }> {
  logger.info('Initializing Sift Indexer service (Ingest + Embed workers)...');

  const { db } = await connectMongo();
  const redis = createRedisConnection();
  const repo = new DocumentRepository(db);

  // Initialize embedding provider and Qdrant collection
  const provider = getEmbeddingProvider();
  const qdrant = new QdrantManager();
  await qdrant.ensureCollection(provider.dimension);

  const fetchQueue = getQueue<FetchJobPayload>(QUEUE_NAMES.FETCH);
  const ingestQueue = getQueue<IngestJobPayload>(QUEUE_NAMES.INGEST);

  // 1. Ingest Worker
  const { worker: ingestWorker, manager: ingestManager } = createIngestWorker(
    repo,
    redis,
    fetchQueue,
    ingestQueue,
    {
      batchSize: 1000,
      flushIntervalMs: 2000,
    }
  );

  // 2. Embed Worker
  const { worker: embedWorker } = createEmbedWorker(repo, provider, redis, qdrant, {
    maxChunksPerDoc: 2,
  });

  const stop = async () => {
    logger.info('Shutting down indexer service...');
    await ingestManager.stop();
    await ingestWorker.close();
    await embedWorker.close();
    await closeAllQueues();
    await closeMongo();
    await redis.quit();
    logger.info('Indexer service stopped cleanly');
  };

  process.on('SIGINT', async () => {
    await stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    await stop();
    process.exit(0);
  });

  logger.info(
    { model: provider.model, dimension: provider.dimension },
    'Sift Indexer service is active and listening for Ingest and Embed jobs'
  );
  return { stop };
}

export async function runEmbedBatch(batchSize = 100): Promise<void> {
  logger.info({ batchSize }, 'Running manual embedding batch scan...');
  const { db } = await connectMongo();
  const redis = createRedisConnection();
  const repo = new DocumentRepository(db);

  const provider = getEmbeddingProvider();
  const qdrant = new QdrantManager();
  await qdrant.ensureCollection(provider.dimension);
  const cache = new EmbeddingCache(redis);

  const service = new EmbedService(repo, provider, cache, qdrant, { maxChunksPerDoc: 2 });
  const result = await service.processPendingBatch(batchSize);

  logger.info(result, 'Manual embedding batch scan finished');
  await closeMongo();
  await redis.quit();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  if (arg === 'embed-batch') {
    const size = parseInt(process.argv[3] || '100', 10);
    runEmbedBatch(size).catch((err) => {
      logger.fatal({ err }, 'Error in embed batch');
      process.exit(1);
    });
  } else {
    startIndexer().catch((err) => {
      logger.fatal({ err }, 'Fatal error during indexer startup');
      process.exit(1);
    });
  }
}
