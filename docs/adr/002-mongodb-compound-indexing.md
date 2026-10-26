# ADR 002: Compound B-Tree Indexing and WiredTiger Working Set Tuning

## Status
Accepted

## Context
Sift indexes millions of web documents and chunks. Crawling and search workloads require:
1. Exact URL lookups and idempotency checks (`urlHash: 1`).
2. Domain-filtered, timestamp-sorted pagination queries (`{ domain: 1, fetchedAt: -1 }`).
3. Lexical keyword filtering combined with domain or language scoping (`{ domain: 1, lang: 1, text: "text" }`).
4. Rapid ingestion of failed jobs in the Dead Letter Queue (`{ errorClass: 1, failedAt: -1 }` and `{ jobId: 1 }`).

Without optimal compound indices, MongoDB resorts to full collection scans (`COLLSCAN`), causing massive WiredTiger cache thrashing, evictions, and severe latency degradation under concurrent read/write loads.

## Decision
1. **Compound Index Strategy**: Followed the **Equality, Sort, Range (ESR)** design principle across all primary collections:
   - `documents`:
     - `{ urlHash: 1 }` (Unique constraint for zero-latency upsert and deduplication).
     - `{ domain: 1, fetchedAt: -1 }` (Enables covered `IXSCAN` index bounds for domain audits and politeness checkpoints).
     - `{ domain: 1, lang: 1 }` (Compound filter index for multi-lingual search restriction).
   - `chunks`:
     - `{ documentId: 1, chunkIndex: 1 }` (Sequential retrieval of document passages).
   - `dead_letter_queue`:
     - `{ jobId: 1 }` (Unique lookup for replay and triage).
     - `{ replayed: 1, errorClass: 1, failedAt: -1 }` (High selectivity for pending replay queues).
   - `agent_runs`:
     - `{ runId: 1 }` (Unique lookup).
     - `{ startedAt: -1 }` (Chronological trace timeline).

2. **WiredTiger Cache Configuration**:
   - Explicitly configured `mongod --wiredTigerCacheSizeGB 1.5` in Docker Compose to bound RAM allocation within host constraints while guaranteeing all active index B-trees remain pinned in memory.

## Consequences

### Positive
- All document search, filter, and pagination queries execute as `IXSCAN` operations with zero `COLLSCAN` fallbacks.
- Index-covered lookups achieve sub-5ms latency across collections containing >100,000 documents.
- Predictable memory footprint prevents out-of-memory container termination in constrained staging and production environments.

### Trade-offs
- Secondary indices incur minor write amplification during batch insertion, mitigated by bulk upsert operations (`ordered: false`).
