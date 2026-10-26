import { COLLECTIONS, type Db } from '@sift/db';
import type { CandidateItem, SearchOptions } from './types.js';
import { createLogger } from '@sift/core';

const logger = createLogger('keyword-search');

export class KeywordSearch {
  private db: Db;

  constructor(db: Db) {
    this.db = db;
  }

  /**
   * Executes lexical text search against MongoDB weighted text index:
   * title: 10, headings: 5, text: 1
   */
  async search(options: SearchOptions): Promise<CandidateItem[]> {
    const limit = Math.min(Math.max(options.limit || 100, 1), 100);
    const filter: Record<string, unknown> = {
      $text: { $search: options.query },
    };

    if (options.domain) {
      filter.domain = options.domain;
    }

    if (options.lang) {
      filter.lang = options.lang;
    }

    try {
      const col = this.db.collection(COLLECTIONS.DOCUMENTS);

      const cursor = col
        .find(filter, {
          projection: {
            _id: 1,
            url: 1,
            urlHash: 1,
            domain: 1,
            title: 1,
            text: 1,
            headings: 1,
            lang: 1,
            source: 1,
            fetchedAt: 1,
            score: { $meta: 'textScore' },
          },
        })
        .sort({ score: { $meta: 'textScore' } })
        .limit(limit);

      const docs = await cursor.toArray();

      return docs.map((doc: Record<string, unknown>, idx: number) => ({
        documentId: (doc._id as { toString(): string }).toString(),
        url: doc.url as string,
        urlHash: doc.urlHash as string,
        domain: doc.domain as string,
        title: doc.title as string,
        text: doc.text as string,
        headings: (doc.headings || []) as string[],
        lang: (doc.lang || 'en') as string,
        source: (doc.source || 'other') as string,
        fetchedAt: (doc.fetchedAt || new Date()) as Date,
        keywordScore: typeof doc.score === 'number' ? doc.score : 0,
        keywordRank: idx + 1,
      }));
    } catch (err) {
      logger.error({ err, query: options.query }, 'MongoDB keyword text search encountered error');
      throw err;
    }
  }
}
