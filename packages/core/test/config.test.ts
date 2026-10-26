import { describe, it, expect } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('Config Loader', () => {
  it('loads valid default configurations', () => {
    const cfg = loadConfig();
    expect(cfg.NODE_ENV).toBeDefined();
    expect(cfg.MONGODB_URI).toBe('mongodb://localhost:27017/sift');
    expect(cfg.REDIS_PORT).toBe(6379);
    expect(cfg.QDRANT_URL).toBe('http://localhost:6333');
    expect(cfg.CRAWLER_CONCURRENCY).toBe(5);
  });

  it('accepts valid custom overrides', () => {
    const cfg = loadConfig({
      NODE_ENV: 'production',
      PORT: '8080',
      CRAWLER_CONCURRENCY: '10',
      LOG_LEVEL: 'warn',
    });
    expect(cfg.NODE_ENV).toBe('production');
    expect(cfg.PORT).toBe(8080);
    expect(cfg.CRAWLER_CONCURRENCY).toBe(10);
    expect(cfg.LOG_LEVEL).toBe('warn');
  });

  it('throws descriptive error on invalid config types', () => {
    expect(() =>
      loadConfig({
        PORT: 'not-a-number',
      })
    ).toThrowError(/Configuration validation failed/);
  });
});
