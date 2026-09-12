# ADR-002: TypeScript environment

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY

## Context

**Why is this decision necessary?**

- A strong and resilient programming language will help with productivity,
  security and error handling. Already existing code snippets must be available
  online to faster the development.

## Decision

**What has been decided**

- TypeScript is a strongly typed JavaScript superset. It is featured as the
  first programming language for web development. Using Node.js, the frontend
  and backend use the same programming environment.

## Consequences

**Assets and risks (if any)**

- Asset(s): a same programming language across the codebase and a strong
  community with numerous packages (using npm).
- Risk(s): a constant need to ensure the code is TypeScript-checked (no any),
  with JSDoc and error handling for edge cases.
