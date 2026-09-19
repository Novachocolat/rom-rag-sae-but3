# ADR-010: `embeddinggemma` vectors in pgvector for semantic grouping

**Date:** 2026-09-17

**Status:** Accepted

**Reviewer(s):** @ThFoxY, @Novachocolat

## Context

**Why is this decision necessary?**

- Two features need vectors from the same `embeddinggemma` model: proposing that
  two ROM files are variants of the same game (`AiProposal.kind = GROUPING`),
  and letting a user search their library by meaning rather than exact title.
- `OLLAMA_EMBEDDING_MODEL=embeddinggemma` and `OLLAMA_EMBEDDING_DIM=768` are
  already fixed in `shared/src/schemas/env.schema.ts`, matching
  `RomEmbedding.embedding vector(768)` in `backend/prisma/schema.prisma`.

## Decision

**What has been decided**

- One embedding per `Rom`, stored in `RomEmbedding.embedding` (`vector(768)`),
  computed from `RomEmbedding.sourceText`, a short string built from the ROM's
  known metadata (title, platform, region, DAT description when available)
  rather than raw file bytes.
- Similarity is cosine distance (`<=>` operator), matching the
  `vector_cosine_ops` operator class used by the HNSW index.
- An HNSW index (`vector_cosine_ops`) is created on `RomEmbedding.embedding` in
  a hand-written migration (Prisma cannot generate index DDL for an
  `Unsupported` column type).
- Two distinct read paths share the same index:
  1. **Grouping candidates** for a newly identified ROM, the top-K nearest
     neighbours above `AI_CONFIDENCE_THRESHOLD` become an `AiProposal`
     (`kind = GROUPING`), reviewed by a user before a `Collection` is formed.
  2. **Semantic search** with a free-text query that is embedded on the fly and
     matched the same way, scoped to `Rom.userId`.
- Raw cosine distance is always returned to the caller alongside the match,
  never silently thresholded away, so the UI can show it (observability rule
  from ADR-007).

## Consequences

**Assets and risks (if any)**

- Asset(s): one index serves both features, so there is no drift between
  "search" and "grouping" similarity math; the threshold
  (`AI_CONFIDENCE_THRESHOLD`) is a single tunable environment variable.
- Risk(s): HNSW is approximate, so a true nearest neighbour can be missed.
  Acceptable here since a human always confirms a `GROUPING` proposal before it
  becomes a `Collection`; re-embedding is required whenever
  `OLLAMA_EMBEDDING_MODEL` or its dimension changes, exactly as noted in
  ADR-007.
