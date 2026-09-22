# ADR-001: Monorepo organization in three directories

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY

## Context

**Why is this decision necessary?**

- A web application must NOT include UI next to logic. A messy file tree will
  generate technical debts. React is a library, not a framework: organization
  can and must be decided beforehand.

## Decision

**What has been decided**

- A monorepo split with `frontend`, `backend` and `shared` to best organize a
  web application using React and Node.js.
- A `shared` directory (at root directory) is reachable from both frontend and
  backend. It includes packages that must only be declared once
  (types/schemas/interfaces).

## Consequences

**Assets and risks (if any)**

- Asset(s): a clean file tree, split in distinct directories, will reduce
  development time and increase productivity.
- Risk(s): a desynchronization from `shared` and its consumers
