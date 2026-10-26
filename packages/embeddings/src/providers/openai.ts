import OpenAI from 'openai';
import type { EmbeddingProvider } from '../types.js';
import { createLogger } from '@sift/core';

const logger = createLogger('openai-embeddings');

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly model: string;
  readonly dimension = 1536;
  readonly version = 1;
  private client: OpenAI;

  constructor(apiKey: string, model = 'text-embedding-3-small') {
    this.client = new OpenAI({ apiKey });
    this.model = model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 100;
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      try {
        const res = await this.client.embeddings.create({
          model: this.model,
          input: slice,
        });

        const sorted = res.data.sort((a, b) => a.index - b.index);
        allEmbeddings.push(...sorted.map((item) => item.embedding));
      } catch (err) {
        logger.error({ err }, 'OpenAI embedding request failed');
        throw err;
      }
    }

    return allEmbeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    const res = await this.embed([query]);
    const first = res[0];
    if (!first) {
      throw new Error('OpenAI embedding failed to return vector for query');
    }
    return first;
  }
}
