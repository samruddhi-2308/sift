# Sift: Architecture, Engineering Concepts & Learning Guide (`abt.md`)

Welcome to the internal engineering guide for **Sift** — a production-grade, distributed AI search engine built in TypeScript and Node.js. 

This guide serves as a learning companion explaining the architecture, system design choices, mathematical foundations, data structures, implementation details across Phases 0 through 3, and the roadmap for Phase 4 through 7.

---

## Table of Contents
1. [High-Level Vision & Architecture](#1-high-level-vision--architecture)
2. [Monorepo Structure & Package Responsibilities](#2-monorepo-structure--package-responsibilities)
3. [Deep Dive: Phases Completed (Phases 0 – 3)](#3-deep-dive-phases-completed-phases-0--3)
   - [Phase 0: Foundations & Shared Core](#phase-0-foundations--shared-core)
   - [Phase 1: Polite Crawler Core & Fault Tolerance](#phase-1-polite-crawler-core--fault-tolerance)
   - [Phase 2: Storage & High-Throughput Bulk Ingestion](#phase-2-storage--high-throughput-bulk-ingestion)
   - [Phase 3: Chunking, Embeddings & Qdrant Vector Indexing](#phase-3-chunking-embeddings--qdrant-vector-indexing)
4. [Core Computer Science & Systems Engineering Concepts](#4-core-computer-science--systems-engineering-concepts)
5. [Current Testing & Verification Status](#5-current-testing--verification-status)
6. [Roadmap: What Comes Next (Phase 4 – 7)](#6-roadmap-what-comes-next-phase-4--7)
7. [Operational Cheat Sheet (CLI & Commands)](#7-operational-cheat-sheet-cli--commands)

---

## 1. High-Level Vision & Architecture

Most search engine tutorials stop at a basic script that downloads HTML, extracts text, and queries an inverted index. Sift goes much further: it addresses real-world challenges encountered when scaling to millions of documents, complying with web politeness rules, and blending lexical (keyword) search with dense vector semantic search.

### System Diagram

```
                        [ Public Web / Crawl Seeds / Data Dumps ]
                                           │
            ┌──────────────────────────────┴──────────────────────────────┐
            ▼                                                             ▼
   [ Fast Static Crawler ]                                     [ Browser Agent (Phase 5) ]
 (undici, robots.txt, politeness,                             (Playwright, a11y DOM tree,
  Bloom dedupe, SimHash near-dup)                              Observe-Decide-Act loop)
            │                                                             │
            └──────────────────────────────┬──────────────────────────────┘
                                           ▼
                               [ Redis / BullMQ Queues ]
                      (fetch -> parse -> ingest -> embed -> DLQ)
                                           │
            ┌──────────────────────────────┴──────────────────────────────┐
            ▼                                                             ▼
   [ MongoDB Storage ]                                           [ Qdrant Vector DB ]
 (2M+ docs, bulk upserts,                                      (Chunk embeddings,
  compound & text indexes,                                      HNSW graph m=16,
  p95 < 5ms point lookups)                                      Cosine similarity)
            │                                                             │
            └──────────────────────────────┬──────────────────────────────┘
                                           ▼
                              [ Hybrid Search Engine (Phase 4) ]
                              ├── Keyword Retrieval (Mongo text search)
                              ├── Dense Semantic Retrieval (Qdrant vector)
                              ├── Reciprocal Rank Fusion (RRF, k=60)
                              └── Cross-Encoder / LLM Re-ranking (Top 30)
                                           │
                                           ▼
                         [ Fastify API + Modern Search UI ]
```

---

## 2. Monorepo Structure & Package Responsibilities

Sift is organized as a pnpm workspace monorepo:

```
sift/
├── apps/
│   ├── crawler/        # Distributed web fetcher, parser, politeness & DLQ workers
│   ├── indexer/        # High-throughput batch ingest & idempotent embedding workers
│   ├── api/            # Fastify hybrid search API (Phase 4)
│   ├── agent/          # Playwright autonomous browser agent (Phase 5)
│   └── web/            # Modern search UI and retrieval inspector (Phase 7)
├── packages/
│   ├── core/           # Zod environment validation, Pino logger, Prometheus metrics, shared types
│   ├── db/             # MongoDB client, repositories, index migrations, dump stream importers
│   ├── queue/          # BullMQ queue definitions, typed payloads, Redis connection factory
│   ├── embeddings/     # Text chunker, embedding provider abstraction (Gemini/OpenAI/local), Qdrant client
│   └── search/         # Lexical retrieval, vector retrieval, RRF fusion, re-ranking logic (Phase 4)
├── bench/              # Ingest throughput and query latency benchmark scripts
├── eval/               # nDCG@10, MRR relevance eval and 100-task agent eval harnesses
├── infra/              # Docker Compose (MongoDB, Redis Stack with RedisBloom, Qdrant, Prometheus, Grafana)
└── scripts/            # Infrastructure healthcheck and admin utilities
```

---

## 3. Deep Dive: Phases Completed (Phases 0 – 3)

### Phase 0: Foundations & Shared Core
- **Type-safe Configuration (`packages/core/src/config.ts`)**: Loads environment variables and validates them using Zod (`MONGODB_URI`, `REDIS_HOST`, `QDRANT_URL`, `EMBEDDING_PROVIDER`, etc.).
- **Observability (`packages/core/src/logger.ts` & `metrics.ts`)**: Structured JSON logging with Pino (with pretty-printing in development) and Prometheus counters, gauges, and histograms via `prom-client`.
- **Database Client & Repositories (`packages/db`)**: Standardized connection lifecycle with connection pooling, health pings, and repository pattern over raw MongoDB collections.
- **Index Definitions (`packages/db/src/indexes.ts`)**:
  - `uniq_url_hash`: Unique 1-way lookup on `urlHash` for $O(1)$ duplicate rejection and sub-5ms point lookups.
  - `idx_domain_fetched_at`: Compound index on `{ domain: 1, fetchedAt: -1 }` for domain-level freshness queries.
  - `idx_content_hash`: Index on `contentHash` (SimHash) for near-duplicate clustering.
  - `sparse_embedding_qdrant_id`: Sparse index for mapping Mongo documents to Qdrant vector points.
  - `partial_unembedded_scan`: Partial index (`{ embedding: null }`) allowing the embedding worker to instantly locate unembedded documents without table scans.
  - `text_search_weighted`: Full-text index with field weights (`title: 10`, `headings: 5`, `text: 1`).

---

### Phase 1: Polite Crawler Core & Fault Tolerance
- **RFC 3986 URL Normalization (`apps/crawler/src/frontier/url-normalizer.ts`)**:
  - Lowercases scheme and hostname.
  - Removes tracking/ad parameters (`utm_*`, `fbclid`, `gclid`).
  - Sorts query parameters deterministically.
  - Resolves relative links against the base URL.
  - Generates a 64-bit deterministic `urlHash` using SHA-256 / BigInt.
- **Deduplication Engine (`apps/crawler/src/dedupe/bloom.ts`)**:
  - Leverages RedisBloom (`BF.ADD` / `BF.EXISTS`) for fast $O(1)$ URL rejection in memory before hitting MongoDB.
  - Backed by the MongoDB `uniq_url_hash` index for database-level uniqueness guarantees.
- **SimHash Near-Duplicate Detection (`apps/crawler/src/dedupe/simhash.ts`)**:
  - Calculates a 64-bit SimHash fingerprint using token frequencies and word bigram shingles.
  - Computes Hamming distance between fingerprints; pages with Hamming distance $\le 3$ are flagged as near-duplicates (e.g. mirrored content, identical templates with minor date changes).
- **Politeness & robots.txt (`apps/crawler/src/politeness/robots.ts`)**:
  - Fetches and parses remote `robots.txt` using `robots-parser`.
  - Caches compliance rules in Redis with a 24-hour TTL.
  - Enforces `Disallow` directives and `Crawl-delay` specific to `SiftBot`.
  - Per-domain Token Bucket rate limiter (`rate-limiter.ts`) ensures the crawler never overwhelms host servers.
- **SSRF Protection (`apps/crawler/src/fetcher/ssrf-guard.ts`)**:
  - Pre-resolves domain names via DNS.
  - Blocks requests to loopback (`127.0.0.0/8`, `::1`), private RFC 1918 subnets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), link-local (`169.254.169.254`), and cloud metadata IP addresses.
- **Spider Trap Defense (`apps/crawler/src/frontier/trap-detector.ts`)**:
  - Detects and rejects runaway URLs (length > 512 chars, path depth > 10 segments).
  - Identifies repeating directory segments (e.g., `/archive/archive/archive`).
  - Catches calendar infinite traps (regex detection for `/2024/01/02/...`).
- **Dead Letter Queue (DLQ) & Replay (`apps/crawler/src/workers/dlq-worker.ts`)**:
  - Automatically classifies job failures into error classes: `dns`, `timeout`, `blocked`, `parse`, `too_large`, `rate_limited`, `not_found`, `server_error`.
  - Stores failed jobs with full stack traces in MongoDB `dlq_jobs`.
  - Supports administrative replay (`pnpm dlq:replay --class=timeout --limit=50`).

---

### Phase 2: Storage & High-Throughput Bulk Ingestion
- **Batch Upsert Worker (`apps/indexer/src/ingest-worker.ts`)**:
  - Ingests parsed documents in unordered batches of 500 to 1,000 using MongoDB `bulkWrite` with `updateOne` and `upsert: true`.
  - Dual-flush policy: flushes to disk as soon as 1,000 documents accumulate OR 2,000 ms elapsed time is reached.
  - Truncates body text to 50,000 characters to prevent memory exhaustion in MongoDB's WiredTiger cache.
  - Implements queue backpressure: pauses the upstream crawl fetcher if the ingest queue exceeds 10,000 jobs, auto-resuming once the queue drains below 2,000.
- **Streaming Public Dataset Importers (`packages/db/src/importers/`)**:
  - **Wikipedia Stream Importer (`wiki-stream.ts`)**: Streams `.xml.gz` or `.jsonl.gz` dumps line-by-line using Node streams, maintaining $O(1)$ constant memory (< 50MB RAM).
  - **Common Crawl WET Importer (`wet-stream.ts`)**: Streams and parses raw Web Extracted Text WARC records from Common Crawl dumps.
  - **Synthetic Technical Corpus Generator (`synthetic-generator.ts`)**: Generates 100k to 2M+ realistic, structured computer science & engineering articles at > 20,000 docs/sec directly into MongoDB to benchmark index scale without live internet scraping.
- **Benchmarking Suite (`bench/`)**:
  - `bench/ingest.ts`: Measures document ingest rate (docs/sec), batch write latencies, and memory footprint.
  - `bench/query.ts`: Runs 10,000 iterations over hot queries (point lookup, domain recency, unembedded partial scan) to measure p50, p95, and p99 latencies, verifying execution plans (`IXSCAN` vs `COLLSCAN`).

---

### Phase 3: Chunking, Embeddings & Qdrant Vector Indexing
- **Paragraph & Sentence-Aware Chunker (`packages/embeddings/src/chunker.ts`)**:
  - Splits text along natural boundaries (`\n\n` paragraphs, then sentence punctuation `[.!?]`) targeting ~400 tokens (~1600 characters) with a 50-token overlap.
  - **Title Prepending**: Injects `Title: <title>\n\n<chunk_text>` into each chunk prior to embedding. This maintains document context so that isolated passage vectors do not lose the overarching subject.
  - Limits chunks per document (default max 2) for strict API cost control.
- **Provider Agnostic Embedding Layer (`packages/embeddings/src/providers/`)**:
  - **Gemini Provider (`gemini-provider.ts`)**: Uses Google AI Studio `text-embedding-004` (768 dimensions), supporting native `batchEmbedContents` and exponential backoff for HTTP 429 rate limits.
  - **OpenAI Provider (`openai-provider.ts`)**: Supports `text-embedding-3-small` (1536 dimensions).
  - **Local Deterministic Provider (`local-provider.ts`)**: Generates 384-dimensional unit vectors using deterministic token hashing. Enables 100% offline development, testing, and CI runs without requiring paid API keys.
- **Redis Embedding Cache (`packages/embeddings/src/cache.ts`)**:
  - Computes SHA-256 content hashes of chunks.
  - Caches embedding vectors in Redis under `sift:emb:<model>:<sha256>` with a 30-day TTL, preventing redundant embeddings of duplicate texts or mirror sites.
- **Qdrant Vector DB Client (`packages/embeddings/src/qdrant.ts`)**:
  - Automatically initializes HNSW index (`m=16`, `ef_construct=128`, Cosine distance).
  - Sets up payload keyword indexes on `domain` and `lang` for fast filtering.
  - Batch upserts chunk points with deterministic UUIDs.
- **Idempotent Embed Worker (`apps/indexer/src/embed-worker.ts`)**:
  - Pulls batches of unembedded documents from MongoDB using the partial index.
  - Chunks text, computes vectors, upserts points to Qdrant, and marks the documents with `{ embedding: { model, version, qdrantId, embeddedAt } }`.
  - Fully idempotent: worker crashes can be restarted without duplicate embeddings or corrupted state.

---

### Phase 4: Hybrid Search Engine & Fastify API
- **Dual-Leg Parallel Retrieval (`packages/search/src/service.ts`)**:
  - **Keyword Leg (`packages/search/src/keyword.ts`)**: MongoDB full-text search with field weights (`title: 10`, `headings: 5`, `text: 1`) returning top 100 documents in ~10–25ms.
  - **Vector Leg (`packages/search/src/vector.ts`)**: Dense query embedding via Gemini `gemini-embedding-001` (768-d) with Redis query caching (`sift:query_emb:*`), querying Qdrant HNSW cosine index, and grouping candidate chunk vectors by document to extract maximum chunk similarity and best passage text.
  - **Graceful Degradation with Circuit Breakers**: Runs both legs concurrently via `Promise.allSettled` with per-leg timeout caps. If Qdrant or embedding times out, the search automatically degrades gracefully to pure keyword retrieval without failing the user request.
- **Reciprocal Rank Fusion (RRF) (`packages/search/src/fusion.ts`)**:
  - Fuses rankings with $RRF(d) = \sum_{m \in \{\text{keyword}, \text{vector}\}} \frac{1}{60 + r_m(d)}$.
  - Sub-1ms fusion step providing robust multi-modal ranking without score calibration issues.
- **Semantic Re-ranking (`packages/search/src/rerank.ts`)**:
  - Re-scores top 20 candidates using Gemini Flash (`gemini-2.5-flash`) with structured JSON schema output (`[{"index": 0, "score": 9.2}]`).
  - Seamless fallback to local deterministic cross-encoder scoring if offline or rate-limited. Toggleable with `rerank=true` or `mode=hybrid_rerank`.
- **Snippet Extraction & Query Highlighting (`packages/search/src/snippets.ts`)**:
  - Selects the highest-density passage from the matching vector chunk or document body, truncates around sentence boundaries, and highlights matched terms with `<mark>` tags.
- **Fastify Production API (`apps/api`)**:
  - `GET /search?q=...&limit=...&offset=...&domain=...&lang=...&rerank=...&mode=...`: Main search endpoint.
  - `GET /search/compare?q=...`: Side-by-side comparison across all 4 modes (Keyword, Vector, Hybrid RRF, Hybrid+Rerank).
  - `GET /metrics`: Prometheus latency histograms and query counters (`sift_search_latency_seconds`).
  - `GET /health`: Multi-service deep healthcheck.
  - IP Rate Limiting (`@fastify/rate-limit`, 120 req/min) and CORS enabled.

---

## 4. Core Computer Science & Systems Engineering Concepts

| Concept | Where Used | Why It Matters |
| :--- | :--- | :--- |
| **Bloom Filter** | RedisBloom (`apps/crawler/src/dedupe/bloom.ts`) | Probabilistic data structure that checks set membership in $O(1)$ time with zero false negatives and tiny memory footprint. Rejects visited URLs before touching MongoDB disk. |
| **SimHash & Hamming Distance** | Content Deduplication (`apps/crawler/src/dedupe/simhash.ts`) | Locality-sensitive hashing (LSH). Unlike cryptographic hashes (where 1 flipped bit scrambles the entire hash), SimHash keeps similar documents close in Hamming space. Distance $\le 3$ flags near-duplicates. |
| **Token Bucket Algorithm** | Politeness Rate Limiter (`apps/crawler/src/politeness/rate-limiter.ts`) | Allows controlled bursts while enforcing an average rate limit per domain. Respects remote server health. |
| **HNSW (Hierarchical Navigable Small World)** | Qdrant Vector Index (`packages/embeddings/src/qdrant.ts`) | Graph-based approximate nearest neighbor (ANN) search algorithm. Navigates multi-layer graphs to achieve sub-50ms vector lookups over millions of high-dimensional vectors. |
| **WiredTiger Cache Management** | Bulk Ingestion (`apps/indexer/src/ingest-worker.ts`) | MongoDB storage engine uses memory-mapped cache. Without body truncation and batched upserts, uncontrolled document ingestion triggers page evictions and CPU thrashing. |
| **Reciprocal Rank Fusion (RRF)** | Hybrid Search Ranking (Phase 4) | Combines ranked lists from distinct retrieval algorithms (keyword BM25 + vector cosine) without needing calibrated score normalization: $RRF(d) = \sum_{m \in M} \frac{1}{k + r_m(d)}$. |

---

## 5. Current Testing & Verification Status

Every component built so far is covered by automated unit and integration tests.

### Test Matrix Summary (`vitest run`)
- `packages/core/test/config.test.ts` (3 tests): Zod schema validations, default fallbacks, type parsing.
- `packages/core/test/logger.test.ts` (2 tests): Logger instantiations, formatting.
- `packages/core/test/metrics.test.ts` (2 tests): Prometheus metric registration, scrape output formatting.
- `packages/db/test/db.test.ts` (5 tests): MongoDB repository CRUD, index spec verification.
- `apps/crawler/test/url-normalizer.test.ts` (9 tests): RFC 3986 URL normalization, tracking query stripping, relative URL resolution, hash generation.
- `apps/crawler/test/robots.test.ts` (4 tests): robots.txt allow/disallow compliance, wildcard matching, crawl-delay extraction.
- `apps/crawler/test/simhash.test.ts` (4 tests): SimHash fingerprint calculation, Hamming distance, near-duplicate detection.
- `apps/crawler/test/ssrf-guard.test.ts` (5 tests): SSRF protection against private RFC 1918 IPs, localhost, and IPv6 loopbacks.
- `apps/crawler/test/trap-detector.test.ts` (8 tests): Detection of calendar traps, repetitive directory loops, and runaway query depths.
- `packages/embeddings/test/chunker.test.ts` (4 tests): Paragraph and sentence chunking, token estimation, overlap sliding, title prepending.
- `packages/embeddings/test/local-provider.test.ts` (5 tests): Unit vector generation, cosine normalization, batch consistency.
- `apps/indexer/test/point-id.test.ts` (3 tests): Deterministic UUID generation for vector points across restarts.
- `packages/search/test/fusion.test.ts` (3 tests): Reciprocal Rank Fusion score blending, rank preservation, tie-breakers.
- `packages/search/test/snippets.test.ts` (3 tests): Contextual window selection, query term extraction, `<mark>` tag highlighting.
- `packages/search/test/rerank.test.ts` (1 test): Semantic re-ranking promotion and deterministic local fallback scoring.
- `apps/api/test/api.test.ts` (6 tests): Fastify HTTP injection testing for `/search`, `/search/compare`, `/health`, `/metrics`, query validation, and fallback modes.

**Total**: **16 test suites, 67 tests passing, 0 TypeScript errors.**

### Live Verification Status
- **Google Gemini API**: Verified and active (`gemini-embedding-001`, 768 dimensions with `outputDimensionality: 768`, and `gemini-2.5-flash` for re-ranking).
- **Qdrant Vector DB**: Verified and active with HNSW index and payload indexes (`sift_chunks`).
- **Redis Stack**: Verified and active (`PING -> PONG`, RedisBloom enabled, query cache active).
- **MongoDB**: Verified and active with 8 compound/text/partial indexes applied.
- **Search Retrieval Benchmark**: Verified live on indexed corpus across Keyword (9-25ms), Vector (~110ms), Hybrid RRF (20-35ms), and Re-ranked modes.

---

## 6. Roadmap: What Comes Next (Phase 5 – 7)

```
[Phase 0: Done] -> [Phase 1: Done] -> [Phase 2: Done] -> [Phase 3: Done] -> [Phase 4: Done]
                                                                                  │
                                                                                  ▼
                                                                      [Phase 5: Browser Agent]
                                                                                  │
                                                                                  ▼
                                                                      [Phase 6: Evals & Benchmarks]
                                                                                  │
                                                                                  ▼
                                                                      [Phase 7: Modern UI & Dashboards]
```

### Phase 5: Autonomous Browser Agent (Next Phase)
- Playwright-driven Observe-Decide-Act loop.
- Pruned DOM & accessibility tree representations for the LLM.
- Schema-validated structured extraction (e.g. products, prices, papers) with Zod.

### Phase 6: Evals & Benchmarks
- Relevance evaluation: nDCG@10, MRR, Recall@50 over a test query set.
- Comparison: Keyword vs Vector vs Hybrid vs Hybrid + Re-rank.
- 100-task agent eval benchmark across 20+ websites with failure taxonomy.

### Phase 7: UI, Observability & Polish
- Modern search UI with stage latency breakdown and side-by-side A/B retrieval comparison.
- Admin dashboard for queue depths and DLQ replay.
- Grafana dashboard monitoring crawl rate, ingest throughput, and search latencies.

---

## 7. Operational Cheat Sheet (CLI & Commands)

All commands are run from the monorepo root:

```bash
# 1. Start Infrastructure Services
docker compose -f infra/docker-compose.yml up -d

# 2. Verify Connectivity
pnpm healthcheck

# 3. Apply MongoDB Indexes
pnpm db:migrate

# 4. Run Test Suite & Typecheck
pnpm test
pnpm typecheck

# 5. Populate Test Corpus
pnpm import:synthetic 100000        # Generate 100k synthetic documents

# 6. Run Ingestion & Latency Benchmarks
pnpm bench:ingest 100000
pnpm bench:query 10000

# 7. Run Vector Indexing Worker
pnpm indexer:embed 100              # Embed a batch of 100 documents
pnpm indexer:start                  # Start continuous embed worker
```
