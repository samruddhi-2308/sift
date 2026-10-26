import {
  Worker,
  type Job,
  type Queue,
  type Redis,
  QUEUE_NAMES,
  type FetchJobPayload,
  type ParseJobPayload,
} from '@sift/queue';
import { HttpFetcher, FetchError } from '../fetcher/fetcher.js';
import type { DomainRateLimiter } from '../politeness/rate-limiter.js';
import type { RobotsService } from '../politeness/robots.js';
import type { DLQHandler } from './dlq-handler.js';

import {
  createLogger,
  crawlPagesTotal,
  crawlDurationSeconds,
  type ErrorClassification,
} from '@sift/core';

const logger = createLogger('fetch-worker');

export interface FetchWorkerDependencies {
  redis: Redis;
  rateLimiter: DomainRateLimiter;
  robotsService: RobotsService;
  dlqHandler: DLQHandler;
  parseQueue: Queue<ParseJobPayload>;
  concurrency?: number;
}

export function createFetchWorker(deps: FetchWorkerDependencies): Worker<FetchJobPayload> {
  const fetcher = new HttpFetcher();

  const worker = new Worker<FetchJobPayload>(
    QUEUE_NAMES.FETCH,
    async (job: Job<FetchJobPayload>) => {
      const { url, depth, domain } = job.data;
      const jobId = job.id || job.data.url;

      logger.info({ jobId, url, depth }, 'Starting fetch job');

      // 1. Politeness rate limiting
      const crawlDelay = await deps.robotsService.getCrawlDelay(domain);
      await deps.rateLimiter.acquire(domain, crawlDelay);

      try {
        // 2. Fetch page over HTTP with timeouts, size checks, and SSRF guard
        const result = await fetcher.fetch(url);

        crawlPagesTotal.inc({ status: String(result.statusCode), domain });
        crawlDurationSeconds.observe({ domain }, result.durationMs / 1000);

        // 3. Forward to parse queue
        await deps.parseQueue.add(
          'parse-page',
          {
            url: result.finalUrl,
            urlHash: job.id || '',
            domain,
            html: result.html,
            httpStatus: result.statusCode,
            fetchedAt: new Date().toISOString(),
            renderMode: 'static',
            depth,
          },
          {
            jobId: job.id,
            removeOnComplete: true,
          }
        );

        logger.info(
          { url, status: result.statusCode, bytes: result.sizeBytes },
          'Fetch completed successfully'
        );
      } catch (err: unknown) {
        let errorClass: ErrorClassification = 'other';
        let statusCode: number | undefined;

        if (err instanceof FetchError) {
          errorClass = err.classification;
          statusCode = err.statusCode;
        }

        crawlPagesTotal.inc({ status: String(statusCode || 'error'), domain });

        // If 429 rate limited, apply dynamic backoff to domain
        if (statusCode === 429) {
          await deps.rateLimiter.applyBackoff(domain, 15000);
        }

        const isFatalNonRetryable =
          statusCode === 404 || statusCode === 410 || statusCode === 403 || statusCode === 401;
        const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts || 3);

        if (isFatalNonRetryable || isFinalAttempt) {
          logger.warn(
            { url, errorClass, attempts: job.attemptsMade + 1 },
            'Job failed permanently; sending to DLQ'
          );
          await deps.dlqHandler.handleFailure(
            {
              originalQueue: QUEUE_NAMES.FETCH,
              originalPayload: job.data as unknown as Record<string, unknown>,
              errorClass,
              errorMessage: err instanceof Error ? err.message : String(err),
              stack: err instanceof Error ? err.stack : undefined,
              failedAt: new Date().toISOString(),
              attempts: job.attemptsMade + 1,
            },
            jobId
          );

          if (isFatalNonRetryable) {
            // Do not retry 4xx errors
            return;
          }
        }

        throw err; // Trigger BullMQ exponential retry for network/5xx errors
      }
    },
    {
      connection: deps.redis,
      concurrency: deps.concurrency || 5,
    }
  );

  worker.on('failed', (job: Job<FetchJobPayload> | undefined, err: Error) => {
    logger.error({ jobId: job?.id, err: err.message }, 'Fetch job failed attempt');
  });

  return worker;
}
