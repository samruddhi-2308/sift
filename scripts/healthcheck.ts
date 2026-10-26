import { pingMongo, closeMongo } from '@sift/db';
import { pingRedis } from '@sift/queue';
import { config, createLogger } from '@sift/core';

const logger = createLogger('healthcheck');

interface ServiceStatus {
  service: string;
  target: string;
  healthy: boolean;
  latencyMs: number;
  details?: string;
}

async function checkQdrant(): Promise<ServiceStatus> {
  const start = Date.now();
  const url = `${config.QDRANT_URL}/healthz`;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    if (res.ok) {
      return {
        service: 'Qdrant Vector DB',
        target: config.QDRANT_URL,
        healthy: true,
        latencyMs,
        details: `HTTP ${res.status} OK`,
      };
    }
    return {
      service: 'Qdrant Vector DB',
      target: config.QDRANT_URL,
      healthy: false,
      latencyMs,
      details: `HTTP ${res.status}: ${await res.text()}`,
    };
  } catch (err) {
    return {
      service: 'Qdrant Vector DB',
      target: config.QDRANT_URL,
      healthy: false,
      latencyMs: Date.now() - start,
      details: err instanceof Error ? err.message : String(err),
    };
  }
}

async function checkMongo(): Promise<ServiceStatus> {
  const status = await pingMongo();
  await closeMongo();
  return {
    service: 'MongoDB',
    target: config.MONGODB_URI,
    healthy: status.ok,
    latencyMs: status.pingMs,
    details: status.ok ? `Database: ${status.database}` : status.error,
  };
}

async function checkRedis(): Promise<ServiceStatus> {
  const status = await pingRedis();
  return {
    service: 'Redis Stack',
    target: `${config.REDIS_HOST}:${config.REDIS_PORT}`,
    healthy: status.ok,
    latencyMs: status.pingMs,
    details: status.ok ? 'PING -> PONG received' : status.error,
  };
}

export async function runHealthCheck(): Promise<boolean> {
  logger.info('Running Sift infrastructure health checks...');
  const [mongoStatus, redisStatus, qdrantStatus] = await Promise.all([
    checkMongo(),
    checkRedis(),
    checkQdrant(),
  ]);

  const results = [mongoStatus, redisStatus, qdrantStatus];
  let allHealthy = true;

  console.log('\n======================================================');
  console.log('            SIFT INFRASTRUCTURE HEALTH CHECK           ');
  console.log('======================================================');
  for (const r of results) {
    const icon = r.healthy ? '🟢 OK' : '🔴 DOWN';
    if (!r.healthy) allHealthy = false;
    console.log(
      `${icon.padEnd(8)} | ${r.service.padEnd(18)} | ${r.latencyMs.toString().padStart(4)}ms | ${r.target.padEnd(30)} | ${r.details || ''}`
    );
  }
  console.log('======================================================\n');

  if (allHealthy) {
    logger.info('All services are healthy and operational.');
  } else {
    logger.warn(
      'One or more services are unreachable. Start them with: docker compose -f infra/docker-compose.yml up -d'
    );
  }

  return allHealthy;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runHealthCheck()
    .then((ok) => process.exit(ok ? 0 : 1))
    .catch((err) => {
      logger.error({ err }, 'Healthcheck encountered fatal error');
      process.exit(1);
    });
}
