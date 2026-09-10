# ADR-007: PostgreSQL with pgvector as the vector store

**Date:** 2026-09-07

**Status:** Proposed

**Reviewer(s):** @ThFoxY

## Context

**Why is this decision necessary?**

- Grouping ROMs that correspond to the same game despite naming, version or
  language differences requires semantic similarity search over embeddings
  produced by `embeddinggemma`.
- Relational data (ROM files, hashes, DAT entries, AI proposals) is already
  stored in PostgreSQL. Adding a second database would duplicate identifiers and
  require a synchronisation strategy.

## Decision

**What has been decided**

- Embeddings are stored in the same PostgreSQL instance using the `pgvector`
  extension, in a `vector(768)` column matching the `embeddinggemma` output
  dimension.
- An HNSW index with the cosine operator class is created for similarity search.
- Prisma models the column as `Unsupported("vector(768)")`; all similarity
  queries go through typed `$queryRaw` helpers confined to
  `backend/src/storage`.
- The raw cosine distance is returned to the service layer and exposed in the
  UI, as required by the observability rules.

## Consequences

**Assets and risks (if any)**

- Asset(s): one database, one connection pool, one backup; joins between a
  similarity result and its ROM metadata are done in SQL, not in Node.js.
- Risk(s): Prisma cannot type or migrate the vector column, so index creation
  lives in a hand-written migration and query typing is asserted with Zod at the
  storage boundary; changing the embedding model changes the dimension and
  requires a migration plus a full re-embedding.
