import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { connectMongo, closeMongo } from '@sift/db';
import { createRedisConnection } from '@sift/queue';
import { QdrantManager } from '@sift/embeddings';
import { config, createLogger } from '@sift/core';
import { buildServer } from './server.js';

const logger = createLogger('api-main');

export async function startApiServer() {
  logger.info('Starting Sift Search API server...');

  // 1. Initialize DB and Redis connections
  const { db } = await connectMongo();
  const redis = createRedisConnection();
  const qdrant = new QdrantManager();

  // 2. Build Fastify application
  const app = await buildServer({ db, redis, qdrant });

  // 3. Port configuration (default 3001 to keep 3000 free for Search UI)
  const port = parseInt(process.env.API_PORT || process.env.PORT || '3001', 10);
  const host = config.HOST || '0.0.0.0';

  await app.listen({ port, host });
  logger.info({ port, host, url: `http://${host === '0.0.0.0' ? 'localhost' : host}:${port}` }, 'Sift Search API server is running');

  // 4. Graceful shutdown handler
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Received termination signal, shutting down gracefully...');
    try {
      await app.close();
      await redis.quit();
      await closeMongo();
      logger.info('Server and client connections closed cleanly');
      process.exit(0);
    } catch (err) {
      logger.error({ err }, 'Error during shutdown');
      process.exit(1);
    }
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  return { app, shutdown };
}

const isDirectRun = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);

if (isDirectRun) {
  startApiServer().catch((err) => {
    logger.fatal({ err }, 'Fatal error during API startup');
    process.exit(1);
  });
}
