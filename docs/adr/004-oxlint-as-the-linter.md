# ADR-004: Oxlint as the linter

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY, @Novachocolat

## Context

**Why is this decision necessary?**

- Linting runs on every commit through Husky and on every pull request. A slow
  linter discourages atomic commits, which are a grading requirement.
- ESLint with type-aware rules takes tens of seconds on a monorepo, which is too
  slow for a `pre-commit` hook.

## Decision

**What has been decided**

- Oxlint is used as the single linter for the whole monorepo, configured at the
  root and shared by the three workspaces.
- Type-level correctness is delegated to `tsc -b` (`npm run ts:check`), which
  runs in CI and covers what Oxlint cannot check without type information.

## Consequences

**Assets and risks (if any)**

- Asset(s): linting completes in under a second, so `lint-staged` stays usable;
  a single configuration file for three workspaces.
- Risk(s): Oxlint implements a subset of the ESLint rule set and has no
  type-aware rules, so some issues are only caught by `tsc` in CI; the React and
  import plugins must be explicitly enabled.
