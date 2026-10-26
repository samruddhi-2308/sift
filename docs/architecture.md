# Sift System Architecture

Sift is a production-grade, distributed web crawler, hybrid search engine, and autonomous browser agent platform engineered for low latency, high throughput, and robust fault tolerance.

---

## 1. High-Level System Topology

```mermaid
graph TB
    subgraph ClientLayer ["Clients & Observability"]
        UI["Web UI (React 18 + Vite)"]
        CLI["Sift CLI (Commander)"]
        Prom["Prometheus :9090"]
        Graf["Grafana :3002"]
    end

    subgraph APILayer ["Fastify Gateway (:3001)"]
        SearchRoute["/search & /search/compare"]
        AdminRoute["/admin/stats & /admin/queues"]
        DLQRoute["/admin/dlq & /admin/dlq/replay"]
        TraceRoute["/admin/traces"]
    end

    subgraph PipelineWorkers ["Distributed BullMQ Workers"]
        W_Fetch["Fetch Worker"]
        W_Parse["Parse Worker"]
        W_Ingest["Ingest Worker"]
        W_Embed["Embed Worker"]
        W_Render["Playwright Worker"]
    end

    subgraph AgentCore ["Autonomous Browser Agent"]
        DOMObserver["DOM Observer (Pruning & IDs)"]
        LLMPlanner["Planner (Gemini 2.5 / Flash)"]
        Guardrails["Security Sandbox & Token Guard"]
        BrowserInst["Playwright Chromium"]
    end

    subgraph StorageLayer ["Storage & Vector Indices"]
        Redis["Redis Stack 7.2 (Queues + Bloom Filters + Rate Limits)"]
        Mongo["MongoDB 7.0 WiredTiger (Documents + DLQ + Traces)"]
        Qdrant["Qdrant 1.9 (HNSW Vector Index 768d)"]
    end

    UI --> APILayer
    CLI --> PipelineWorkers
    CLI --> AgentCore
    APILayer --> StorageLayer
    PipelineWorkers --> StorageLayer
    PipelineWorkers --> Redis
    AgentCore --> Mongo
    Prom --> APILayer
    Graf --> Prom
```

---

## 2. Distributed Crawl & Ingestion Pipeline

The crawl pipeline follows a decoupled, asynchronous queue architecture coordinated by BullMQ over Redis:

```mermaid
sequenceDiagram
    autonumber
    participant Seed as Seed / Scheduler
    participant Q_Fetch as sift-fetch Queue
    participant W_Fetch as Fetch Worker
    participant Redis as Redis (Bloom + Politeness)
    participant Q_Parse as sift-parse Queue
    participant W_Parse as Parse Worker
    participant Q_Ingest as sift-ingest Queue
    participant W_Ingest as Ingest Worker
    participant Mongo as MongoDB
    participant Q_Embed as sift-embed Queue
    participant W_Embed as Embed Worker
    participant Qdrant as Qdrant Vector DB

    Seed->>Q_Fetch: Enqueue Seed URL
    Q_Fetch->>W_Fetch: Pop job (FetchJobPayload)
    W_Fetch->>Redis: Check Bloom Filter (seen?) & Crawl Delay
    alt URL not seen & politeness ok
        W_Fetch->>W_Fetch: HTTP GET (Stream with 10MB limit & timeout)
        W_Fetch->>Redis: Mark Bloom Filter seen
        W_Fetch->>Q_Parse: Enqueue raw HTML payload
    else Seen or Blocked
        W_Fetch-->>Q_Fetch: Drop / Delay
    end

    Q_Parse->>W_Parse: Pop raw HTML
    W_Parse->>W_Parse: Cheerio DOM sanitization, boilerplate removal, link extraction
    W_Parse->>Q_Fetch: Enqueue discovered outlinks (depth + 1)
    W_Parse->>Q_Ingest: Enqueue cleaned DocumentPayload

    Q_Ingest->>W_Ingest: Pop DocumentPayload
    W_Ingest->>W_Ingest: Deduplication & MinHash LSH check
    W_Ingest->>Mongo: Upsert Document (Compound IXSCAN indexed)
    W_Ingest->>Q_Embed: Enqueue Document ID for embedding

    Q_Embed->>W_Embed: Pop Document ID
    W_Embed->>W_Embed: Chunk text (Recursive Token Splitter 512 tokens / 64 overlap)
    W_Embed->>W_Embed: Dense Embedding (BGE-base-en 768-dim)
    W_Embed->>Qdrant: Upsert vectors with payload metadata
    W_Embed->>Mongo: Mark document embedded: true
```

---

## 3. Hybrid Search & Multi-Stage Retrieval Architecture

Sift's search service executes parallel lexical and semantic retrievals, combines them via Reciprocal Rank Fusion (RRF), and selectively applies Cross-Encoder re-ranking:

```mermaid
graph TD
    Query["Incoming Search Query (q, mode, limit)"] --> Dispatcher["Parallel Engine Dispatcher"]

    Dispatcher -->|"BM25 Lexical"| MongoQuery["MongoDB Text & Compound B-Tree Index"]
    Dispatcher -->|"Query Vector"| EmbeddingGen["Embedding Service (BGE-base-en)"]
    EmbeddingGen --> QdrantQuery["Qdrant HNSW Cosine Search"]

    MongoQuery -->|"Top 50 Lexical Candidates"| RRF["Reciprocal Rank Fusion (k=60)"]
    QdrantQuery -->|"Top 50 Dense Candidates"| RRF

    RRF -->|"Fused Ranked Top K"| Gate{"Reranker Requested?"}
    Gate -->|"Yes (mode=hybrid_rerank)"| CrossEncoder["BGE Cross-Encoder Model"]
    Gate -->|"No (mode=hybrid)"| FinalOutput["Output Formatter & Snippet Generator"]

    CrossEncoder -->|"Re-scored Top N"| FinalOutput
    FinalOutput --> Response["HTTP JSON Response with Stage Latency Breakdown"]
```

---

## 4. Autonomous Browser Agent Architecture

The browser agent operates in a closed observation-action loop equipped with defense-in-depth safety controls:

```mermaid
graph TD
    Goal["Task Goal + JSON Schema"] --> LoopStart["Start Agent Loop (Step <= 15)"]
    LoopStart --> DomObserve["DOM Observer: Inject data-sift-id & Prune Trees"]
    DomObserve --> SandboxCheck{"Guardrail Validation"}

    SandboxCheck -->|"Violates SSRF / Private IP / Restricted Domain"| Terminate["Abort Task & Return Error"]
    SandboxCheck -->|"Passes Safety Checks"| PromptBuild["Construct LLM Prompt (Goal + Observation + Schema)"]

    PromptBuild --> Gemini["Gemini 2.5 Flash Planner"]
    Gemini --> ActionParse["Parse Tool Call / Structured Action JSON"]

    ActionParse --> ValidateSchema{"Schema Extraction or Action?"}
    ValidateSchema -->|"Action (CLICK, TYPE, SCROLL, NAVIGATE)"| ExecutePlaywright["Playwright Action Dispatcher"]
    ValidateSchema -->|"Finish / Extract"| ValidateJSON{"Validates against Zod schema?"}

    ValidateJSON -->|"Valid"| PersistTrace["Save Run Trace & Screenshots to MongoDB"]
    ValidateJSON -->|"Invalid"| RetryFeedback["Feed Validation Errors back to LLM Prompt (Max 3 retries)"]

    RetryFeedback --> Gemini
    ExecutePlaywright --> CheckBudget{"Step / Token / Cost Budget exceeded?"}
    CheckBudget -->|"Within Budget"| DomObserve
    CheckBudget -->|"Exceeded"| PersistTrace
```

---

## 5. Fault Tolerance & Dead Letter Queue (DLQ) Architecture

Every job is subject to categorized retry policies and DLQ archiving:

| Error Classification | Max Retries | Backoff Strategy | DLQ Action |
|---|---|---|---|
| `HTTP_STATUS_429` | 5 | Exponential with Jitter | Move to DLQ with Retry-After timestamp |
| `HTTP_STATUS_5XX` | 3 | Exponential backoff (1s, 2s, 4s) | Move to DLQ after attempt 3 |
| `TIMEOUT` | 3 | Linear backoff | Move to DLQ |
| `PARSER_FAILURE` | 1 | None | Immediately moved to DLQ |
| `DNS_NXDOMAIN` | 0 | None (unrecoverable) | Dropped / Logged |
| `SSRF_ATTEMPT` | 0 | None (security violation) | Blocked immediately and reported |

Operators can inspect error stacks, filter by classification, and replay failed jobs with one click via `POST /admin/dlq/replay` or the Web UI.
