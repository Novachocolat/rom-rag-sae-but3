# Architecture

## 1. Layers

The backend (`backend/src/`) is split into four layers, each depending only on
the one below it (see [CONVENTIONS.md](../CONVENTIONS.md#project-structure)):

```mermaid
graph TD
    subgraph Frontend["frontend/src"]
        UI["React components"]
    end

    subgraph Shared["shared/src"]
        Schemas["Zod schemas + inferred types"]
    end

    subgraph Backend["backend/src"]
        Routes["routes/ — Express handlers"]
        Service["service/ — business logic"]
        Storage["storage/ — Prisma, pgvector, Redis"]
        Client["client/ — Ollama adapters (LLM, embedding)"]
    end

    DB[(PostgreSQL + pgvector)]
    Cache[(Redis)]
    Ollama["Ollama (external)"]

    UI -->|fetch /api/*, typed with| Schemas
    Routes -->|delegate to| Service
    Service --> Storage
    Service --> Client
    Storage --> DB
    Storage --> Cache
    Client -->|HTTP| Ollama
    Routes -.->|request/response shapes| Schemas
```

## 2. Backend HTTP request lifecycle

Every request goes through the same **middleware chain**, assembled in
[`backend/src/app.ts`](../backend/src/app.ts). **The order matters:** the
request ID must exist before anything can be logged, and the error handler must
be last so it can catch whatever `next(err)` was called with.

```mermaid
sequenceDiagram
    participant C as Client
    participant RID as requestIdMiddleware
    participant SEC as helmet + cors
    participant BODY as express.json + cookieParser
    participant R as rootRouter (routes/*.routes.ts)
    participant NF as notFoundMiddleware
    participant ERR as errorMiddleware
    participant L as logger

    C->>RID: HTTP request
    RID->>RID: crypto.randomUUID()
    RID-->>C: header X-Request-Id
    RID->>SEC: next()
    SEC->>BODY: next()
    BODY->>R: next()

    alt route matches
        R->>R: handler runs
        alt handler succeeds
            R-->>C: 2xx/5xx JSON response
        else handler throws / calls next(err)
            R->>ERR: next(err)
        end
    else no route matches
        R->>NF: falls through
        NF->>ERR: next(AppError.notFound(...))
    end

    ERR->>L: logger.warn/error(message, meta)
    ERR-->>C: JSON { error: { code, message, details, requestId } }
```

- **`requestIdMiddleware`** (`backend/src/middleware/request-id.middleware.ts`):
  generates one UUID per request, exposes it as `res.locals.requestId` and as
  the `X-Request-Id` response header, so a client-reported bug can be traced to
  one log line.
- **`notFoundMiddleware`** (`backend/src/middleware/not-found.middleware.ts`):
  the last handler mounted before the error handler; turns any unmatched route
  into an `AppError.notFound(...)` instead of Express's default HTML 404 page.
- **`validate.middleware.ts`**: wraps a route with `{ body?, query?, params? }`
  Zod schemas; a failed `parseAsync` calls `next(err)` with the raw
  `z.ZodError`, which `errorMiddleware` maps to `400 VALIDATION_ERROR`.

## 3. Error handling: `AppError` → `errorMiddleware` → `ApiError`

Two types anchor the error contract, one on each side of the wire:

- **`AppError`** (`backend/src/lib/error.ts`) the only error type route/service
  code should throw on purpose. It carries `statusCode`, a machine-readable
  `code`, a human `message` and optional `details`, plus factories
  (`AppError.notFound`, `.badRequest`, `.unauthorized`, `.conflict`,
  `.serviceUnavailable`) so call sites never hardcode a status number.
- **`ApiError`** (`shared/src/schemas/api.schema.ts`) the Zod schema (and
  inferred type) for the JSON envelope the client actually receives:
  `{ error: { code, message, details?, requestId } }`. It is imported by both
  workspaces, so the frontend can parse an error response with the same schema
  the backend used to shape it.

`errorMiddleware` (`backend/src/middleware/error.middleware.ts`) is the single
place that turns _any_ thrown value into an `ApiError`-shaped response:

```mermaid
flowchart TD
    Start(["err reaches errorMiddleware"]) --> IsApp{"err instanceof AppError?"}
    IsApp -->|yes| UseApp["statusCode/code/message/details = err.*"]
    IsApp -->|no| IsZod{"err instanceof z.ZodError?"}
    IsZod -->|yes| UseZod["400 VALIDATION_ERROR, details = err.issues"]
    IsZod -->|no| IsPrisma{"err.code === 'P2002' / 'P2025'?"}
    IsPrisma -->|P2002| UseConflict["409 CONFLICT, details = err.meta"]
    IsPrisma -->|P2025| UseNotFound["404 NOT_FOUND"]
    IsPrisma -->|no| UseDefault["500 INTERNAL_ERROR (message hidden)"]

    UseApp --> Log
    UseZod --> Log
    UseConflict --> Log
    UseNotFound --> Log
    UseDefault --> Log

    Log["logger.error (>=500) or logger.warn (<500) with requestId, path, method, stack"] --> Respond["res.status(statusCode).json({ error })"]
```

Stack traces are only ever written to the log (via `logger`), never returned in
the HTTP response — this is what keeps `NODE_ENV=production` from leaking
internals, per
[US1.3's DoD](./monitoring/sprint-01.md#us13--robustesse-http--erreurs-validation-journalisation).

## 4. Logger

`backend/src/lib/logger.ts` is a minimal structured logger with no external
dependency: `debug`/`info`/`warn`/`error`, each writing one JSON line
(`{ timestamp, level, msg, ...meta }`) to `stdout`, except `error` which writes
to `stderr`. In production (`NODE_ENV=production`) `debug` lines are filtered
out; every other environment logs everything. `errorMiddleware` always passes
`requestId` in `meta`, so log lines for the same request can be grep'd together
even though the logger itself has no session/correlation state.

## 5. End-to-end scan flow (target — not yet implemented)

The Prisma schema (`backend/prisma/schema.prisma`) already models the full scan
→ identify → group pipeline; the `service/`/`storage`/`client` code that
implements it is planned for a later sprint. This sequence is the target flow,
kept here so the HTTP/error/logging layer above is designed against real future
call sites instead of guesswork:

```mermaid
sequenceDiagram
    participant U as User (frontend)
    participant API as backend/routes
    participant Job as ScanJob (in-memory + Redis progress)
    participant FS as Filesystem scanner
    participant DAT as DatEntry lookup (md5/sha1)
    participant AI as Ollama (LLM + embeddinggemma)
    participant DB as PostgreSQL (Rom, AiProposal, RomEmbedding)

    U->>API: POST /api/scans { rootRelativePath }
    API->>Job: create ScanJob (status=PENDING)
    API-->>U: 202 { jobId }
    Job->>FS: walk directory, hash files (md5/sha1)
    loop each file
        FS->>DAT: lookup by sha1/md5/name
        alt DAT match
            DAT->>DB: upsert Rom (identificationSource=DAT_*)
        else no match
            FS->>AI: embeddinggemma(sourceText) + LLM proposal
            AI->>DB: insert RomEmbedding + AiProposal (PENDING)
        end
        Job->>Job: processedFiles++, progress -> Redis
    end
    U->>API: GET /api/scans/:id (polling)
    API-->>U: { status, processedFiles, totalFiles, ... }
    Job->>DB: ScanJob.status = COMPLETED
```

See
[ADR-010](./adr/010-embeddinggemma-vectors-in-pgvector-for-semantic-grouping.md),
[ADR-011](./adr/011-opaque-redis-sessions-with-argon2id.md) and
[ADR-012](./adr/012-in-process-job-with-redis-progress-no-bullmq.md) for the
decisions behind the vector search, auth and job-progress pieces of this flow.
