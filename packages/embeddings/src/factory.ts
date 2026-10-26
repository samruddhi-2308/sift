import { config, createLogger } from '@sift/core';
import type { EmbeddingProvider } from './types.js';
import { GeminiEmbeddingProvider } from './providers/gemini.js';
import { OpenAIEmbeddingProvider } from './providers/openai.js';
import { LocalDeterministicEmbeddingProvider } from './providers/local.js';

const logger = createLogger('embedding-factory');

export function getEmbeddingProvider(providerOverride?: string): EmbeddingProvider {
  const chosen = providerOverride || config.EMBEDDING_PROVIDER;

  if (chosen === 'gemini') {
    if (config.GEMINI_API_KEY) {
      logger.info(
        { provider: 'gemini', model: config.EMBEDDING_MODEL },
        'Using Gemini embedding provider'
      );
      return new GeminiEmbeddingProvider(config.GEMINI_API_KEY, config.EMBEDDING_MODEL);
    }
    logger.warn(
      'GEMINI_API_KEY missing in environment; falling back to local deterministic provider'
    );
  }

  if (chosen === 'openai') {
    if (config.OPENAI_API_KEY) {
      logger.info(
        { provider: 'openai', model: config.EMBEDDING_MODEL },
        'Using OpenAI embedding provider'
      );
      return new OpenAIEmbeddingProvider(config.OPENAI_API_KEY, config.EMBEDDING_MODEL);
    }
    logger.warn(
      'OPENAI_API_KEY missing in environment; falling back to local deterministic provider'
    );
  }

  logger.info(
    { provider: 'local-deterministic', dimension: 384 },
    'Using local deterministic embedding provider'
  );
  return new LocalDeterministicEmbeddingProvider();
}
