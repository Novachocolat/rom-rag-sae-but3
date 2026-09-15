# ADR-009: SonarQube as the quality gate

**Date:** 2026-09-14

**Status:** Proposed

**Reviewer(s):** @ThFoxY, @Novachocolat

## Context

**Why is this decision necessary?**

- Oxlint ([ADR-004](004-oxlint-as-the-linter.md)) is fast enough for a
  `pre-commit` hook, but it only implements a subset of the ESLint rule set,
  has no type-aware analysis, and has no dedicated security rule set: patterns
  such as SQL/command injection, hardcoded secrets or unsafe regexes can pass
  CI unnoticed.
- Vitest ([ADR-005](005-vitest-as-the-test-runner.md)) already enforces an
  80% coverage threshold locally, but that number only exists as a pass/fail
  in a CI log: there is no history, no per-file or per-new-code view, and no
  trend to demonstrate at the final defense that the reproducibility
  requirement is actually held over time as the codebase grows.
- Nothing currently measures maintainability (code smells, cognitive
  complexity, duplicated blocks) across the three workspaces, which share
  recurring patterns (Zod schemas, Express routes, Prisma repositories); such
  regressions creep in silently under a grading deadline.
- Evaluators explicitly grade CI robustness and reproducibility (see
  US-1.2); a single dashboard aggregating coverage, security and
  maintainability is a stronger artifact for that grading than scattered CI
  logs spread across jobs.

## Decision

**What has been decided**

- SonarCloud is added as a quality-gate step in `pr-checks.yml`, running
  after the `Test` step of the `quality` job.
- It consumes the `lcov` report already produced by the Vitest `coverage`
  configuration (see [ADR-005](005-vitest-as-the-test-runner.md)) instead of
  recomputing coverage itself.
- A quality gate is configured on: coverage on new code, zero new
  blocker/critical security issues (SAST and secret detection), and a
  maintainability rating no worse than `A` on new code — the pipeline fails
  and the PR is blocked when the gate is red.
- SonarQube complements Oxlint rather than replacing it: Oxlint stays the fast
  linter run on every commit and PR ([ADR-004](004-oxlint-as-the-linter.md)),
  SonarQube runs once per PR as the deeper, security- and
  maintainability-focused pass.

## Consequences

**Assets and risks (if any)**

- Asset(s): a single dashboard showing coverage trend, security hotspots and
  maintainability rating over time, which directly supports the
  reproducibility requirement; security analysis (SAST, secret detection)
  that Oxlint does not provide; automatic PR decoration so reviewers see new
  issues inline on GitHub without an extra tool.
- Risk(s): an extra CI step increases pipeline duration and adds a dependency
  on an external service (SonarCloud availability/quota); it requires a
  `SONAR_TOKEN` secret in CI, which is another credential to protect and
  rotate under the Secrets policy in `CONTRIBUTING.md`; the quality gate's
  thresholds must be scoped to "new code" to avoid blocking PRs on
  pre-existing debt unrelated to the change.
