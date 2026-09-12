# ADR-003: React, TailwindCSS and shadcn/ui as the frontend layer

**Date:** 2026-09-07

**Status:** Accepted

**Reviewer(s):** @ThFoxY

## Context

**Why is this decision necessary?**

- The frontend needs a widely documented UI layer that integrates with the
  TypeScript environment already decided (@see ADR-002).
- We prefer a library over a framework: it can be composed and kept modular, and
  it does not impose a routing or data-fetching strategy.
- Styling must stay consistent across developers without a dedicated designer,
  so a design system with prebuilt components is required.

## Decision

**What has been decided**

- React is used as the frontend library. It relies on JSX, a syntax extension
  that allows HTML-like markup to be written inside TypeScript files.
- TailwindCSS provides utility-first styling directly through `className`.
- shadcn/ui provides accessible components, copied into the repository under
  `frontend/src/components/ui` rather than installed as a dependency.

## Consequences

**Assets and risks (if any)**

- Asset(s): consistent visual style, accessible primitives out of the box, and
  no runtime dependency on a component vendor.
- Risk(s): shadcn components are vendored, so upstream fixes are not received
  automatically; component trees must stay modular to avoid prop drilling.
