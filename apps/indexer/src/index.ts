import { connectMongo, closeMongo, DocumentRepository } from '@sift/db';
import {
  createRedisConnection,
  getQueue,
  closeAllQueues,
  QUEUE_NAMES,
  type FetchJobPayload,
  type IngestJobPayload,
} from '@sift/queue';
import { createIngestWorker } from './ingest-worker.js';
import { createLogger } from '@sift/core';

const logger = createLogger('indexer-service');

export async function startIndexer(): Promise<{ stop: () => Promise<void> }> {
  logger.info('Initializing Sift Indexer service...');

  const { db } = await connectMongo();
  const redis = createRedisConnection();
  const repo = new DocumentRepository(db);

  const fetchQueue = getQueue<FetchJobPayload>(QUEUE_NAMES.FETCH);
  const ingestQueue = getQueue<IngestJobPayload>(QUEUE_NAMES.INGEST);

  const { worker, manager } = createIngestWorker(repo, redis, fetchQueue, ingestQueue, {
    batchSize: 1000,
    flushIntervalMs: 2000,
  });

  const stop = async () => {
    logger.info('Shutting down indexer service...');
    await manager.stop();
    await worker.close();
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

  logger.info('Sift Indexer service is active and listening for ingest jobs');
  return { stop };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  startIndexer().catch((err) => {
    logger.fatal({ err }, 'Fatal error during indexer startup');
    process.exit(1);
  });
}
