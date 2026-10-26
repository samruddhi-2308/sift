import robotsParser, { type Robot } from 'robots-parser';
import { request } from 'undici';
import type { Redis } from '@sift/queue';
import { createLogger, config } from '@sift/core';

const logger = createLogger('robots-service');

export interface CachedRobotsInfo {
  allowed: boolean;
  crawlDelayMs?: number;
}

export class RobotsService {
  private redis: Redis;
  private defaultUserAgent: string;
  private memoryCache = new Map<string, { parser: Robot; expiresAt: number }>();

  constructor(redis: Redis, userAgent = config.CRAWLER_USER_AGENT) {
    this.redis = redis;
    this.defaultUserAgent = userAgent;
  }

  private getCacheKey(domain: string): string {
    return `sift:robots:${domain}`;
  }

  /**
   * Fetches or retrieves cached robots.txt for a domain
   */
  async getParser(domain: string): Promise<Robot> {
    const now = Date.now();
    const mem = this.memoryCache.get(domain);
    if (mem && mem.expiresAt > now) {
      return mem.parser;
    }

    const cacheKey = this.getCacheKey(domain);
    let robotsTxt: string | null = null;

    try {
      robotsTxt = await this.redis.get(cacheKey);
    } catch {
      // Redis error, proceed to fetch
    }

    const robotsUrl = `https://${domain}/robots.txt`;

    if (robotsTxt === null) {
      logger.debug({ domain }, 'Fetching robots.txt from remote host');
      try {
        const res = await request(robotsUrl, {
          method: 'GET',
          headers: {
            'User-Agent': this.defaultUserAgent,
            Accept: 'text/plain',
          },
          headersTimeout: 5000,
          bodyTimeout: 5000,
        });

        if (res.statusCode === 200) {
          robotsTxt = await res.body.text();
        } else if (res.statusCode === 404 || res.statusCode === 410) {
          // If 404, robots.txt allows everything
          robotsTxt = 'User-agent: *\nAllow: /';
        } else if (res.statusCode >= 500) {
          // 5xx means server error, back off and disallow to be polite
          logger.warn(
            { domain, status: res.statusCode },
            'Robots.txt 5xx error; applying temporary disallow'
          );
          robotsTxt = 'User-agent: *\nDisallow: /';
        } else {
          robotsTxt = 'User-agent: *\nAllow: /';
        }

        // Cache in Redis for 24 hours (86400s)
        try {
          await this.redis.set(cacheKey, robotsTxt, 'EX', 86400);
        } catch {
          // ignore redis set failure
        }
      } catch (fetchErr) {
        logger.warn(
          { domain, err: fetchErr },
          'Failed to fetch robots.txt; defaulting to permissive mode'
        );
        robotsTxt = 'User-agent: *\nAllow: /';
      }
    }

    const parser = robotsParser(robotsUrl, robotsTxt);
    // Cache in memory for 1 hour
    this.memoryCache.set(domain, { parser, expiresAt: now + 3600 * 1000 });
    return parser;
  }

  /**
   * Checks if SiftBot is permitted to crawl the target URL
   */
  async isAllowed(url: string, userAgent = 'SiftBot'): Promise<boolean> {
    try {
      const parsed = new URL(url);
      const domain = parsed.hostname;
      const parser = await this.getParser(domain);
      const allowed = parser.isAllowed(url, userAgent);
      return allowed !== false; // null or true means allowed
    } catch {
      return false;
    }
  }

  /**
   * Retrieves Crawl-delay directive in milliseconds, if specified
   */
  async getCrawlDelay(domain: string, userAgent = 'SiftBot'): Promise<number | null> {
    try {
      const parser = await this.getParser(domain);
      const delaySec = parser.getCrawlDelay(userAgent);
      if (typeof delaySec === 'number' && delaySec > 0) {
        return Math.round(delaySec * 1000);
      }
      return null;
    } catch {
      return null;
    }
  }
}
