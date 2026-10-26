import client from 'prom-client';

// Use a dedicated registry to avoid duplicate registration in tests
export const registry = new client.Registry();

// Collect default Node.js and process metrics
client.collectDefaultMetrics({ register: registry });

// Crawler metrics
export const crawlPagesTotal = new client.Counter({
  name: 'sift_crawl_pages_total',
  help: 'Total number of pages fetched by the crawler',
  labelNames: ['status', 'domain'] as const,
  registers: [registry],
});

export const crawlDurationSeconds = new client.Histogram({
  name: 'sift_crawl_duration_seconds',
  help: 'Duration of HTTP crawl fetch in seconds',
  labelNames: ['domain'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [registry],
});

// Queue metrics
export const queueDepthGauge = new client.Gauge({
  name: 'sift_queue_depth',
  help: 'Current depth of BullMQ queues',
  labelNames: ['queue_name'] as const,
  registers: [registry],
});

export const dlqJobsTotal = new client.Counter({
  name: 'sift_dlq_jobs_total',
  help: 'Total number of jobs moved to Dead Letter Queue',
  labelNames: ['error_class'] as const,
  registers: [registry],
});

// Search API metrics
export const searchLatencySeconds = new client.Histogram({
  name: 'sift_search_latency_seconds',
  help: 'Latency of search queries in seconds',
  labelNames: ['mode', 'stage'] as const,
  buckets: [0.002, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [registry],
});

export const searchQueriesTotal = new client.Counter({
  name: 'sift_search_queries_total',
  help: 'Total number of search queries executed',
  labelNames: ['mode', 'status'] as const,
  registers: [registry],
});

// Helper to get formatted Prometheus text
export async function getMetricsText(): Promise<string> {
  return registry.metrics();
}

export { client };
