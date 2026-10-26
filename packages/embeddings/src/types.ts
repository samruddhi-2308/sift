export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimension: number;
  readonly version: number;

  /**
   * Generates vector embeddings for a batch of input texts
   */
  embed(texts: string[]): Promise<number[][]>;

  /**
   * Generates a vector embedding for a single search query
   */
  embedQuery(query: string): Promise<number[]>;
}

export interface TextChunk {
  chunkIndex: number;
  text: string;
  contentToEmbed: string; // Title-prepended text passed to the embedding model
  tokenEstimate: number;
}

export interface QdrantChunkPayload {
  [key: string]: unknown;
  urlHash: string;
  url: string;
  domain: string;
  lang: string;
  title: string;
  chunkIndex: number;
  text: string;
  fetchedAt: string;
}

export interface VectorSearchResult {
  id: string | number;
  score: number;
  payload: QdrantChunkPayload;
}
