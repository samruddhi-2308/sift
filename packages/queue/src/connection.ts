import { Redis, type RedisOptions } from 'ioredis';
import { config, createLogger } from '@sift/core';

const logger = createLogger('redis-client');

export function createRedisConnection(overrides?: Partial<RedisOptions>): Redis {
  const options: RedisOptions = {
    host: config.REDIS_HOST,
    port: config.REDIS_PORT,
    password: config.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null, // Required by BullMQ
    enableReadyCheck: false,
    retryStrategy(times) {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    ...overrides,
  };

  const redis = new Redis(options);

  redis.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  return redis;
}

let sharedRedis: Redis | null = null;

export function getSharedRedis(): Redis {
  if (!sharedRedis) {
    sharedRedis = createRedisConnection();
  }
  return sharedRedis;
}

export async function pingRedis(): Promise<{ ok: boolean; pingMs: number; error?: string }> {
  const start = Date.now();
  const redis = createRedisConnection({ lazyConnect: true });
  try {
    await redis.connect();
    await redis.ping();
    const pingMs = Date.now() - start;
    await redis.quit();
    return { ok: true, pingMs };
  } catch (err) {
    const pingMs = Date.now() - start;
    try {
      redis.disconnect();
    } catch {
      // ignore
    }
    return {
      ok: false,
      pingMs,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
