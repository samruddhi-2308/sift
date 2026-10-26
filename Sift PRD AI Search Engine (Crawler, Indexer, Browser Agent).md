# Sift: AI Search Engine PRD

**Crawler, Indexer, Hybrid Search & Browser Agent** Stack: TypeScript, Node.js, MongoDB, Redis, Playwright, Qdrant, Gemini/OpenAI Embeddings Audience: an AI coding agent (Antigravity or similar) and the human reviewing its work.

---

## 0. How to use this document

This PRD is meant to be handed to a coding agent phase by phase. Rules for the agent:

1. Work on **one phase at a time**. Do not start Phase N+1 until every acceptance criterion in Phase N passes.
2. Every phase ends with: working code, tests, a short update to `README.md`, and a git commit tagged `phase-N-done`.
3. Never invent benchmark numbers. All metrics in the README must come from the scripts in `/bench` and `/eval`, with the raw output committed.
4. Ask the human when a requirement is ambiguous. The open questions are in Section 14.
5. Prefer boring, well-known libraries. No framework magic that hides the interesting parts (queues, indexing, ranking). Those are the point of the project.

---

## 1. Product overview

### 1.1 Vision

Sift is a self-built search engine. It crawls the web politely, stores and indexes documents at scale (2M+), answers queries using hybrid keyword and semantic retrieval with re-ranking, and includes an LLM-driven browser agent that can handle JavaScript-rendered pages that plain HTTP crawling cannot.

### 1.2 Goals

- Build a distributed, polite, fault-tolerant crawler.
- Store 2M+ documents in MongoDB with schemas and indexes that keep indexed query latency under 5 ms at p95.
- Provide hybrid search (keyword plus vector) fused with Reciprocal Rank Fusion and optionally re-ranked, with measurable relevance gains over keyword-only.
- Build a Playwright plus LLM agent that extracts structured data from JS-heavy pages with a measured success rate on a fixed benchmark.
- Make every claim **reproducible**: one command to run the benchmarks, results committed to the repo.

### 1.3 Non-goals

- Competing with Google. No PageRank at web scale, no multi-region deployment.
- User accounts, billing, or ads.
- Crawling sites that disallow it, or anything behind logins.

### 1.4 What will make this stand out

Most student search projects are a crawler plus a text index. Sift differentiates by having:

1. **Honest, reproducible evaluation**: a labelled query set with nDCG@10 and MRR for keyword-only vs vector-only vs hybrid vs hybrid+rerank. A chart in the README.
2. **Real failure handling**: retries with backoff, a dead-letter queue, per-domain rate limiting, and a replay tool for the DLQ.
3. **A benchmarking harness** for ingest throughput and query latency (p50/p95/p99) at 100k, 1M, and 2M docs.
4. **An agent eval harness**: 100 tasks across a mix of sites, with logged traces and failure categories (not just one headline number).
5. **Observability**: Prometheus metrics and a Grafana dashboard screenshot (crawl rate, queue depth, error rate, latency).
6. **A polished demo**: a small search UI plus a 90-second screen recording.

---

## 2. Important notes on the resume claims

The resume bullets are ambitious. Make sure each is **true and defensible** in an interview:

- **"2M+ documents"**: crawling 2M live pages from scratch is slow and risky. Plan: seed corpus from public datasets (Wikipedia dump, a Common Crawl segment, StackExchange dumps, Hacker News archive) via an *importer* that feeds the same ingestion pipeline, plus the live crawler for fresh domains. Document this honestly: "2M docs ingested (X live-crawled, Y from public dumps)."
- **"p95 query latency under 5 ms"**: this is only realistic for **indexed MongoDB queries** (point lookups by `urlHash`, filtered and sorted queries on compound indexes, keyword lookups), measured server-side. Full hybrid search with embedding plus vector search plus fusion will typically be 50 to 300 ms. Define in the README exactly *which* queries hit the 5 ms number and report end-to-end latency separately.
- **"improved relevance on a query test set"**: needs a labelled test set (Phase 6). Report actual deltas.
- **"79% success on sites"**: needs a fixed task benchmark (Phase 6). Report N tasks, M sites, and success definition. If you measure 71% or 84%, put that number in.

---

## 3. System architecture

```
            +---------------+
  seeds --> |  Frontier     |  (Redis: BullMQ queues + domain state)
            +-------+-------+
                    |
          +---------v----------+      robots.txt cache (Redis)
          |  Fetch Workers     | <--- per-domain rate limiter (Redis)
          |  (undici, retries) |
          +----+----------+----+
               |          |
        needs JS?       static HTML
               |          |
     +---------v--+   +---v-----------+
     | Render     |   | Parse/Extract |  (readability, cheerio)
     | Workers    |   | links, text   |
     | (Playwright)|  +---+-----------+
     +------+-----+       |
            +------+------+
                   |  new links -> dedupe -> Frontier
            +------v-------+
            | Ingest Queue |  (bulk writer, batches of 500-1000)
            +------+-------+
                   |
       +-----------v-----------+
       | MongoDB (documents)   |
       +-----------+-----------+
                   |  change stream / embed queue
            +------v-------+     +-----------+
            | Embed Worker | --> |  Qdrant   |
            +--------------+     +-----------+

   Search API (Fastify) --> Mongo text/keyword + Qdrant vector --> RRF --> rerank --> results
   Browser Agent (Playwright + LLM tool loop) --> structured JSON extraction
```

### Key design decisions

| Decision | Choice | Reason |
| --- | --- | --- |
| Queue | **BullMQ on Redis** | Retries, backoff, delayed jobs, rate limiting, and DLQ patterns are built in and well documented. |
| Frontier politeness | Per-domain token bucket in Redis plus `Crawl-delay` from robots.txt | Avoids hammering hosts. |
| URL dedupe | Normalize URL, SHA-1/xxhash the result, check a Redis Bloom filter first (fast), confirm via unique index in Mongo (correct) | Fast path plus correctness. |
| Content dedupe | SimHash of body text, store the hash, near-duplicates flagged | Avoids indexing mirrors and boilerplate pages. |
| Document store | MongoDB | Flexible schema, bulk writes, mature indexing. |
| Keyword search | MongoDB text index to start. **Stretch goal:** custom BM25 inverted index in Mongo or Redis | MongoDB's text search is TF-IDF-like, not true BM25. The stretch makes the project memorable. |
| Vector store | **Qdrant** (Docker) | Fast HNSW, payload filtering, and sparse vector support. |
| Fusion | Reciprocal Rank Fusion (k=60) | Simple, robust, no score calibration needed. |
| Re-ranking | Cross-encoder (e.g. a BGE reranker via a local model or API) or an LLM re-rank of the top 30 | Measurable semantic uplift. |
| Embeddings | Gemini embedding model (has a free tier) as default, OpenAI `text-embedding-3-small` as an alternative, behind a provider interface. **Verify current model names in the provider docs before coding.** | Provider-agnostic, with batching and caching. |
| API | Fastify plus Zod validation | Fast, typed, simple. |
| Observability | `pino` logs, `prom-client` metrics, Grafana in Docker | Production-grade signal. |

---

## 4. Tech stack and what to install

### 4.1 On your machine

- **Node.js 22 LTS** (use `nvm` or `fnm`)
- **pnpm** (`npm i -g pnpm`)
- **Docker Desktop** (for MongoDB, Redis, Qdrant, Prometheus, Grafana)
- **Git**
- **MongoDB Compass** (GUI to inspect data and explain plans)
- **k6 or autocannon** (HTTP load testing)
- **VS Code or Antigravity**

### 4.2 Accounts and keys

- Gemini API key (Google AI Studio) and/or OpenAI API key
- Optional: a cheap VPS (Hetzner, Oracle free tier) for a long-running crawl. Your laptop is fine for development.

### 4.3 npm packages

| Purpose | Packages |
| --- | --- |
| Language/tooling | `typescript`, `tsx`, `tsup`, `eslint`, `prettier`, `vitest`, `dotenv`, `zod` |
| HTTP fetch | `undici` |
| Queue | `bullmq`, `ioredis` |
| Parsing | `cheerio`, `@mozilla/readability`, `jsdom`, `robots-parser`, `normalize-url`, `tldts` |
| Hashing | `xxhash-wasm` (or Node `crypto`), a SimHash lib or a small custom implementation |
| DB | `mongodb` (official driver; avoid Mongoose for bulk performance) |
| Vector | `@qdrant/js-client-rest` |
| Embeddings | `@google/genai`, `openai` |
| Browser | `playwright` (run `npx playwright install chromium`) |
| API | `fastify`, `@fastify/cors`, `@fastify/rate-limit` |
| Observability | `pino`, `prom-client` |
| Misc | `p-limit`, `p-retry`, `commander` (CLI), `zx` optional |

### 4.4 Docker Compose services

MongoDB 7, Redis 7 (with the RedisBloom module via `redis/redis-stack`), Qdrant, Prometheus, Grafana.

---

## 5. Repository structure (pnpm monorepo)

```
sift/
  apps/
    crawler/        # fetch workers, frontier, scheduler
    indexer/        # embed worker, index maintenance
    api/            # Fastify search API
    agent/          # Playwright + LLM browser agent
    web/            # minimal search UI (Vite + React or plain HTML)
  packages/
    core/           # shared types, config (zod), logger, metrics
    db/             # mongo client, schemas, repositories, index definitions
    queue/          # BullMQ setup, job types, DLQ helpers
    embeddings/     # provider interface, Gemini/OpenAI impls, cache
    search/         # keyword, vector, RRF, rerank
  bench/            # ingest + query benchmarks
  eval/             # relevance eval + agent eval harnesses
  data/             # seeds, query sets, task sets (gitignored if large)
  infra/            # docker-compose.yml, prometheus.yml, grafana dashboards
  docs/             # architecture, diagrams, decision log
```

---

## 6. Data model

### 6.1 `documents` collection

```ts
{
  _id: ObjectId,
  urlHash: string,          // xxhash64 of normalized URL (unique)
  url: string,
  canonicalUrl?: string,
  domain: string,           // registrable domain
  title: string,
  text: string,             // cleaned main content
  textLength: number,
  headings: string[],
  lang: string,
  contentHash: string,      // SimHash for near-dup detection
  outlinks: number,         // count; full link graph in separate collection
  fetchedAt: Date,
  httpStatus: number,
  renderMode: 'static' | 'rendered' | 'agent',
  source: 'crawl' | 'wikipedia' | 'commoncrawl' | 'other',
  embedding: { model: string, version: number, qdrantId: string, embeddedAt: Date } | null,
  schemaVersion: 1
}
```

### 6.2 Other collections

- `frontier_state`: per-domain stats (lastFetch, crawlDelay, robots hash, error rate).
- `links` (optional): `{ fromHash, toHash }` for link graph and a simple PageRank stretch goal.
- `dlq_jobs`: failed jobs with error, attempts, and payload, for replay.
- `agent_runs`: task, steps, final JSON, success flag, cost, duration.
- `eval_runs`: results of relevance and agent evaluations.

### 6.3 Indexes (define in code, version them)

- `{ urlHash: 1 }` **unique**
- `{ domain: 1, fetchedAt: -1 }` (compound: per-domain recency)
- `{ contentHash: 1 }`
- `{ 'embedding.qdrantId': 1 }` sparse
- `{ embedding: 1, _id: 1 }` partial index for "not yet embedded" scan
- Text index on `title` (weight 10), `headings` (weight 5), `text` (weight 1)

Use `.explain('executionStats')` on each hot query and save the output in `docs/query-plans.md`. This is your evidence for the latency claim.

### 6.4 Qdrant collection

- Vector size depends on the embedding model (e.g. 768 or 1536); store it in config.
- Distance: cosine. HNSW `m=16`, `ef_construct=128`.
- Payload: `{ mongoId, domain, lang, fetchedAt, title }`, with payload indexes on `domain` and `lang`.
- Embed **chunks**, not whole pages: \~300 to 500 tokens with 50-token overlap, plus the title prepended to each chunk. Payload stores `chunkIndex`. At query time, group by document.

---

## 7. Phased implementation plan

Suggested timeline: **6 to 8 weeks part-time**. Each phase lists tasks, deliverables, and acceptance criteria.

### Phase 0: Foundations (2 to 3 days)

**Tasks**

- Initialize the pnpm monorepo, TypeScript strict mode, ESLint, Prettier, Vitest, and path aliases.
- Write `infra/docker-compose.yml` for Mongo, Redis Stack, Qdrant, Prometheus, and Grafana.
- `packages/core`: typed config loader (zod over env vars), pino logger, metrics registry.
- `packages/db`: Mongo connection, repository pattern, index creation script (`pnpm db:migrate`).
- GitHub repo with CI (lint, typecheck, test).

**Acceptance criteria**

- `docker compose up -d` starts all services; `pnpm db:migrate` creates all indexes.
- `pnpm test` and `pnpm typecheck` pass in CI.
- A health-check script confirms connectivity to Mongo, Redis, and Qdrant.

### Phase 1: Crawler core (1 to 1.5 weeks)

**Tasks**

1. **URL normalization and dedupe**: lowercase host, strip fragments and tracking params (utm\_\*, fbclid), sort query params, resolve relative links, handle trailing slashes. Dedupe via Bloom filter first, Mongo unique index second.
2. **robots.txt**: fetch once per domain, cache in Redis (24h TTL), parse with `robots-parser`, honour `Disallow` and `Crawl-delay` for the `SiftBot` user-agent. On robots fetch failure (5xx), back off; on 404, allow.
3. **Politeness**: per-domain token bucket (default 1 request/second, overridden by Crawl-delay), plus a global concurrency cap. Descriptive User-Agent with a contact URL, e.g. `SiftBot/1.0 (+https://github.com/<you>/sift)`.
4. **Fetcher**: `undici` with timeouts (connect 5s, total 15s), max body size (2 MB), redirect limit (5), content-type filter (HTML only), gzip/br support.
5. **Queue design (BullMQ)**:
   - Queues: `fetch`, `parse`, `ingest`, `embed`, `dlq`.
   - Retries: 3 attempts, exponential backoff (2s, 8s, 30s) for network errors and 5xx. No retry for 4xx (except 429, which honours `Retry-After`).
   - After final failure: move to the DLQ with an error classification (`dns`, `timeout`, `blocked`, `parse`, `too_large`, `other`).
   - `pnpm dlq:replay --class=timeout` re-enqueues failed jobs.
6. **Parser/extractor**: `@mozilla/readability` for main text, `cheerio` for title, headings, language, canonical link, and outlinks. Compute SimHash.
7. **Frontier prioritization**: score = domain-depth penalty plus freshness need. Start with BFS plus per-domain caps (e.g. max 50k pages per domain) to avoid spider traps. Detect traps via URL length, repeating path segments, and calendar-style URLs.
8. **Graceful shutdown and resumability**: the crawl can be killed and resumed without losing or duplicating work.

**Acceptance criteria**

- Crawl 10k pages from 20 seed domains with 0 robots violations (verified by an audit script that re-checks every fetched URL against the cached robots).
- Killing a worker mid-run loses no jobs.
- DLQ contains classified failures; replay works.
- Unit tests for normalization, robots handling, and backoff logic.

### Phase 2: Storage and bulk ingestion (1 week)

**Tasks**

- Ingest worker consumes parsed docs and writes in **batches of 500 to 1000** using `bulkWrite` with `ordered: false` and `upsert` keyed on `urlHash`.
- Flush by size or time (whichever comes first, e.g. 1000 docs or 2s).
- **Importers** for bulk datasets (Wikipedia dump, Common Crawl WET segment or other public corpora). They stream, parse, and push into the same ingest queue. Never load a whole dump in memory.
- Backpressure: pause upstream when the ingest queue exceeds a threshold.
- Compression: enable `zstd` or `snappy` on the collection. Consider truncating stored text to a max length (e.g. 50k chars).
- Write `bench/ingest.ts`: reports docs/sec at 100k, 500k, 1M, and 2M documents.
- Write `bench/query.ts`: runs the hot queries (point lookup by `urlHash`, domain plus recency, "next batch to embed") for 10k iterations and reports p50/p95/p99 plus `explain` plans.

**Acceptance criteria**

- 2M+ documents in the collection (mix of crawled and imported, labelled via `source`).
- p95 of indexed queries is below 5 ms, measured with the documented method (warm cache, local Mongo, N iterations). If it isn't, tune indexes and projections until it is, or report the real number.
- All queries in the benchmark use IXSCAN (no COLLSCAN) per saved explain output.

### Phase 3: Chunking, embeddings, and Qdrant indexing (1 week)

**Tasks**

- `packages/embeddings`: `EmbeddingProvider` interface (`embed(texts: string[]): Promise<number[][]>`) with Gemini and OpenAI implementations. Add batching, rate-limit handling with retries, and a content-hash cache to avoid re-embedding.
- Chunker: split on paragraph and sentence boundaries to \~400 tokens with overlap.
- Embed worker: pulls un-embedded docs, embeds chunks, upserts to Qdrant in batches, and marks Mongo `embedding` metadata. Idempotent, so rerunning is safe.
- **Cost control**: embedding 2M full documents via paid APIs is expensive. Strategy: embed the **title plus first \~2 chunks** for all documents, and all chunks for a high-value subset (e.g. 200k docs). Alternatively use a free local model (e.g. a BGE-small or MiniLM model via `transformers.js` or Ollama) for bulk, and compare quality against the API model on the eval set. Record the cost and throughput in the README.
- Model-versioning: store model name and version per vector so re-embedding is possible.

**Acceptance criteria**

- Embedding pipeline processes at least the agreed subset, with restart safety.
- Qdrant returns top-10 for a sample query in under 50 ms.
- Cost and throughput numbers are documented.

### Phase 4: Hybrid search API (1 to 1.5 weeks)

**Tasks**

1. `GET /search?q=&limit=&domain=&lang=` (Fastify plus Zod).
2. **Keyword leg**: Mongo text search (title and headings weighted), top 100. Stretch: custom BM25.
3. **Vector leg**: embed the query (cache popular queries in Redis), Qdrant top 100 chunks, group by document.
4. Run both legs in parallel (`Promise.all`) with per-leg timeouts. If one fails, degrade gracefully to the other.
5. **Fusion**: Reciprocal Rank Fusion, `score = sum(1 / (60 + rank_i))`.
6. **Semantic re-ranking**: take the top 30 and re-score with a cross-encoder (or an LLM scoring prompt with strict JSON output). Make it toggleable with `rerank=true`.
7. Result snippets: highlight the best-matching passage (the top chunk) with query-term highlighting.
8. Query understanding (stretch): spelling correction, simple query expansion.
9. `GET /metrics` (Prometheus) with latency histograms per stage (embed, keyword, vector, fusion, rerank).
10. Redis result caching with short TTL. Rate limiting per IP.

**Acceptance criteria**

- End-to-end p50 and p95 latency reported for keyword-only, vector-only, hybrid, and hybrid+rerank.
- The system degrades gracefully when Qdrant or the embedding API is down.
- Integration tests for each search mode.

### Phase 5: Playwright LLM browser agent (1.5 weeks)

**Purpose**: handle pages that need JS rendering, scrolling, clicking "load more", cookie banners, or pagination, and extract **structured data** (e.g. product name and price, article metadata, job listings) into a given JSON schema.

**Design**

- Input: `{ url, goal: string, schema: JSONSchema }`.
- Loop (max \~15 steps): observe, decide, act, then repeat.
  - **Observation**: not raw HTML (too large). Use Playwright's accessibility snapshot or a pruned DOM listing of interactive elements, each with a stable numeric ID, plus visible text and the page URL.
  - **Action tools** exposed to the LLM via function calling: `click(id)`, `type(id, text)`, `scroll(direction)`, `wait_for(selector|ms)`, `go_back()`, `extract(json)`, `finish(reason)`.
  - **Extraction**: the LLM returns JSON that is validated against the schema with Zod/Ajv. On validation failure, feed the errors back and retry (max 2).
- **Safety**: domain allowlist per run, no form submission with credentials, no downloads, step and token budget, and a hard timeout. Respect robots.txt for navigation targets too.
- **Resilience**: auto-dismiss cookie banners (heuristics), stealth is **not** required (do not circumvent bot protection), wait on network idle with a cap, retry on navigation failure.
- **Hybrid with the crawler**: the crawler first fetches statically. If the extracted text is below a threshold or the page contains an SPA marker (empty root div, `noscript` warnings), re-route to a `render` queue (plain Playwright render, no LLM). Use the LLM agent only for interactive or structured-extraction tasks. Record `renderMode` on the document.
- **Tracing**: save each run (screenshots per step, actions, LLM messages, tokens, cost) to `agent_runs`. Build a tiny trace viewer page. This is a great demo asset.
- **Model choice**: a fast, cheap model with strong function calling (a Gemini Flash-class or GPT mini-class model). Make the provider swappable.

**Acceptance criteria**

- Agent completes tasks on at least 10 different JS-rendered sites in manual tests.
- Every run has a viewable trace.
- Budget guards verifiably stop runaway runs.

### Phase 6: Evaluation and benchmarks (1 week). This phase is the real differentiator

**6.1 Relevance evaluation**

- Build a query set of **100 to 200 queries** over your own corpus. Mix of navigational, informational, long natural-language, and misspelled queries.
- Labelling: for each query, pool the top 20 results from all four systems, then judge relevance on a 0 to 3 scale. Bootstrap labels with an LLM judge, then **manually spot-check at least 20%** and report the agreement.
- Metrics: nDCG@10, MRR, Recall@50.
- Compare: keyword-only, vector-only, hybrid (RRF), hybrid+rerank. Produce a table and a bar chart for the README.
- Optional ablations: RRF `k` values, chunk size, title-prepending, embedding model comparison.

**6.2 Agent evaluation**

- Build **100 tasks across 20+ sites**, each with `{ url, goal, schema, ground_truth }` and a scoring function (exact or fuzzy match per field; a task is successful only if all required fields match).
- Run with fixed random seeds and temperature 0 where possible, and run at least 3 times to report variance.
- Report: success rate, average steps, average cost per task, latency, and a **failure taxonomy** (navigation failure, wrong element, schema mismatch, timeout, blocked, hallucinated data).
- Save snapshots of target pages (HAR or HTML) for a deterministic subset, so results are reproducible even when sites change.

**6.3 System benchmarks**

- Ingest throughput curve, query latency percentiles, memory footprint, and crawl rate (pages/min) under different concurrency settings.

**Acceptance criteria**

- `pnpm eval:relevance`, `pnpm eval:agent`, and `pnpm bench` each run end-to-end and write JSON and Markdown reports to `/eval/results`.
- README numbers match the committed reports exactly.

### Phase 7: UI, observability, and polish (1 week)

- **Search UI** (Vite plus React or minimal HTML): search box, result cards with highlighted snippets, a toggle for keyword, semantic, hybrid and rerank modes, a latency breakdown per stage, and a side-by-side compare view showing ranking differences. The compare view is a strong demo moment.
- **Admin page**: crawl stats, queue depth, DLQ browser with replay, and an agent trace viewer.
- **Grafana dashboard**: crawl rate, queue depth, error classes, ingest rate, and search latency. Commit the dashboard JSON and a screenshot.
- **Docs**: architecture diagram, ADRs (decision log) for the major choices, `docs/query-plans.md`, and a "what I'd do next" section.
- **Deployment**: a one-command `docker compose up` demo. Optionally deploy the API and UI (Fly.io, Railway, or a VPS) with a small public index (e.g. 100k docs) and rate limiting.
- **Demo video**: 60 to 90 seconds, covering crawl, search compare, and agent trace.

**Acceptance criteria**

- A new person can clone the repo, run three commands, and see a working search UI over a sample dataset.

---

## 8. Functional requirements summary

| ID | Requirement | Phase |
| --- | --- | --- |
| FR-1 | Crawler honours robots.txt and Crawl-delay | 1 |
| FR-2 | URL normalization and dedupe (Bloom plus unique index) | 1 |
| FR-3 | Queue-based workers with retry, backoff, and DLQ | 1 |
| FR-4 | Bulk ingestion with upsert and backpressure | 2 |
| FR-5 | 2M+ documents stored with documented provenance | 2 |
| FR-6 | Chunking and embeddings with a provider abstraction | 3 |
| FR-7 | Vector index in Qdrant with payload filters | 3 |
| FR-8 | Hybrid search with RRF fusion | 4 |
| FR-9 | Semantic re-ranking (toggleable) | 4 |
| FR-10 | Playwright LLM agent with schema-validated extraction | 5 |
| FR-11 | Reproducible evals and benchmarks | 6 |
| FR-12 | Search UI, admin, and dashboards | 7 |

## 9. Non-functional requirements

- **Performance**: indexed Mongo queries p95 under 5 ms (documented method); hybrid search p95 target under 400 ms without rerank.
- **Reliability**: no job loss on worker crash; idempotent writes everywhere.
- **Politeness and ethics**: honour robots.txt, rate limit per domain, honest User-Agent, no login-gated content, no PII harvesting, and a documented takedown contact.
- **Security**: secrets in env only, input validation on the API, SSRF protection (block private IP ranges in fetchers and the agent), and rate limiting.
- **Testability**: unit tests for logic, integration tests with Testcontainers or Docker, and fixtures for HTTP.
- **Observability**: structured logs with correlation IDs, and metrics for every stage.

## 10. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Crawling 2M pages live takes too long or gets blocked | Use public dumps plus the live crawler; document the split honestly. |
| Embedding cost for 2M docs | Embed a subset, use a local model for bulk, cache by content hash. |
| Mongo text search relevance is weak | Weight fields, add the vector leg, stretch to custom BM25. |
| Agent success rate is lower than hoped | Improve observation pruning, add retries, and report the real number with a failure taxonomy. |
| Websites change and break the agent eval | Snapshot pages (HAR) for a deterministic subset. |
| Spider traps and infinite URL spaces | Per-domain caps, URL pattern heuristics, and a max depth. |
| Legal and ethical concerns | Respect robots and ToS, avoid personal data, keep the public demo small, and provide a contact. |
| Scope creep | Phases are gated; stretch goals only after Phase 6 passes. |

## 11. Stretch goals (only after Phase 6)

- Custom BM25 inverted index with Redis or Mongo postings lists.
- PageRank or link-based authority score as a ranking feature.
- Learning-to-rank with simple features (BM25, vector score, domain authority, freshness).
- Query autocomplete from query logs.
- Qdrant sparse vectors (SPLADE-style) for a learned-sparse leg.
- Incremental recrawl scheduler based on page change rate.
- Multi-node crawl workers on several machines.
- RAG answer mode: summarize the top results with citations.

## 12. Definition of done

- All phases 0 to 7 acceptance criteria met.
- README includes: architecture diagram, setup in 3 commands, benchmark tables, relevance chart, agent failure taxonomy, and a screenshot or GIF of the UI.
- Every resume number traces to a committed report file.

## 13. Suggested resume bullets (after you have real numbers)

Fill in the blanks only with measured values:

- Built a distributed crawler (BullMQ/Redis) with robots.txt compliance, per-domain rate limiting, Bloom-filter dedupe, and retry/DLQ handling; sustained **\[X\] pages/min**.
- Designed MongoDB schemas and compound indexes with bulk-write ingestion for **\[N\] documents**; indexed queries at **p95 \[Y\] ms** (explain-verified).
- Implemented hybrid search (Mongo keyword + Qdrant vectors, RRF fusion, cross-encoder re-rank), improving **nDCG@10 from \[A\] to \[B\]** on a \[Q\]-query labelled set.
- Built a Playwright LLM agent with schema-validated extraction, achieving **\[Z\]% success on \[T\] tasks across \[S\] sites**, with trace logging and a failure taxonomy.

## 14. Open questions for the owner (please answer before or during Phase 0)

1. **Hardware and budget**: laptop specs (RAM, free disk)? Is there any budget for APIs or a small VPS? This decides local vs paid embeddings and how big the crawl can be.
2. **Corpus focus**: general web, or a themed vertical (e.g. tech docs, news, research papers, Indian startups)? A focused corpus makes relevance evaluation much easier and the demo sharper.
3. **Primary LLM provider**: Gemini, OpenAI, or both? Any free credits available?
4. **Agent use cases**: which structured extraction tasks matter most (products and prices, job listings, article metadata, docs)? This drives the 100-task benchmark.
5. **Timeline**: is there an interview or application deadline? We can trim stretch goals or compress phases.
6. **Hosting**: do you want a public live demo, or is a local `docker compose` demo enough?
7. **Frontend**: should the UI be minimal, or a polished showcase piece?
8. **Resume numbers**: are the figures in your bullets (2M+, 5 ms, 79%) already achieved elsewhere, or targets? The plan above treats them as targets to be **measured**.

---

## 15. Appendix: first prompts to give the agent

**Phase 0 prompt**

> Read the PRD sections 3 to 6 and Phase 0. Initialize the monorepo exactly as specified, create the Docker Compose file, implement `packages/core` and `packages/db` with the index definitions from Section 6.3, add CI, and write a health-check script. Do not begin Phase 1. Stop and summarize what you built, what you assumed, and any open questions.

**Generic phase prompt**

> Implement Phase N from the PRD. Follow the tasks in order. Write tests alongside code. When done, run every acceptance criterion, paste the evidence (commands and output), update the README, commit with the tag `phase-N-done`, and stop. List any deviations from the PRD and why.
