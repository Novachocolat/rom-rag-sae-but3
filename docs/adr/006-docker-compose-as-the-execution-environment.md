# ADR-006: Docker Compose as the execution environment

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY, @Novachocolat

## Context

**Why is this decision necessary?**

- An user must be able to start the whole application without installing
  PostgreSQL, Redis or Node.js manually.
- The application depends on PostgreSQL with the `pgvector` extension, on Redis
  and on a reachable Ollama instance, which cannot be assumed present.

## Decision

**What has been decided**

- Two Compose files are maintained: `compose.yaml` for development, with bind
  mounts and hot reload, and `compose.prod.yaml` for the graded build, using
  multi-stage images and Nginx in front of the frontend.
- The database image is `pgvector/pgvector`, so the extension is available
  without a custom build.
- Ollama is **not** containerised: it is an external service reached through
  `OLLAMA_BASE_URL`, since models are hosted elsewhere.

## Consequences

**Assets and risks (if any)**

- Asset(s): a single `docker compose up --build` starts the stack; identical
  service versions for the developers and the user.
- Risk(s): image build time slows the CI feedback loop, mitigated by the GitHub
  Actions build cache; the container must be able to reach the Ollama host, so
  `localhost` is never a valid default.
