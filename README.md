# Sift: Self-Built AI Search Engine

> **Distributed Polite Crawler • 2M+ Scaled Document Store • Hybrid Keyword & Vector Retrieval • Autonomous Browser Agent**

---

## Architecture Overview

```
                       [ Public Web / Dumps ]
                                 │
           ┌─────────────────────┴─────────────────────┐
           ▼                                           ▼
   [ Fast Static Crawler ]                    [ Playwright Browser Agent ]
 (undici, robots.txt, politeness,           (LLM Observe-Decide-Act loop,
  Bloom dedupe, SimHash near-dup)            handles SPAs, JS clicks, schemas)
           │                                           │
           └─────────────────────┬─────────────────────┘
                                 ▼
                     [ Redis / BullMQ Queues ]
                (fetch, parse, ingest, embed, DLQ)
                                 │
           ┌─────────────────────┴─────────────────────┐
           ▼                                           ▼
  [ MongoDB Storage ]                         [ Qdrant Vector DB ]
 (2M+ docs, bulk upserts,                    (Text chunk embeddings,
  p95 < 5ms indexed lookups)                  cosine distance, HNSW)
           │                                           │
           └─────────────────────┬─────────────────────┘
                                 ▼
                    [ Hybrid Search Engine ]
                     ├── Keyword Leg (Mongo text search / BM25)
                     ├── Vector Leg (Qdrant semantic search)
                     ├── Reciprocal Rank Fusion (RRF k=60)
                     └── Cross-Encoder / LLM Re-ranker (Top 30)
                                 │
                                 ▼
              [ Fastify API + Modern Search UI ]
        (Sub-100ms latency, A/B compare view, snippets)
```

---

## Monorepo Layout

```
sift/
  apps/
    crawler/        # fetch workers, frontier, scheduler
    indexer/        # embed worker, index maintenance
    api/            # Fastify search API
    agent/          # Playwright + LLM browser agent
    web/            # modern search UI
  packages/
    core/           # typed config (Zod), Pino logger, Prometheus metrics
    db/             # MongoDB client, repositories, index migrations
    queue/          # BullMQ setup, typed job payloads, connection factory
    embeddings/     # provider interface (Gemini/OpenAI/local)
    search/         # keyword, vector, RRF fusion, re-rank
  bench/            # ingest and query benchmarks
  eval/             # relevance (nDCG@10, MRR) and agent eval harnesses
  infra/            # docker-compose.yml, prometheus.yml, grafana
  docs/             # architecture, query execution plans, ADRs
  scripts/          # infrastructure health check and utilities
```

---

## Phase Status

| Phase | Description | Status |
| --- | --- | --- |
| **Phase 0** | **Foundations (Monorepo, Docker Compose, @sift/core, @sift/db, Healthcheck)** | **✅ Completed** |
| **Phase 1** | **Crawler Core (robots.txt, token bucket politeness, Bloom dedupe, DLQ)** | **✅ Completed** |
| **Phase 2** | **Storage & Bulk Ingestion (batches 500-1000, streaming WET/dump importers)** | **✅ Completed** |
| **Phase 3** | **Chunking, Embeddings & Qdrant Indexing (HNSW, title-prepending)** | **✅ Completed** |
| **Phase 4** | **Hybrid Search API (Mongo keyword + Qdrant vector + RRF + Re-ranking)** | **✅ Completed** |
| **Phase 5** | **Playwright Browser Agent (a11y tree, Observe-Decide-Act, schema extraction)** | **✅ Completed** |
| **Phase 6** | Relevance & Agent Evaluation Benchmarks (nDCG@10, MRR, 100-task agent eval) | 🔄 Next |
| **Phase 7** | Modern Search UI, A/B Retrieval Inspector & Observability | ⏳ Queued |

---

## Playwright LLM Browser Agent (Phase 5)

* **Autonomous Observe-Decide-Act Loop** (`apps/agent/src/runner.ts`):
  * **Observation Generation** (`apps/agent/src/browser/dom-observer.ts`): Instead of massive raw HTML (which blows context budgets and costs dollars per run), Sift extracts a pruned accessibility representation. It maps visible interactive elements to stable numeric IDs (`[1]`, `[2]`, `[3]`), marks the live DOM with `data-sift-id="N"`, extracts contextual body paragraphs, and summarizes page state.
  * **Auto-Dismissing Cookie Banners**: Detects and auto-dismisses cookie and consent modals (matching "Accept all", "Agree", "Allow all") on navigation.
  * **Action Tool Execution** (`apps/agent/src/browser/browser-session.ts`): Direct function execution via Playwright Chromium: `click(id)`, `type(id, text)`, `scroll(direction)`, `wait_for(target)`, `go_back()`, `extract(data)`, `finish(reason)`.
  * **Schema Validation & Feedback Loop** (`apps/agent/src/validation/schema-validator.ts`): Validates extracted JSON against Zod schemas or JSON Schema definitions. On validation errors, feeds detailed diagnostic error messages back to the agent for self-correction (up to 2 retries).
* **Multi-Layered Security Guardrails** (`apps/agent/src/security/guardrails.ts`):
  * **SSRF Protection**: Blocks navigation to private IPv4 (`127.0.0.0/8`, `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `169.254.0.0/16`) and IPv6 loopback/link-local addresses, and blocks `localhost`/internal domains.
  * **Domain Allowlist**: Prevents agent runaway across untrusted external third-party sites.
  * **Credential Blocker**: Detects password inputs, credit cards, CVV, and PIN fields, throwing `SecurityGuardError` if an action attempts typing into sensitive credentials.
  * **Budget Watchdog**: Enforces strict step caps (default: 15), token limits (default: 60,000), and wall-clock execution timeouts (default: 2 minutes).
* **Execution Tracing & Interactive Visual Viewer** (`apps/agent/src/viewer/server.ts`):
  * **Persistence**: Every run stores step-by-step screenshots (base64 JPEG thumbnails), agent reasoning thoughts, actions, observation DOM trees, tokens, and duration into MongoDB `agent_runs`.
  * **Trace Viewer**: Fastify web dashboard on port `3005` (`GET /traces`, `GET /traces/:id`) with step carousel, screenshot preview, and copy-to-clipboard structured JSON output.
* **Hybrid Crawler Integration** (`apps/crawler/src/workers/render-worker.ts`):
  * Detects SPA pages (empty root `#root`, `#app`, `#_next` or `noscript` JS warnings) during static crawling and automatically re-routes to a headless Playwright render worker, saving documents with `renderMode: 'rendered'`.

### Browser Agent Commands
```bash
# Run autonomous extraction agent via CLI
pnpm agent:run --url "https://example.com/product" --goal "Extract product name and price"

# Start the interactive visual trace viewer
pnpm agent:viewer --port 3005

# Run 10-scenario agent verification suite
npx tsx scripts/verify-agent.ts
```

---

## Hybrid Search Engine & Fastify API (Phase 4)

* **Dual-Leg Parallel Retrieval** (`packages/search/src/service.ts`):
  * **Keyword Leg** (`packages/search/src/keyword.ts`): MongoDB text search over weighted text index (`title: 10`, `headings: 5`, `text: 1`), returning top 100 candidates in ~10–25ms.
  * **Vector Leg** (`packages/search/src/vector.ts`): Dense query embedding via Gemini `gemini-embedding-001` (768-d) with Redis query caching (`sift:query_emb:*`), querying Qdrant HNSW cosine index (`m=16`, `ef_construct=128`), and grouping candidate chunks by document.
  * **Parallel Execution with Per-Leg Timeout**: Runs both legs concurrently via `Promise.allSettled`. If Qdrant or embedding times out, the search automatically degrades gracefully to pure keyword retrieval without failing the user request.
* **Reciprocal Rank Fusion (RRF)** (`packages/search/src/fusion.ts`):
  * Blends ranks using $RRF(d) = \sum_{m} \frac{1}{60 + r_m(d)}$.
  * Sub-1ms fusion step providing robust multi-modal ranking without score calibration issues.
* **Semantic Re-ranking** (`packages/search/src/rerank.ts`):
  * Re-scores top 20 candidates using Gemini Flash (`gemini-2.5-flash`) with structured JSON schema output (`[{"index": 0, "score": 9.2}]`).
  * Seamless fallback to local deterministic cross-encoder scoring if offline or rate-limited. Toggleable with `rerank=true` or `mode=hybrid_rerank`.
* **Snippet Extraction & Query Highlighting** (`packages/search/src/snippets.ts`):
  * Selects the highest-density passage from the matching vector chunk or document body, truncates around sentence boundaries, and highlights matched terms with `<mark>` tags.
* **Fastify Production API** (`apps/api`):
  * `GET /search?q=...&limit=...&offset=...&domain=...&lang=...&rerank=...&mode=...`: Main search endpoint.
  * `GET /search/compare?q=...`: Side-by-side comparison across all 4 modes (Keyword, Vector, Hybrid RRF, Hybrid+Rerank).
  * `GET /metrics`: Prometheus latency histograms and query counters (`sift_search_latency_seconds`).
  * `GET /health`: Multi-service deep healthcheck.
  * IP Rate Limiting (`@fastify/rate-limit`, 120 req/min) and CORS enabled.

### Search API Commands
```bash
# Start the Fastify Search API server (Port 3001)
pnpm api:start

# Start API in dev watch mode
pnpm api:dev

# Run retrieval verification across all 4 modes
npx tsx scripts/verify-search.ts
```

---

## Chunking, Embeddings & Qdrant Vector DB (Phase 3)

* **Paragraph & Sentence-Aware Chunker** (`packages/embeddings/src/chunker.ts`):
  * Breaks document text on natural boundaries to ~400 tokens with 50-token overlap.
  * **Title-Prepending**: Injects `Title: <title>\n\n<chunk>` to preserve document context in isolated vector searches.
  * Limits chunks per document (default max 2) for cost control.
* **Provider Agnostic Embedding Layer** (`packages/embeddings/src/providers/`):
  * **Gemini Provider**: Google AI Studio `text-embedding-004` (768-d) with `batchEmbedContents` and 429 exponential backoff.
  * **OpenAI Provider**: `text-embedding-3-small` (1536-d) with batching.
  * **Local Deterministic Provider**: 384-d unit vectors for offline development, local unit tests, and CI without API keys.
* **Redis Embedding Cache** (`packages/embeddings/src/cache.ts`):
  * SHA-256 content-hash caching (`sift:emb:<model>:<hash>`) with 30-day TTL. Prevents re-embedding duplicate chunks or mirror pages.
* **Qdrant Vector DB Client** (`packages/embeddings/src/qdrant.ts`):
  * Auto-creates HNSW collection (`m=16`, `ef_construct=128`, Cosine distance).
  * Creates payload indexes on `domain` and `lang` for instant payload filtering.
  * Batch upserts chunk points with deterministic UUIDs.
* **Idempotent Embed Worker** (`apps/indexer/src/embed-worker.ts`):
  * Consumes un-embedded docs from MongoDB, generates vectors, upserts to Qdrant, and updates Mongo metadata. Safe to kill and resume at any time.

### Vector Indexing Commands
```bash
# Start Indexer (running both bulk ingest and embed workers)
pnpm indexer:start

# Run manual one-off embedding batch on unembedded documents
pnpm indexer:embed 100
```

---

## Storage & Bulk Ingestion Architecture (Phase 2)

* **High-Throughput Batch Ingestion** (`apps/indexer/src/ingest-worker.ts`):
  * Unordered `bulkWrite` with `updateOne` upserts keyed on unique `urlHash`.
  * Dual-flush threshold: flushes immediately upon reaching 1,000 documents or 2,000 ms elapsed time.
  * Stored text truncated to max 50,000 characters to prevent WiredTiger memory bloat.
  * Bidirectional queue backpressure: pauses upstream fetcher if ingest queue exceeds 10,000 jobs; auto-resumes once cleared below 2,000 jobs.
* **Streaming Public Archive Importers** (`packages/db/src/importers/`):
  * **Wikipedia Stream Importer**: Streams XML or JSONL exports line-by-line with $O(1)$ constant memory (<50MB RAM).
  * **Common Crawl WET Importer**: Parses WARC text segments directly from `.wet` / `.wet.gz` archives.
  * **Synthetic Corpus Generator**: Generates 10k to 2M+ structured technical engineering articles at >20,000 docs/sec directly into MongoDB.
* **Benchmarking Harnesses**:
  * `bench/ingest.ts`: Measures ingest throughput (docs/sec), batch write latencies, and RAM footprint across 100k, 500k, 1M, and 2M document scales.
  * `bench/query.ts`: Measures p50, p95, and p99 query latency over 10,000 iterations for hot queries and verifies `IXSCAN` plans without `COLLSCAN`.

### Importer & Benchmark Commands
```bash
# Start the bulk indexer worker
pnpm indexer:start

# Ingest synthetic documents for local scaling (e.g. 100k or 2M)
pnpm import:synthetic 100000

# Stream import Wikipedia dump
pnpm import:wiki ./data/dumps/enwiki-latest.jsonl.gz

# Stream import Common Crawl WET segment
pnpm import:wet ./data/dumps/crawl.wet.gz

# Run Ingestion Throughput Benchmark
pnpm bench:ingest 100000

# Run Query Latency & Explain Plan Benchmark (10,000 iterations)
pnpm bench:query 10000
```

---

## Crawler Usage & CLI (Phase 1)


The distributed crawler (`apps/crawler`) implements production politeness and fault tolerance:
* **RFC 3986 URL Normalizer**: Strips marketing/tracking query parameters (`utm_*`, `fbclid`, `gclid`), sorts query params, resolves relative links, and generates a deterministic 64-bit `urlHash`.
* **Deduplication Engine**: Uses RedisBloom filter (`BF.EXISTS` / `BF.ADD`) for $O(1)$ fast rejection, backed by MongoDB unique index for correctness.
* **SimHash Near-Duplicate Clustering**: Computes 64-bit SimHash with term-frequency weighting to identify duplicate and mirrored pages with Hamming distance $\le 3$.
* **Politeness & robots.txt**: Caches remote `robots.txt` in Redis (24h TTL), respects `Disallow` rules and `Crawl-delay`, and executes per-domain token bucket rate limiting with randomized jitter.
* **SSRF Guard**: Pre-resolves DNS to block private IP ranges (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`, `169.254.169.254`, `::1`).
* **Spider Trap Defense**: Rejects repeating directory paths, calendar traps, and pagination runaways.
* **Dead Letter Queue (DLQ)**: Classifies failures (`timeout`, `dns`, `blocked`, `too_large`, `rate_limited`) into MongoDB and BullMQ DLQ with administrative replay.

### Crawler Commands
```bash
# Start background fetch and parse workers
pnpm crawler:start

# Seed the crawl frontier with initial URLs
pnpm crawler:seed

# Replay failed jobs from Dead Letter Queue
pnpm dlq:replay --class=timeout --limit=50

# Audit crawled URLs against cached robots.txt compliance
pnpm audit:robots
```

---

## Quickstart

### 1. Environment Setup
```bash
cp .env.example .env
```

### 2. Start Services via Docker
```bash
docker compose -f infra/docker-compose.yml up -d
```

### 3. Verify Infrastructure Connectivity
```bash
pnpm healthcheck
```

### 4. Run Migrations & Tests
```bash
# Apply compound & unique indexes to MongoDB
pnpm db:migrate

# Run unit test suite (19 test files, 85 tests passing)
pnpm test

# Typecheck all packages & apps
pnpm typecheck
```

---

## Web UI & Observability (Phase 7)

Sift includes a modern, high-performance web interface built with React 18, Vite 6, and custom glassmorphism styles:

### Starting the Web UI
```bash
# Start API gateway backend (port 3001)
pnpm api:start

# In another terminal, start Vite development server (port 5173)
pnpm web:dev

# Or build the production web bundle
pnpm web:build
```

### Web Interface Views:
- **Search View** (`http://localhost:5173`): Interactive query bar with `/` keyboard focus, mode switcher (`Hybrid + Re-rank`, `Hybrid RRF`, `Vector`, `Keyword`), domain filters, highlighted snippet marks, and per-stage latency breakdown (`embed`, `keyword`, `vector`, `fusion`, `rerank`).
- **4-Way Compare View**: Real-time side-by-side comparison across all four retrieval engines with candidate overlap indicators (`Universal`, `Shared`, `Unique`).
- **Admin & Telemetry Dashboard**: Live cluster health, MongoDB corpus size, Qdrant vector count, memory usage, and BullMQ queue gauges across `fetch`, `parse`, `ingest`, `embed`, `render`, and `dlq`.
- **Dead Letter Queue (DLQ) Inspector**: Inspect unrecoverable failures, stack traces, and execute 1-click re-enqueueing back into the crawl pipeline.
- **Agent Trace Inspector**: Step-by-step browser replay with planner reasoning, action parameters, execution duration, and full-resolution viewport screenshots.

### Grafana & Infrastructure Dashboards:
- **Grafana**: `http://localhost:3002` (login: `admin` / `admin`)
  - Pre-provisioned `Sift Overview & Pipeline Telemetry` dashboard (`infra/grafana/dashboards/sift-overview.json`).
- **Prometheus**: `http://localhost:9090` (live metrics scraper).
- **RedisInsight**: `http://localhost:8001` (Redis queue & Bloom filter visualizer).

---

## Documentation & Architecture:
- [System Architecture](file:///docs/architecture.md): Complete system overview with Mermaid sequence and component diagrams.
- [ADR 001: Reciprocal Rank Fusion](file:///docs/adr/001-hybrid-search-rrf.md): Architectural decision on RRF vs linear normalization.
- [ADR 002: MongoDB Compound Indexing](file:///docs/adr/002-mongodb-compound-indexing.md): ESR index design and WiredTiger cache control.
- [ADR 003: Semantic DOM Pruning](file:///docs/adr/003-browser-agent-dom-pruning.md): `data-sift-id` numeric tagging and 92% token reduction.
- [MongoDB Query Execution Plans](file:///docs/query-plans.md): Verified `IXSCAN` and covered query proofs.


