import { config as loadDotenv } from 'dotenv';
import { z } from 'zod';

import fs from 'node:fs';
import path from 'node:path';

// Load .env file searching from current directory up to repository root
const candidateEnvPaths = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(process.cwd(), '../../.env'),
];
for (const envPath of candidateEnvPaths) {
  if (fs.existsSync(envPath)) {
    loadDotenv({ path: envPath });
  }
}

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),

  // MongoDB
  MONGODB_URI: z.string().url().default('mongodb://localhost:27017/sift'),
  MONGODB_DB_NAME: z.string().min(1).default('sift'),

  // Redis
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),
  REDIS_PASSWORD: z.string().optional().default(''),

  // Qdrant
  QDRANT_URL: z.string().url().default('http://localhost:6333'),
  QDRANT_API_KEY: z.string().optional().default(''),
  QDRANT_COLLECTION_NAME: z.string().min(1).default('sift_chunks'),

  // Embeddings
  GEMINI_API_KEY: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),
  EMBEDDING_PROVIDER: z.enum(['gemini', 'openai', 'local']).default('gemini'),
  EMBEDDING_MODEL: z.string().default('text-embedding-004'),

  // Crawler defaults
  CRAWLER_CONCURRENCY: z.coerce.number().int().positive().default(5),
  CRAWLER_DEFAULT_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  CRAWLER_USER_AGENT: z.string().default('SiftBot/1.0 (+https://github.com/sift-search/sift)'),
  MAX_PAGE_SIZE_BYTES: z.coerce
    .number()
    .int()
    .positive()
    .default(2 * 1024 * 1024), // 2MB
});

export type Config = z.infer<typeof configSchema>;

export function loadConfig(overrides?: Record<string, unknown>): Config {
  const envData = { ...process.env, ...overrides };
  const parsed = configSchema.safeParse(envData);

  if (!parsed.success) {
    const errorDetails = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Configuration validation failed:\n${errorDetails}`);
  }

  return parsed.data;
}

export const config = loadConfig();
