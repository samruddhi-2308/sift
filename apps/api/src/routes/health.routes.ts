import type { FastifyPluginAsync } from 'fastify';
import { pingMongo } from '@sift/db';
import { pingRedis } from '@sift/queue';
import type { QdrantManager } from '@sift/embeddings';

export interface HealthRouteOptions {
  qdrant: QdrantManager;
}

export const healthRoutes: FastifyPluginAsync<HealthRouteOptions> = async (app, options) => {
  app.get('/health', async (_req, reply) => {
    const [mongoStatus, redisStatus, qdrantStatus] = await Promise.all([
      pingMongo(),
      pingRedis(),
      options.qdrant.ping(),
    ]);

    const allOk = mongoStatus.ok && redisStatus.ok && qdrantStatus.ok;
    const statusCode = allOk ? 200 : 503;

    return reply.status(statusCode).send({
      status: allOk ? 'healthy' : 'degraded',
      timestamp: new Date().toISOString(),
      services: {
        mongodb: {
          healthy: mongoStatus.ok,
          latencyMs: mongoStatus.pingMs,
          error: mongoStatus.error,
        },
        redis: {
          healthy: redisStatus.ok,
          latencyMs: redisStatus.pingMs,
          error: redisStatus.error,
        },
        qdrant: {
          healthy: qdrantStatus.ok,
          latencyMs: qdrantStatus.latencyMs,
        },
      },
    });
  });
};
