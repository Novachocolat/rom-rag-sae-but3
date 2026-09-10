# ADR-008: Redux Toolkit for client state, React Query for server state

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY

## Context

**Why is this decision necessary?**

- The interface holds two kinds of state that must not be confused: data owned
  by the backend (library, scan progress, AI proposals) and data owned by the
  client (active filters, multi-selection of ROMs, review queue of pending AI
  proposals, current grouping draft).
- Using a single mechanism for both leads either to caching logic reimplemented
  by hand, or to server data duplicated in a store and going stale.

## Decision

**What has been decided**

- React Query owns every value that originates from the backend: fetching,
  caching, invalidation, polling of scan jobs. Such values are never copied into
  Redux.
- Redux Toolkit owns client-only state that is shared across distant components
  and must survive navigation: filters, selection, and the AI review queue.
- Any state used by a single component subtree stays in `useState` or in a local
  context.

## Consequences

**Assets and risks (if any)**

- Asset(s): an explicit boundary that prevents stale duplicates; Redux DevTools
  gives a readable trace of user decisions on AI proposals, which is useful for
  the demonstration.
- Risk(s): two state mechanisms increase the learning cost for the team and can
