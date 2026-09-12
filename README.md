# 🕹️ ROM RAG (Retrieval-Augmented Generation)

A **video game ROM (Read-Only Memory) library manager 🕹️**: it searches through
a local directory, identifies ROM files (`.gb/.gbc./gba`, `.nes`, `.n64/.z64`,
`.nds/.3ds`, `.iso`, `bin`, etc.) against
**[No-Intro Datomatic](https://datomatic.no-intro.org/index.php?page=download&s=64)**
databases, and enriches **unidentified ROMs** and **groups a game's variants**
together using **local AI pre-trained models (from Ollama)**.

> **See [docs/CHANGELOG.md](./docs/CHANGELOG.md) to be up-to-date.**

## Table of contents

- [Team](#team)
- [Stack](#stack)
- [Getting started](#getting-started)
- [Scripts](#scripts)
- [Repository structure](#repository-structure)
- [Dataset](#dataset)
- [Quality and CI](#quality-and-ci)
- [Documentation](#documentation)
- [Versioning](#versioning)

## Team

| Member                      | GitHub                                           | Main role                                                                                                                                                                                          |
| --------------------------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **David MELOCCO**           | [@ThFoxY](https://github.com/ThFoxY)             | ![Leader](https://img.shields.io/badge/role-leader-ffffff) ![Frontend](https://img.shields.io/badge/role-frontend-3b82f6) ![Docs%2FCI](https://img.shields.io/badge/role-docs/CI-d6172b)           |
| **Neda Khelifi**            | [@Novachocolat](https://github.com/Novachocolat) | ![Backend](https://img.shields.io/badge/role-backend-16a34a) ![Data%2FInfra](https://img.shields.io/badge/role-data%2Finfra-f59e0b) ![Docs%2FCI](https://img.shields.io/badge/role-docs/CI-d6172b) |
| **Lysandre PACE--BOULNOIS** | [@Novachocolat](https://github.com/Novachocolat) | ![Backend](https://img.shields.io/badge/role-backend-16a34a) ![AI](https://img.shields.io/badge/role-AI-8b5cf6) ![Docs%2FCI](https://img.shields.io/badge/role-docs/CI-d6172b)                     |
|                             |

### RACI matrix

**R** = Responsible (does the work)

**A** = Accountable (final owner, exactly one per row)

**C** = Consulted

**I** = Informed

| Activity                             | David | Neda | Lysandre |
| ------------------------------------ | ----- | ---- | -------- |
| **Overall architecture & ADRs**      | A     | C    | C        |
| **React UI & design system**         | A/R   | I    | I        |
| **Client state & API integration**   | A/R   | C    | I        |
| **Express REST API**                 | C     | A/R  | R        |
| **Ollama adapter & prompts**         | I     | C    | A/R      |
| **DAT file parsing**                 | I     | A/R  | C        |
| **Directory scan & hashing**         | I     | A/R  | C        |
| **PostgreSQL/pgvector schema**       | R     | A/R  | C        |
| **Redis cache & job queue**          | A/R   | C    | R        |
| **Unit tests**                       | R     | R    | R        |
| **Integration/Bruno tests**          | A/R   | R    | R        |
| **Docker & Compose**                 | C     | I    | A/R      |
| **GitHub Actions**                   | C     | C    | A/R      |
| **Documentation & CHANGELOG**        | A/R   | R    | R        |
| **Notion backlog & sprint tracking** | A/R   | C    | C        |

## Stack

| Layer         | Technologies                                                                       |
| ------------- | ---------------------------------------------------------------------------------- |
| **Frontend**  | React 19, TanStack Query, Redux Toolkit, TailwindCSS 4, shadcn/ui                  |
| **Backend**   | Node.js, Express 5, Zod, Helmet, CORS                                              |
| **Databases** | PostgreSQL 17 + pgvector, Redis 8 (ioredis), Prisma 7                              |
| **AI models** | Ollama with a local LLM (`gemma4:12b/26b`) and a embedding model (`embeddinggema`) |
| **Quality**   | TypeScript strict, Oxlint, Prettier, Vitest, Husky, commitlint                     |
| **Tooling**   | npm workspaces, Docker / Docker Compose, GitHub Actions                            |

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org/) >= 22,
[Docker](https://docs.docker.com/get-docker/) with
[Compose v2](https://docs.docker.com/compose/), and [Git](https://git-scm.com/).

```bash
git clone https://github.com/Novachocolat/rom-rag-sae-but3.git
cd rom-rag-sae-but3

cp .env.example .env  # Fill in local values (DB, Redis, ports...)
npm ci                # Installs the 3 workspaces (shared, backend, frontend)
```

### With Docker

No local install of **PostgreSQL**, **Redis**, or even `npm install` is required
beyond the `npm ci` above.

```bash
npm run docker:dev        # full stack (Postgres, Redis, backend, frontend), dev mode
npm run docker:dev:down   # stop the stack
npm run docker:dev:reset  # wipe volumes then restart (see note below)
```

**Once started:** frontend on <http://localhost:5173>, backend on
<http://localhost:3000>, health check on <http://localhost:3000/api/health>.

An `init` service runs once before `backend` and `frontend`: it builds
`shared/dist`, generates the Prisma client, and applies migrations. All three
Node services share the same image (`Dockerfile.dev`).

The production stack (`docker-compose.prod.yml`) targets a local, Docker-only
assessment setup. There is no **Nginx/reverse-proxy layer**, since this project
is never hosted publicly (see
[CONVENTIONS.md](./CONVENTIONS.md#infrastructure)).

## Scripts

| Command                                   | Effect                                                |
| ----------------------------------------- | ----------------------------------------------------- |
| `npm run dev`                             | Runs `shared`, `backend`, and `frontend` in parallel. |
| `npm run build`                           | Builds all three workspaces.                          |
| `npm run build:shared`                    | Builds `shared/` only.                                |
| `npm test`                                | Runs Vitest across all workspaces.                    |
| `npm run lint` / `lint:fix`               | Oxlint, with or without autofix.                      |
| `npm run format` / `format:check`         | Prettier, write or check-only.                        |
| `npm run ts:check`                        | Type-checks the three `tsconfig` projects.            |
| `npm run db:generate`                     | Generates the Prisma client.                          |
| `npm run db:migrate`                      | Applies Prisma migrations (dev).                      |
| `npm run db:studio`                       | Opens Prisma Studio.                                  |
| `npm run docker:dev` / `:down` / `:reset` | Starts/stops/resets the dev stack.                    |
| `npm run docker:prod` / `:down`           | Starts/stops the production-like stack.               |

## Repository structure

```
shared/                   Zod schemas and types shared by frontend/backend
  src/schemas/              Validated data shapes (env, health, user...)
  src/types/                Plain shared TypeScript types
backend/
  src/
    client/                 Ollama adapters (LLM, embedding)
    service/                Pure business logic
    storage/                Prisma, pgvector queries, Redis
    routes/                 Express route handlers
    lib/                    Wrappers around external clients (Prisma, Redis...)
frontend/
  src/
    components/ui/          shadcn-generated components (regenerated, not hand-edited)
docs/
  adr/                      Architecture Decision Records
  monitoring/               Sprint tracking notes (superseded by Notion)
dataset/
  dat/                      No-Intro .dat catalogs (versioned)
  roms/                     (legally) acquired ROMs for testing directory scans
prompts/                    Versioned prompts consumed by the backend
```

## Dataset

`dataset/dat/` holds real **No-Intro `.dat` catalogs (Logiqx XML)** used to
identify ROMs by **name/MD5/SHA-1**.

`dataset/roms/` holds **real ROMs** for exercising the directory scanner.

## Quality and CI

Every change goes through a **Pull Request** into `dev`, approved by a
**codeowner**. [GitHub Actions](https://github.com/features/actions)
(`.github/workflows/pr-checks.yml`) runs on every pull request:

- **quality** — `format:check`, `lint`, `db:generate`, `ts:check`, then `test`.
- **tests & comments** — checks that any backend file added/modified under
  `backend/src/` has a co-located test and is commented.
- **docker build** — validates `docker-compose.yml` and builds `Dockerfile.dev`.
- **assign reviewer** — automatically requests a review.

_Tests need neither PostgreSQL nor Redis: both are mocked._

## Documentation

| Document                                       | Content                                                                     |
| ---------------------------------------------- | --------------------------------------------------------------------------- |
| [CONTRIBUTING.md](./CONTRIBUTING.md)           | Git workflow, issue lifecycle, commits, migrations, secrets, pull requests. |
| [CONVENTIONS.md](./CONVENTIONS.md)             | Code/naming conventions                                                     |
| [docs/CHANGELOG.md](./docs/CHANGELOG.md)       | Version history.                                                            |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Layers and data flow.                                                       |
| [docs/DATA_MODEL.md](./docs/DATA_MODEL.md)     | Relational and vector schema.                                               |
| [docs/AI.md](./docs/AI.md)                     | Models, prompts, output schemas, robustness.                                |
| [docs/SECURITY.md](./docs/SECURITY.md)         | Security and data-integrity measures.                                       |
| [docs/adr/](./docs/adr/)                       | Architecture Decision Records.                                              |

> **All documentation was supervised and reviewed by Claude to ensure team's
> productivity and comprehension.**

## Versioning

**See [docs/CHANGELOG.md](./docs/CHANGELOG.md) to be up-to-date.**
