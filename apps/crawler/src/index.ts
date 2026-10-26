import {
  createRedisConnection,
  getQueue,
  closeAllQueues,
  QUEUE_NAMES,
  type Worker,
  type FetchJobPayload,
  type ParseJobPayload,
  type IngestJobPayload,
} from '@sift/queue';
import { connectMongo, closeMongo, DLQRepository } from '@sift/db';
import { createLogger, config } from '@sift/core';
import { RedisBloomFilter } from './dedupe/bloom-filter.js';
import { RobotsService } from './politeness/robots.js';
import { DomainRateLimiter } from './politeness/rate-limiter.js';
import { CrawlFrontier } from './frontier/frontier.js';
import { DLQHandler } from './workers/dlq-handler.js';
import { createFetchWorker } from './workers/fetch-worker.js';
import { createParseWorker } from './workers/parse-worker.js';

const logger = createLogger('crawler-service');

export interface CrawlerServiceInstance {
  frontier: CrawlFrontier;
  dlqHandler: DLQHandler;
  fetchWorker: Worker;
  parseWorker: Worker;
  stop: () => Promise<void>;
}

export async function startCrawler(): Promise<CrawlerServiceInstance> {
  logger.info('Initializing Sift crawler service...');

  // 1. Establish database & queue connections
  const { db } = await connectMongo();
  const redis = createRedisConnection();

  // 2. Instantiate queues
  const fetchQueue = getQueue<FetchJobPayload>(QUEUE_NAMES.FETCH);
  const parseQueue = getQueue<ParseJobPayload>(QUEUE_NAMES.PARSE);
  const ingestQueue = getQueue<IngestJobPayload>(QUEUE_NAMES.INGEST);

  // 3. Instantiate domain services
  const dedupeFilter = new RedisBloomFilter(redis);
  await dedupeFilter.init();

  const robotsService = new RobotsService(redis);
  const rateLimiter = new DomainRateLimiter(redis);
  const dlqRepo = new DLQRepository(db);
  const dlqHandler = new DLQHandler(dlqRepo, fetchQueue);

  const frontier = new CrawlFrontier(fetchQueue, dedupeFilter, robotsService, redis);

  // 4. Start workers
  logger.info({ concurrency: config.CRAWLER_CONCURRENCY }, 'Starting BullMQ crawler workers');
  const fetchWorker = createFetchWorker({
    redis,
    rateLimiter,
    robotsService,
    dlqHandler,
    parseQueue,
    concurrency: config.CRAWLER_CONCURRENCY,
  });

  const parseWorker = createParseWorker({
    redis,
    frontier,
    ingestQueue,
    concurrency: config.CRAWLER_CONCURRENCY,
  });

  // 5. Graceful shutdown handler
  let isStopping = false;
  const stop = async () => {
    if (isStopping) return;
    isStopping = true;
    logger.info('Graceful shutdown initiated: completing in-flight jobs...');

    await Promise.all([fetchWorker.close(), parseWorker.close()]);
    await closeAllQueues();
    await closeMongo();
    await redis.quit();

    logger.info('Crawler service stopped cleanly');
  };

  process.on('SIGINT', async () => {
    logger.info('Received SIGINT');
    await stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    logger.info('Received SIGTERM');
    await stop();
    process.exit(0);
  });

  logger.info('Sift crawler service is running and ready for jobs');
  return { frontier, dlqHandler, fetchWorker, parseWorker, stop };
}

// Start if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  startCrawler().catch((err) => {
    logger.fatal({ err }, 'Fatal crawler startup failure');
    process.exit(1);
  });
}
