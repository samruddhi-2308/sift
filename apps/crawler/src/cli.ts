import { Command } from 'commander';
import { startCrawler } from './index.js';
import { connectMongo, closeMongo, DLQRepository } from '@sift/db';
import {
  createRedisConnection,
  getQueue,
  closeAllQueues,
  QUEUE_NAMES,
  type FetchJobPayload,
} from '@sift/queue';
import { DLQHandler } from './workers/dlq-handler.js';
import { RobotsService } from './politeness/robots.js';
import { createLogger, type ErrorClassification } from '@sift/core';

const logger = createLogger('crawler-cli');
const program = new Command();

program
  .name('sift-crawler')
  .description('Sift Crawler CLI management and worker execution')
  .version('1.0.0');

// Command: Start Crawler Workers
program
  .command('start')
  .description('Start the crawler fetch and parse workers')
  .action(async () => {
    await startCrawler();
  });

// Command: Seed Domains
program
  .command('seed')
  .description('Seed the crawl frontier with a list of URLs')
  .argument('[urls...]', 'Seed URLs to enqueue', [
    'https://en.wikipedia.org/wiki/Search_engine',
    'https://news.ycombinator.com',
    'https://developer.mozilla.org/en-US/docs/Web/HTTP',
    'https://nodejs.org/docs/latest/api/',
    'https://www.typescriptlang.org/docs/',
  ])
  .action(async (seedUrls: string[]) => {
    logger.info({ count: seedUrls.length, seedUrls }, 'Seeding crawl frontier...');
    const service = await startCrawler();
    const result = await service.frontier.enqueue(seedUrls, { depth: 0 });
    logger.info(result, 'Seed URLs enqueued into frontier');
  });

// Command: Replay DLQ
program
  .command('replay-dlq')
  .description('Replay failed jobs from Dead Letter Queue back into the fetch queue')
  .option(
    '-c, --class <errorClass>',
    'Filter by error classification (timeout, dns, server_error, etc.)'
  )
  .option('-l, --limit <number>', 'Maximum jobs to replay', '100')
  .action(async (options: { class?: string; limit: string }) => {
    const { db } = await connectMongo();
    const redis = createRedisConnection();
    const fetchQueue = getQueue<FetchJobPayload>(QUEUE_NAMES.FETCH);
    const dlqRepo = new DLQRepository(db);
    const dlqHandler = new DLQHandler(dlqRepo, fetchQueue);

    const errorClass = options.class as ErrorClassification | undefined;
    const limit = parseInt(options.limit, 10);

    logger.info({ errorClass, limit }, 'Replaying DLQ jobs...');
    const result = await dlqHandler.replay(errorClass, limit);
    logger.info(result, 'DLQ replay completed');

    await closeAllQueues();
    await closeMongo();
    await redis.quit();
    process.exit(0);
  });

// Command: Audit Robots Compliance
program
  .command('audit-robots')
  .description('Audit fetched URLs in database against their cached robots.txt rules')
  .action(async () => {
    const { db } = await connectMongo();
    const redis = createRedisConnection();
    const robotsService = new RobotsService(redis);

    logger.info('Auditing crawled URLs against robots.txt rules...');
    const docs = await db.collection('documents').find({}).limit(1000).toArray();

    let violations = 0;
    let checked = 0;

    for (const doc of docs) {
      if (doc.url) {
        checked++;
        const allowed = await robotsService.isAllowed(doc.url);
        if (!allowed) {
          violations++;
          logger.error({ url: doc.url }, 'Robots.txt violation detected!');
        }
      }
    }

    logger.info({ checked, violations }, 'Robots audit completed');
    await closeMongo();
    await redis.quit();
    process.exit(violations > 0 ? 1 : 0);
  });

program.parse(process.argv);
