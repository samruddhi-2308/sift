import type { EmbeddingProvider } from '../types.js';
import { createLogger } from '@sift/core';

const logger = createLogger('gemini-embeddings');

export class GeminiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'gemini';
  readonly model: string;
  readonly dimension = 768;
  readonly version = 1;
  private apiKey: string;

  constructor(apiKey: string, model = 'gemini-embedding-001') {
    this.apiKey = apiKey;
    this.model = model === 'text-embedding-004' ? 'gemini-embedding-001' : model;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const batchSize = 50; // Safe batch limit for Gemini batchEmbedContents
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += batchSize) {
      const slice = texts.slice(i, i + batchSize);
      const embeddings = await this.callApiWithRetry(slice);
      allEmbeddings.push(...embeddings);
    }

    return allEmbeddings;
  }

  async embedQuery(query: string): Promise<number[]> {
    const res = await this.embed([query]);
    const first = res[0];
    if (!first) {
      throw new Error('Gemini embedding failed to return vector for query');
    }
    return first;
  }

  private async callApiWithRetry(texts: string[], maxRetries = 3): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.apiKey}`;

    const requests = texts.map((text) => ({
      model: `models/${this.model}`,
      content: {
        parts: [{ text }],
      },
      outputDimensionality: this.dimension,
    }));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ requests }),
        });

        if (response.status === 429) {
          const waitMs = Math.pow(2, attempt) * 1000 + Math.random() * 500;
          logger.warn({ attempt, waitMs }, 'Gemini API 429 rate limit hit; backing off');
          await new Promise((r) => setTimeout(r, waitMs));
          continue;
        }

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`Gemini API HTTP ${response.status}: ${errorText}`);
        }

        const data = (await response.json()) as {
          embeddings?: Array<{ values?: number[] }>;
        };

        if (!data.embeddings || data.embeddings.length !== texts.length) {
          throw new Error(
            `Gemini API returned unexpected embedding count: ${data.embeddings?.length}`
          );
        }

        return data.embeddings.map((e) => e.values || new Array(this.dimension).fill(0));
      } catch (err) {
        if (attempt === maxRetries) {
          throw err;
        }
        await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
    }

    throw new Error('Exceeded max retries calling Gemini embedding API');
  }
}
