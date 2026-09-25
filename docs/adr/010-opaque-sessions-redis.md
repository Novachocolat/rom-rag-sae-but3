# ADR-010: Opaque sessions in Redis rather than JWT

**Date:** 2026-09-17

**Status:** Accepted

**Reviewer(s):** @Novachocolat

## Context

**Why is this decision necessary?**

- US-1.4 needs a way to keep a user authenticated across requests after
  signup/login, and to end that authentication on logout.
- JWT is the "expected" answer for most tutorials and interviews, so the choice
  not to use it needs an explicit justification, defensible at the oral: this
  ADR is that justification.
- The project runs as a single backend instance behind Docker Compose (see
  [ADR-006](006-docker-compose-as-the-execution-environment.md)), not as a fleet
  of stateless servers that would need to validate a session without a shared
  store.
- Redis is already part of the stack (used for health checks and general
  caching), so adding session storage does not introduce a new dependency.

## Decision

**What has been decided**

- A session is an opaque, random 32-byte token (base64url-encoded), unrelated to
  the user id and carrying no embedded claims. It is stored server-side in Redis
  as `session:<token>` → `userId`, with a TTL (`SESSION_TTL_SECONDS`) that Redis
  expires natively.
- The token is handed to the browser as an `httpOnly`, `sameSite: 'lax'` cookie,
  never readable or replayable from JavaScript.
- `require-auth.middleware.ts` resolves the cookie into `res.locals.userId` on
  every protected request, and extends the TTL on each authenticated request
  (sliding expiration) via `touchSession`.
- Logout deletes the Redis key outright, so the session token is unusable on the
  very next request — not just cleared client-side.

**Why not JWT**

- **Immediate revocation.** A JWT is self-contained and valid until it expires;
  invalidating one before that requires a denylist, i.e. a server-side store
  anyway — at which point the JWT no longer buys statelessness, it only adds a
  signature-verification step on top of the same lookup an opaque token already
  needs. A logout, a password change, or banning a user takes effect instantly
  with a Redis `DEL`; none of those are as immediate with a bare JWT.
- **No key rotation to manage.** Loging/verifying JWTs means owning a secret (or
  key pair) with a rotation policy, versioned tokens during rotation, and
  clock-skew handling. An opaque token sidesteps all of it: there is no
  signature, so there is nothing to rotate.
- **Local scope.** JWT earns its keep when multiple independently-scaled
  services need to verify a session without calling back to a central store.
  This project is one backend process talking to one Redis instance; that
  problem does not exist here, so paying its complexity cost has no matching
  benefit.

## Consequences

**Assets and risks (if any)**

- Asset(s): a session can be revoked instantly and unconditionally (logout,
  moderation, security incident); no login secret to generate, store, or rotate;
  the token itself leaks no information (no decodable payload) if captured
  client-side outside the cookie jar.
- Risk(s): every authenticated request now costs a Redis round-trip (a `GET` and
  an `EXPIRE`) instead of a local signature check — acceptable at this project's
  scale, but it would need revisiting under high request volume or multi-region
  deployment; if Redis is down, no session can be validated (see
  [docs/SECURITY.md](../SECURITY.md) and the `/api/health` dependency check) —
  an availability trade-off inherent to any server-side session store.
