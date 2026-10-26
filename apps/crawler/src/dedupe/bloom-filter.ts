import type { Redis } from '@sift/queue';
import { createLogger } from '@sift/core';

const logger = createLogger('bloom-dedupe');

export interface DedupeFilter {
  has(key: string): Promise<boolean>;
  add(key: string): Promise<boolean>;
}

export class RedisBloomFilter implements DedupeFilter {
  private redis: Redis;
  private filterName: string;
  private hasBloomModule: boolean | null = null;
  private localFallback = new Set<string>();

  constructor(redis: Redis, filterName = 'sift:bloom:visited_urls') {
    this.redis = redis;
    this.filterName = filterName;
  }

  /**
   * Initializes Bloom filter in Redis Stack with error rate 0.001 and capacity 5M
   */
  async init(): Promise<void> {
    try {
      // Check if RedisBloom BF.RESERVE is supported
      await this.redis.call('BF.RESERVE', this.filterName, '0.001', '5000000');
      this.hasBloomModule = true;
      logger.info({ filter: this.filterName }, 'Initialized RedisBloom filter');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('item exists') || msg.includes('already exists')) {
        this.hasBloomModule = true;
      } else {
        logger.warn(
          { error: msg },
          'RedisBloom module not detected; falling back to Redis HyperLogLog / Set deduplication'
        );
        this.hasBloomModule = false;
      }
    }
  }

  async has(key: string): Promise<boolean> {
    try {
      if (this.hasBloomModule === null) {
        await this.init();
      }

      if (this.hasBloomModule) {
        const res = (await this.redis.call('BF.EXISTS', this.filterName, key)) as number;
        return res === 1;
      }

      // Redis Set fallback
      const exists = await this.redis.sismember(`${this.filterName}:set`, key);
      return exists === 1;
    } catch (err) {
      logger.debug({ err, key }, 'Redis dedupe check failed; checking local memory cache');
      return this.localFallback.has(key);
    }
  }

  async add(key: string): Promise<boolean> {
    try {
      if (this.hasBloomModule === null) {
        await this.init();
      }

      this.localFallback.add(key);

      if (this.hasBloomModule) {
        const res = (await this.redis.call('BF.ADD', this.filterName, key)) as number;
        return res === 1; // 1 means newly added, 0 means already existed
      }

      const added = await this.redis.sadd(`${this.filterName}:set`, key);
      return added === 1;
    } catch (err) {
      logger.debug({ err, key }, 'Redis dedupe add failed; using local memory cache');
      const alreadyExisted = this.localFallback.has(key);
      this.localFallback.add(key);
      return !alreadyExisted;
    }
  }
}
