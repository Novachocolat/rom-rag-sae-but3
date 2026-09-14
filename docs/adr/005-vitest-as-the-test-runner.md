# ADR-005: Vitest as the test runner

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY

## Context

**Why is this decision necessary?**

- Unit and integration tests must run in continuous integration on every pull
  request.
- The codebase is ESM-only (`"type": "module"`) and written in TypeScript, and
  the frontend is built with Vite.

## Decision

**What has been decided**

- Vitest is the single test runner for `shared`, `backend` and `frontend`.
- Tests are co-located as `*.test.ts(x)` next to the unit under test.
- Coverage is measured with `v8` and a global threshold of 80% is declared in
  `vitest.config.ts`, so the CI job fails without any extra step.
- Integration tests targeting PostgreSQL and Redis run against the service
  containers declared in the CI workflow, never against a developer machine.

## Consequences

**Assets and risks (if any)**

- Asset(s): native ESM and TypeScript support with no transform configuration;
  the frontend reuses the existing Vite pipeline; Jest-compatible API.
- Risk(s): a global coverage threshold can hide an untested critical module, so
  it must be reviewed for coverage explicitly; tests hitting Ollama must be
  mocked to keep the suite deterministic.
