import crypto from 'node:crypto';
import type { Redis } from '@sift/queue';
import { createLogger } from '@sift/core';

const logger = createLogger('embedding-cache');

export class EmbeddingCache {
  private redis: Redis;
  private localMemoryCache = new Map<string, number[]>();
  private defaultTtlSec = 30 * 24 * 3600; // 30 days

  constructor(redis: Redis) {
    this.redis = redis;
  }

  private computeKey(model: string, text: string): string {
    const hash = crypto.createHash('sha256').update(text).digest('hex').slice(0, 32);
    return `sift:emb:${model}:${hash}`;
  }

  async get(model: string, text: string): Promise<number[] | null> {
    const key = this.computeKey(model, text);
    try {
      const cached = await this.redis.get(key);
      if (cached) {
        return JSON.parse(cached) as number[];
      }
    } catch {
      const local = this.localMemoryCache.get(key);
      if (local) return local;
    }
    return null;
  }

  async set(model: string, text: string, vector: number[]): Promise<void> {
    const key = this.computeKey(model, text);
    try {
      await this.redis.set(key, JSON.stringify(vector), 'EX', this.defaultTtlSec);
    } catch (err) {
      logger.debug({ err }, 'Redis set failed; using local memory cache');
      this.localMemoryCache.set(key, vector);
    }
  }

  async getMany(
    model: string,
    texts: string[]
  ): Promise<{ cachedVectors: Map<number, number[]>; uncachedIndices: number[] }> {
    const cachedVectors = new Map<number, number[]>();
    const uncachedIndices: number[] = [];

    if (texts.length === 0) {
      return { cachedVectors, uncachedIndices };
    }

    const keys = texts.map((t) => this.computeKey(model, t));
    try {
      const results = await this.redis.mget(...keys);
      for (let i = 0; i < texts.length; i++) {
        const val = results[i];
        if (val) {
          cachedVectors.set(i, JSON.parse(val) as number[]);
        } else {
          uncachedIndices.push(i);
        }
      }
    } catch {
      for (let i = 0; i < texts.length; i++) {
        const key = keys[i]!;
        const local = this.localMemoryCache.get(key);
        if (local) {
          cachedVectors.set(i, local);
        } else {
          uncachedIndices.push(i);
        }
      }
    }

    return { cachedVectors, uncachedIndices };
  }
}
