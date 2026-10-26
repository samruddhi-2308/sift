import type { Redis } from '@sift/queue';
import { createLogger, config } from '@sift/core';

const logger = createLogger('domain-rate-limiter');

export class DomainRateLimiter {
  private redis: Redis;
  private defaultDelayMs: number;
  private localTimestamps = new Map<string, number>();

  constructor(redis: Redis, defaultDelayMs = config.CRAWLER_DEFAULT_DELAY_MS) {
    this.redis = redis;
    this.defaultDelayMs = defaultDelayMs;
  }

  /**
   * Waits until the domain is eligible for the next request per polite rate limiting
   */
  async acquire(domain: string, crawlDelayOverrideMs?: number | null): Promise<number> {
    const minDelay = crawlDelayOverrideMs || this.defaultDelayMs;
    // Add 50-150ms jitter to prevent rhythmic burst patterns
    const jitter = Math.floor(Math.random() * 100) + 50;
    const targetDelay = minDelay + jitter;

    const key = `sift:rate:${domain}:last_fetch`;
    const now = Date.now();

    let lastFetch = 0;
    try {
      const val = await this.redis.get(key);
      if (val) {
        lastFetch = parseInt(val, 10);
      }
    } catch {
      lastFetch = this.localTimestamps.get(domain) || 0;
    }

    const elapsed = now - lastFetch;
    let sleepTime = 0;

    if (elapsed < targetDelay) {
      sleepTime = targetDelay - elapsed;
      logger.debug({ domain, sleepTime, targetDelay }, 'Rate limiting: sleeping before fetch');
      await new Promise((resolve) => setTimeout(resolve, sleepTime));
    }

    const updatedNow = Date.now();
    try {
      // Set new last fetch with 5 minute expiration
      await this.redis.set(key, updatedNow.toString(), 'EX', 300);
    } catch {
      this.localTimestamps.set(domain, updatedNow);
    }

    return sleepTime;
  }

  /**
   * Applies an adaptive backoff to a domain when receiving a 429 or 503 response
   */
  async applyBackoff(domain: string, backoffMs = 10000): Promise<void> {
    const futureTime = Date.now() + backoffMs;
    const key = `sift:rate:${domain}:last_fetch`;
    try {
      await this.redis.set(key, futureTime.toString(), 'EX', Math.ceil(backoffMs / 1000) + 60);
      logger.info({ domain, backoffMs }, 'Applied adaptive rate limit backoff to domain');
    } catch {
      this.localTimestamps.set(domain, futureTime);
    }
  }
}
