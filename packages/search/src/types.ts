export type SearchMode = 'keyword' | 'vector' | 'hybrid' | 'hybrid_rerank';

export interface SearchOptions {
  query: string;
  limit?: number; // Default 10, max 100
  offset?: number; // Default 0
  domain?: string;
  lang?: string;
  rerank?: boolean;
  mode?: SearchMode; // Default 'hybrid'
  timeoutMs?: number; // Per-leg timeout (e.g. 1000ms)
}

export interface CandidateItem {
  documentId: string;
  url: string;
  urlHash: string;
  domain: string;
  title: string;
  text: string;
  headings: string[];
  lang: string;
  source: string;
  fetchedAt: Date;
  keywordScore?: number;
  keywordRank?: number;
  vectorScore?: number;
  vectorRank?: number;
  bestChunkText?: string;
  rrfScore?: number;
  rerankScore?: number;
}

export interface SearchResultItem {
  documentId: string;
  url: string;
  urlHash: string;
  domain: string;
  title: string;
  snippet: string;
  score: number;
  keywordRank?: number;
  vectorRank?: number;
  rrfScore?: number;
  rerankScore?: number;
  matchedTerms?: string[];
  source: string;
  fetchedAt: Date;
}

export interface SearchStageTiming {
  embedMs?: number;
  keywordMs?: number;
  vectorMs?: number;
  fusionMs?: number;
  rerankMs?: number;
  totalMs: number;
}

export interface SearchResponse {
  query: string;
  total: number;
  limit: number;
  offset: number;
  mode: SearchMode;
  results: SearchResultItem[];
  timing: SearchStageTiming;
  degraded: boolean;
  degradationReason?: string;
}

export interface SearchCompareResponse {
  query: string;
  timing: SearchStageTiming;
  modes: {
    keyword: SearchResultItem[];
    vector: SearchResultItem[];
    hybrid: SearchResultItem[];
    hybrid_rerank: SearchResultItem[];
  };
}
