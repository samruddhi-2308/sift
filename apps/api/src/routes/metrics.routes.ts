import type { FastifyPluginAsync } from 'fastify';
import { getMetricsText } from '@sift/core';

export const metricsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/metrics', async (_req, reply) => {
    const text = await getMetricsText();
    return reply
      .header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
      .send(text);
  });
};
