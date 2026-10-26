import type { FastifyPluginAsync } from 'fastify';
import type { HybridSearchService } from '@sift/search';
import { SearchQuerySchema, CompareQuerySchema } from '../schemas/search.schema.js';
import { createLogger } from '@sift/core';

const logger = createLogger('search-routes');

export interface SearchRouteOptions {
  searchService: HybridSearchService;
}

export const searchRoutes: FastifyPluginAsync<SearchRouteOptions> = async (app, options) => {
  // Main search endpoint: GET /search?q=&limit=&offset=&domain=&lang=&rerank=&mode=
  app.get('/search', async (req, reply) => {
    const parseResult = SearchQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid query parameters',
        issues: parseResult.error.issues,
      });
    }

    const { q, limit, offset, domain, lang, rerank, mode } = parseResult.data;

    try {
      const response = await options.searchService.search({
        query: q,
        limit,
        offset,
        domain,
        lang,
        rerank,
        mode,
      });

      return reply.send(response);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, q }, 'Failed processing search request');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message,
      });
    }
  });

  // A/B Comparison endpoint: GET /search/compare?q=&limit=&domain=&lang=
  app.get('/search/compare', async (req, reply) => {
    const parseResult = CompareQuerySchema.safeParse(req.query);

    if (!parseResult.success) {
      return reply.status(400).send({
        error: 'Bad Request',
        message: 'Invalid query parameters',
        issues: parseResult.error.issues,
      });
    }

    const { q, limit, domain, lang } = parseResult.data;

    try {
      const comparison = await options.searchService.searchCompare(q, {
        limit,
        domain,
        lang,
      });

      return reply.send(comparison);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error({ err, q }, 'Failed processing search compare request');
      return reply.status(500).send({
        error: 'Internal Server Error',
        message,
      });
    }
  });
};
