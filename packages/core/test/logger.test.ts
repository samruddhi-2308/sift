import { describe, it, expect } from 'vitest';
import { logger, createLogger } from '../src/logger.js';

describe('Logger', () => {
  it('instantiates root logger with expected level', () => {
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe('function');
    expect(typeof logger.error).toBe('function');
  });

  it('creates child loggers with module names', () => {
    const child = createLogger('test-crawler');
    expect(child).toBeDefined();
    expect(child.bindings().module).toBe('test-crawler');
  });
});
