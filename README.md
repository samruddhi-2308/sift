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
| **Phase 1** | Crawler Core (robots.txt, token bucket rate limiter, Bloom dedupe, DLQ) | 🔄 Next |
| **Phase 2** | Storage & Bulk Ingestion (batches 500-1000, streaming WET/dump importers) | ⏳ Queued |
| **Phase 3** | Chunking, Embeddings & Qdrant Indexing (HNSW, title-prepending) | ⏳ Queued |
| **Phase 4** | Hybrid Search API (Mongo keyword + Qdrant vector + RRF + Re-ranking) | ⏳ Queued |
| **Phase 5** | Playwright Browser Agent (a11y tree, Observe-Decide-Act, schema extraction) | ⏳ Queued |
| **Phase 6** | Evals & Benchmarks (nDCG@10, MRR, 100-task agent eval, p95 latencies) | ⏳ Queued |
| **Phase 7** | Modern Search UI, A/B Retrieval Inspector & Observability | ⏳ Queued |

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

# Run unit tests
pnpm test

# Typecheck
pnpm typecheck
```
