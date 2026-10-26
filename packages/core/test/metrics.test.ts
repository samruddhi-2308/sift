import { describe, it, expect } from 'vitest';
import { registry, crawlPagesTotal, queueDepthGauge, getMetricsText } from '../src/metrics.js';

describe('Metrics', () => {
  it('registers custom metrics and allows updates', async () => {
    crawlPagesTotal.inc({ status: '200', domain: 'example.com' }, 1);
    queueDepthGauge.set({ queue_name: 'fetch' }, 42);

    const metricsText = await getMetricsText();
    expect(metricsText).toContain('sift_crawl_pages_total');
    expect(metricsText).toContain('status="200"');
    expect(metricsText).toContain('domain="example.com"');
    expect(metricsText).toContain('sift_queue_depth{queue_name="fetch"} 42');
  });

  it('provides a valid Prometheus registry', () => {
    expect(registry).toBeDefined();
    expect(typeof registry.metrics).toBe('function');
  });
});
