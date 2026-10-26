import { z } from 'zod';

export const SearchQuerySchema = z.object({
  q: z.string().min(1, 'Query parameter "q" cannot be empty').max(500),
  limit: z.coerce.number().int().min(1).max(100).default(10),
  offset: z.coerce.number().int().min(0).default(0),
  domain: z.string().optional(),
  lang: z.string().optional(),
  rerank: z
    .enum(['true', 'false'])
    .optional()
    .transform((val) => val === 'true'),
  mode: z.enum(['keyword', 'vector', 'hybrid', 'hybrid_rerank']).optional(),
});

export type SearchQueryInput = z.infer<typeof SearchQuerySchema>;

export const CompareQuerySchema = z.object({
  q: z.string().min(1, 'Query parameter "q" cannot be empty').max(500),
  limit: z.coerce.number().int().min(1).max(50).default(10),
  domain: z.string().optional(),
  lang: z.string().optional(),
});

export type CompareQueryInput = z.infer<typeof CompareQuerySchema>;
