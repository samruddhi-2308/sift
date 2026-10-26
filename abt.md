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

## 6. Phase 5: Autonomous Playwright Browser Agent

```
[Phase 0: Done] -> [Phase 1: Done] -> [Phase 2: Done] -> [Phase 3: Done] -> [Phase 4: Done] -> [Phase 5: Done]
                                                                                                      │
                                                                                                      ▼
                                                                                         [Phase 6: Evals & Benchmarks]
                                                                                                      │
                                                                                                      ▼
                                                                                         [Phase 7: Modern UI & Dashboards]
```

### 6.1 The Core Problem: Why Static Crawlers Fail on the Modern Web
Standard HTTP crawlers (like `undici` in Phase 1) request an endpoint and receive static HTML. However:
1. **Single-Page Applications (SPAs)**: Frameworks like React, Next.js, Vue, and Angular often serve an empty shell (`<div id="root"></div>`) and load data asynchronously via client-side JavaScript. Static parsers extract empty text.
2. **Interactive UI Barriers**: Cookie consent modals, popups, and tabbed navigation block or hide primary content until clicked.
3. **Infinite Scroll & Dynamic Pagination**: Catalogs, feeds, and job boards require scrolling down or clicking "Load more" to trigger API requests.
4. **Structured Data Extraction Needs**: Plain text search extracts raw prose, but applications require structured JSON (e.g. `{ name: string, price: number, inStock: boolean }`).

### 6.2 Architecture of the Observe-Decide-Act Loop

```
                     +---------------------------------------+
                     |         BrowserSession                |
                     |  (Playwright Headless Chromium)       |
                     +-------------------+-------------------+
                                         │  1. In-browser JS
                                         ▼
                     +---------------------------------------+
                     |          DOM Observer                 |
                     |  - Prune invisible/noisy elements    |
                     |  - Assign numeric IDs [1], [2], [3]  |
                     |  - Tag DOM: data-sift-id="N"         |
                     |  - Extract text & scroll position    |
                     +-------------------+-------------------+
                                         │  2. Pruned Observation
                                         ▼
+--------------------+---------------------------------------+--------------------+
|                                AgentPlanner (LLM)                               |
|                     (Gemini 2.5 Flash / Deterministic Fallback)                 |
|                                                                                 |
|  Prompt = Goal + Schema + Pruned Elements [1..N] + Text + Validation Feedback   |
|  Decide = { thought: "...", action: { name: "click"|"extract", args: {...} } }  |
+--------------------+---------------------------------------+--------------------+
                     │  3. Structured Action Call
                     ▼
+--------------------+---------------------------------------+--------------------+
|                               Action Execution                                  |
|  click(id)      -> page.locator('[data-sift-id="N"]').click()                   |
|  type(id, text) -> Security check -> page.fill(...)                             |
|  scroll(dir)    -> window.scrollBy(0, ±0.75 * innerHeight)                      |
|  extract(data)  -> SchemaValidator(data, schema)                                |
+---------------------------------------------------------------------------------+
```

### 6.3 The DOM Pruning Problem: Why Raw HTML is Unacceptable
Modern web pages frequently have 5,000 to 30,000 DOM nodes. Sending raw HTML to an LLM:
- **Exceeds Context Windows / Drives High Latency**: Sending 250KB of raw HTML uses 60,000+ tokens per step. At 15 steps, that is 900,000 tokens!
- **High Financial Cost**: At $0.075/1M tokens, a single task would cost several cents and hit rate limits immediately.
- **Hallucination Risk**: Large HTML containing SVG paths, inline CSS, minified scripts, and hidden trackers confuses LLM reasoning.

**Sift's Pruning Algorithm** (`apps/agent/src/browser/dom-observer.ts`):
1. **Interactive Element Filtering**: Scans candidate interactive elements: `a`, `button`, `input`, `select`, `textarea`, `summary`, ARIA roles (`role="button"`, `role="link"`, `role="tab"`), `tabindex="0"`.
2. **True Geometric Visibility**: Checks `isConnected`, computed styles (`display !== 'none'`, `visibility !== 'hidden'`, `opacity > 0`), and bounding box (`width > 2 && height > 2`).
3. **Deduplication**: Prunes nested interactive elements (e.g. SVG icons inside buttons).
4. **Stable Numeric IDs**: Assigns consecutive integer IDs `[1]`, `[2]`, `[3]` and sets `data-sift-id="N"` on live DOM elements. The LLM simply outputs `{"name": "click", "args": {"id": 4}}`. Playwright executes `page.locator('[data-sift-id="4"]').click()`, completely eliminating brittle CSS selectors!
5. **Contextual Text Summary**: Scans leaf text nodes (`p`, headings, leaf `div`/`span` with classes like `price`, `author`, `stock`, `meta`) and compiles a concise 2,000-character excerpt.

### 6.4 Schema Validation & Feedback-Driven Self-Correction
When the LLM issues an `extract(data)` action:
1. `SchemaValidator` validates the payload against the provided Zod schema or JSON Schema.
2. If valid: The run succeeds immediately!
3. If invalid: The run does **not** fail. Instead, detailed errors (e.g. `Field "price" must be a number, received string`) are injected into the LLM's prompt in the next observation step:
   ```
   CRITICAL: Your previous extraction failed schema validation:
   - Field "price" must be a number, received string.
   Please inspect the page content again, correct the data types/keys, and re-extract.
   ```
4. The LLM self-corrects and re-extracts (up to 2 retries).

### 6.5 Multi-Layered Security Guardrails (`apps/agent/src/security/guardrails.ts`)
Autonomous agents with browser access require strict security boundaries:
1. **SSRF Protection**: Resolves target IP addresses and blocks navigation to private IPv4 ranges (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16` cloud metadata), IPv6 loopback (`::1`), link-local (`fe80::/10`), unique-local (`fc00::/7`), and local hostnames (`localhost`, `*.internal`).
2. **Domain Allowlist**: Restricts agent navigation to permitted domains, preventing crawler escapes to untrusted third-party domains.
3. **Credential & Sensitive Field Blocker**: Inspects target element types and attributes (`type="password"`, `name` or `id` matching `password|passwd|secret|creditcard|cc_num|cvv|cvc|ssn|pin`), throwing `SecurityGuardError` if an action attempts typing into credential fields.
4. **Download & Dialog Interception**: Disables file downloads (`page.on('download', (d) => d.cancel())`) and automatically dismisses file pickers.
5. **Budget Watchdog**: Enforces strict step caps (default: 15), token limits (default: 60,000), and wall-clock execution timeouts (default: 120s), stopping runaway loops safely (`budget_exceeded`).

### 6.6 Execution Tracing & Interactive Visual Viewer (`apps/agent/src/viewer/server.ts`)
- **Persistence**: Every run saves complete trace data to MongoDB `agent_runs` (indexed on `runId` unique and `startedAt: -1`).
- **Data Captured**: Step numbers, timestamps, target URLs, full observation states, JPEG thumbnail screenshots (base64 data URIs), LLM reasoning thoughts, action parameters, execution results, token usage, and latency.
- **Trace Viewer UI**: A responsive Fastify dashboard on port `3005` (`http://localhost:3005/traces`) providing an interactive step carousel, screenshot preview, action parameter inspector, and copy-to-clipboard structured JSON output.

### 6.7 Hybrid Crawling Architecture (`apps/crawler/src/workers/render-worker.ts`)
- The crawler initially fetches pages via fast HTTP (`undici`).
- If extracted text is below threshold or page contains SPA markers (`<div id="root"></div>`, `<div id="app"></div>`, or `noscript` JS warnings), the page is re-routed to `sift-render` queue.
- `renderWorker` uses headless Playwright to load the page, wait for JavaScript hydration, extract dynamic HTML, and re-enqueue for parsing with `renderMode: 'rendered'`.

---

## 7. Deep Dive: Phase 7 — UI, Observability, and Production Polish

Phase 7 brings the entire Sift platform together with an operator dashboard, modern search interface, comprehensive observability, and system architecture documentation.

### 7.1 Modern Search & Observability Web Application (`apps/web`)
Built using React 18, Vite 6, TypeScript, and a bespoke Vanilla CSS design system (avoiding CSS framework bloat):
- **Rich Dark Glassmorphism**: Tailored HSL color palette, subtle linear gradients, frosted glass backdrop filters, and custom scrollbars.
- **Micro-Animations & Responsive Interactivity**: Real-time heartbeat indicator, tab transitions, hover states, and keyboard shortcut `/` to instantly focus search.
- **Integrated View Suite**:
  1. **Search View**: Unified search with real-time stage latency pills (`embedMs`, `keywordMs`, `vectorMs`, `fusionMs`, `rerankMs`, `totalMs`), mode selection (`hybrid_rerank`, `hybrid`, `vector`, `keyword`), domain filtering, and safe HTML snippet rendering.
  2. **4-Way Compare View**: Dispatches queries in parallel to compare Keyword (BM25), Dense Vector (Qdrant HNSW), Hybrid (RRF $k=60$), and Cross-Encoder Re-ranked side-by-side with document overlap tags (`Universal`, `Shared`, `Unique`).
  3. **Admin & Queue Telemetry Dashboard**: Live cluster health, corpus cardinality (total docs, embedded docs, domains, agent runs, DLQ errors), and real-time BullMQ queue depths across all 6 queues (`fetch`, `parse`, `ingest`, `embed`, `render`, `dlq`).
  4. **DLQ Inspector & Replay**: Detailed view of unrecoverable errors with categorized tags (`HTTP_STATUS_429`, `TIMEOUT`, `PARSER_FAILURE`), stack trace viewer, and 1-click re-enqueueing into `sift-fetch`.
  5. **Autonomous Agent Trace Inspector**: Interactive timeline replay for browser agent executions, complete with LLM reasoning thoughts, action arguments, duration, and embedded base64 viewport screenshots, plus JSON export.

### 7.2 Grafana & Prometheus Provisioning (`infra/`)
- Pre-configured Grafana dashboard JSON (`infra/grafana/dashboards/sift-overview.json`):
  - Ingestion throughput (Pages/sec by domain and status).
  - BullMQ queue depths over time.
  - DLQ failures broken down by error classification.
  - Crawl duration percentiles ($p_{95}, p_{99}$).
  - Search query latencies ($p_{95}$) segmented by retrieval mode and pipeline stage.
  - Node.js heap memory utilization and event loop metrics.
- Automated datasource and dashboard provisioning via YAML configs in `infra/grafana/provisioning/`.

### 7.3 Architectural Records & Query Execution Verification (`docs/`)
- **System Architecture** (`docs/architecture.md`): Full Mermaid sequence and topology diagrams for crawler, ingestion, search, and agent subsystems.
- **Architectural Decision Records** (`docs/adr/`):
  - `001-hybrid-search-rrf.md`: Scale-invariance and robustness of Reciprocal Rank Fusion ($k=60$) over linear normalization.
  - `002-mongodb-compound-indexing.md`: ESR-compliant compound B-Tree indexing and WiredTiger cache bounds (`--wiredTigerCacheSizeGB 1.5`).
  - `003-browser-agent-dom-pruning.md`: Semantic DOM pruning with stable numeric `data-sift-id` attributes vs raw accessibility trees (92% token reduction).
- **MongoDB Query Plan Proofs** (`docs/query-plans.md`): Documented `explain("executionStats")` verifying index-covered scans (`IXSCAN`) and absence of `COLLSCAN`.

---

## 8. Operational Cheat Sheet (CLI & Commands)

All commands are run from the monorepo root:

```bash
# 1. Start Infrastructure Services (MongoDB, Redis Stack, Qdrant, Prometheus, Grafana)
docker compose -f infra/docker-compose.yml up -d

# 2. Verify Connectivity
pnpm healthcheck

# 3. Apply MongoDB Indexes
pnpm db:migrate

# 4. Run Complete Test Suite & Typecheck (19 test files, 85 tests passing)
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

# 8. Start Fastify API Gateway (Port 3001)
pnpm api:start                      # or pnpm api:dev

# 9. Start Modern Search & Observability UI (Port 5173)
pnpm web:dev                        # Launches Vite dev server with proxy to API
pnpm web:build                      # Production build: tsc -b && vite build

# 10. Access Observability Dashboards
# - Web UI: http://localhost:5173
# - Grafana Dashboard: http://localhost:3002 (admin/admin)
# - Prometheus Metrics: http://localhost:9090
# - RedisInsight: http://localhost:8001

# 11. Run Autonomous Browser Agent
pnpm agent:run --url "https://books.toscrape.com" --goal "Extract book title and price"

# 12. Run 10-Scenario Browser Agent Verification Suite
npx tsx scripts/verify-agent.ts
```


