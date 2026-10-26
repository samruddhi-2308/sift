import type { Queue, Redis } from '@sift/queue';
import { normalizeUrl } from '../dedupe/url-normalizer.js';
import { SpiderTrapDetector } from './trap-detector.js';
import type { DedupeFilter } from '../dedupe/bloom-filter.js';
import type { RobotsService } from '../politeness/robots.js';
import type { FetchJobPayload } from '@sift/queue';
import { createLogger } from '@sift/core';

const logger = createLogger('crawl-frontier');

export interface FrontierEnqueueOptions {
  depth?: number;
  referrer?: string;
  maxPerDomain?: number;
}

export class CrawlFrontier {
  private fetchQueue: Queue<FetchJobPayload>;
  private dedupeFilter: DedupeFilter;
  private robotsService: RobotsService;
  private trapDetector: SpiderTrapDetector;
  private redis: Redis;

  constructor(
    fetchQueue: Queue<FetchJobPayload>,
    dedupeFilter: DedupeFilter,
    robotsService: RobotsService,
    redis: Redis,
    maxDepth = 8
  ) {
    this.fetchQueue = fetchQueue;
    this.dedupeFilter = dedupeFilter;
    this.robotsService = robotsService;
    this.redis = redis;
    this.trapDetector = new SpiderTrapDetector(maxDepth);
  }

  /**
   * Evaluates and enqueues candidate URLs into the crawl queue
   */
  async enqueue(
    urls: string[],
    options: FrontierEnqueueOptions = {}
  ): Promise<{
    enqueued: number;
    skippedTraps: number;
    skippedDuplicates: number;
    skippedRobots: number;
    skippedCap: number;
  }> {
    const depth = options.depth ?? 0;
    const maxPerDomain = options.maxPerDomain ?? 50000;

    let enqueued = 0;
    let skippedTraps = 0;
    let skippedDuplicates = 0;
    let skippedRobots = 0;
    let skippedCap = 0;

    for (const rawUrl of urls) {
      const normalized = normalizeUrl(rawUrl, options.referrer);
      if (!normalized) {
        continue;
      }

      const { normalizedUrl, urlHash, domain } = normalized;

      // 1. Spider trap check
      const trapCheck = this.trapDetector.detect(normalizedUrl, depth);
      if (trapCheck.isTrap) {
        skippedTraps++;
        logger.debug({ url: normalizedUrl, reason: trapCheck.reason }, 'Skipped spider trap URL');
        continue;
      }

      // 2. Bloom deduplication check
      const alreadySeen = await this.dedupeFilter.has(urlHash);
      if (alreadySeen) {
        skippedDuplicates++;
        continue;
      }

      // 3. Per-domain page cap check
      const domainCountKey = `sift:domain:${domain}:count`;
      let currentCount = 0;
      try {
        const c = await this.redis.get(domainCountKey);
        if (c) currentCount = parseInt(c, 10);
      } catch {
        // proceed
      }
      if (currentCount >= maxPerDomain) {
        skippedCap++;
        continue;
      }

      // 4. Robots.txt permission check
      const allowed = await this.robotsService.isAllowed(normalizedUrl);
      if (!allowed) {
        skippedRobots++;
        logger.debug({ url: normalizedUrl }, 'Disallowed by robots.txt');
        continue;
      }

      // Mark as seen in dedupe filter
      await this.dedupeFilter.add(urlHash);

      // Increment domain crawl count
      try {
        await this.redis.incr(domainCountKey);
      } catch {
        // ignore
      }

      // 5. Enqueue with priority (BFS: shallower depth = higher priority)
      const priority = Math.max(1, 100 - depth * 10);
      await this.fetchQueue.add(
        'fetch-page',
        {
          url: normalizedUrl,
          depth,
          domain,
          referrer: options.referrer,
        },
        {
          priority,
          jobId: urlHash, // Ensures idempotency in queue
        }
      );

      enqueued++;
    }

    return { enqueued, skippedTraps, skippedDuplicates, skippedRobots, skippedCap };
  }
}
