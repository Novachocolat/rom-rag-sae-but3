# Contributing

## Onboarding

1. Get access to the team's Notion workspace:
   <https://app.notion.com/p/SAE-BUT3-App-Intelligente-ROM-RAG-3d86ab05d5d78088a037fd88225772bd?source=copy_link>.
   It hosts the **issues board**, the team's **brainstorming notes**, and the
   **sprint board** (see [Issue tracking](#issue-tracking--sprints) below).

2. Clone the repo and install:

   ```sh
   # Install project dependencies
   npm ci

   # Copy the environment variables
   cp .env.example .env

   # Run the project
   npm run docker:dev
   ```

3. **Confirm the stack is up:** frontend on <http://localhost:5173>, backend on
   <http://localhost:3000>, health check on <http://localhost:3000/api/health>.
4. Read [CONVENTIONS.md](./CONVENTIONS.md) before writing any code, in
   particular its foreword: match the patterns already in the codebase.
5. See recent entries in `docs/adr/` to understand why the stack looks the way
   it does before proposing a different approach.

## Issue tracking & sprints

- **Issues** live on the Notion board (table view). Every piece of work
  (feature, bug, chore) starts as a Notion row before it becomes a GitHub
  issue/branch.
- **Brainstorming notes**: free-form team notes also live in Notion.
- **Sprint board**: one Notion table per sprint, with columns:

  | Column          | Meaning                               |
  | --------------- | ------------------------------------- |
  | **Sprint #**    | Sprint number                         |
  | **Date**        | Sprint start/end date                 |
  | **Assignee(s)** | Who is doing the work                 |
  | **AS A...**     | Who the user story is for             |
  | **I WANT...**   | What they want to do                  |
  | **SO THAT...**  | Why (the value delivered)             |
  | **Priority**    | Relative priority within the sprint   |
  | **Status**      | Todo / In progress / In review / Done |
  | **DoR**         | Definition of Ready met? (see below)  |
  | **DoD**         | Definition of Done met? (see below)   |

### Definition of Ready (DoR)

An item can enter a sprint once it has: a clear "AS A / I WANT / SO THAT",
acceptance criteria the team agrees on, and no known blocking dependency. If any
of these is missing, raise it in Notion before picking up the item.

### Definition of Done (DoD)

An item is only "Done" once **all** of the following are true:

- **Tests** exist and pass for the change (see
  [CONVENTIONS.md](./CONVENTIONS.md#testing)).
- **Documentation is up to date:** README/CONTRIBUTING/CONVENTIONS/`docs/*`
  reflect the change if it affects them. A code change that makes a doc page
  stale without updating it is not done.
- **An ADR was written:** if the change involves a structuring choice (new
  dependency, new architectural pattern, a decision that would be costly to
  reverse). See [Architecture decisions](#architecture-decisions).
- **No orphan TODO:** a `TODO`/`FIXME` left in the diff must reference an owner
  and, ideally, a Notion/GitHub issue. A TODO with no owner and no tracking is a
  blocker, not a note to self.

## Issue lifecycle

```
Notion / GitHub  →  issue  →  branch  →  PR  →  review  →  merge  →  close
```

1. The item exists on the Notion board (or as a GitHub issue for something
   discovered outside sprint planning, e.g. a CI break).
2. Open (or link) a matching **GitHub issue** if one doesn't already exist, so
   the PR has something to close.
3. Create a **branch** from `dev` (see [Branching](#branching)).
4. Open a **PR** referencing the issue (`Closes #123`). See
   [Pull requests](#pull-requests).
5. Get it **reviewed** and address feedback.
6. **Merge** (squash) into `dev`. The linked issue closes automatically;
   otherwise close it manually and update its Notion status to Done.

## Branching

- `main` — production-ready, protected.
- `dev` — integration branch, protected. All feature work merges here first.
- Feature branches: `<type>/<short-description>`, e.g. `feat/user-auth`,
  `fix/redis-reconnect`. Type matches the Conventional Commits types below.

## Commits

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and
are checked automatically by commitlint (Husky `commit-msg` hook):

`type(scope): subject`

- `type`: feat, fix, docs, style, refactor, perf, test, build, ci, chore
- `scope` (must match `commitlint.config.js`'s `scope-enum`):

  | Scope      | Use for                                                                                                           |
  | ---------- | ----------------------------------------------------------------------------------------------------------------- |
  | `frontend` | `frontend/` only                                                                                                  |
  | `backend`  | `backend/` only                                                                                                   |
  | `shared`   | `shared/` only                                                                                                    |
  | `docker`   | Dockerfiles, `docker-compose*.yml`                                                                                |
  | `ci`       | `.github/workflows/`, `.github/scripts/`                                                                          |
  | `github`   | Other `.github/` files (PR/issue templates, `CODEOWNERS`)                                                         |
  | `docs`     | `docs/`, `CHANGELOG.md`, `README.md`                                                                              |
  | `deps`     | Dependency bumps in any workspace                                                                                 |
  | `config`   | Root-level tooling config (`tsconfig*`, `.oxlintrc.json`, `commitlint.config.js`, `.prettierrc`, `.editorconfig`) |
  | `db`       | Prisma schema/migrations                                                                                          |
  | `repo`     | Anything else at the repo root not covered above                                                                  |

  Scope is omitted only when a change is genuinely repo-wide and none of the
  above fits better than nothing.

- `subject`: imperative, lowercase, no trailing period

**Never work on `main`/`master` branch!**

`dev` only contains reviewed code after validated merging (after your PR was
reviewed).

## Database migrations

Migrations are managed by Prisma and live in `backend/prisma/migrations/`.

- **Create**: edit `backend/prisma/schema.prisma`, then run
  `npm run db:migrate -w @repo/backend` (wraps `prisma migrate dev`). This
  generates the SQL file and applies it to your local database.
- **Name**: pass `--name <short-description>` (kebab or snake_case, e.g.
  `add-user-email-index`) — Prisma prefixes it with a UTC timestamp
  automatically, producing folders like `20260911193935_init`. Never rename a
  migration folder by hand after it has been committed.
- Never edit a migration file that has already been merged to `dev`. Write a new
  migration instead, even to fix a typo.
- Run `npm run db:generate` after pulling any change that touches
  `schema.prisma` so your local Prisma client stays in sync.

## Secrets

- **No `.env` file is ever committed.** `.gitignore` already excludes `.env` and
  `.env.prod`; do not force-add one.
- **`.env.example` must be updated in the same PR** whenever you add, rename, or
  remove an environment variable. Add the corresponding field to
  `shared/src/schemas/env.ts` at the same time. See the comment at the top of
  `.env.example`.
- Never hardcode a default for a secret-shaped value (password, token, key) in
  code as a fallback for a missing env var. Fail fast instead (see the `FIX`
  comment already tracked in `backend/src/env.ts`).
- If a secret is ever committed by mistake, treat it as compromised (rotate it).
  Rewriting history is not a substitute for rotation.

## Before opening a pull request

Run locally (or let Husky's pre-commit hook do it via lint-staged):

```bash
npm run format:check
npm run lint
npm run ts:check
npm test
```

## Pull requests

**Target `dev`, never `main` directly.**

A **codeowner** must approve your PR. You must set who can review and a GitHub
label.

Use the PR template (`.github/PULL_REQUEST_TEMPLATE.md`) but do not delete its
sections.

## Merging

All commits from a merge **must be squashed** to not mess the Git history.

The title of **Pull Requests** must follow **Conventional Commits** (see above).

## Architecture decisions

Non-trivial technical choices are recorded as **ADRs** in `docs/adr/`.

Copy `docs/adr/template.md` for a new one and open it in the same PR as the
change it justifies.

Always use the next number available. If replaced, please add
`Superseded by ADR-NNN` (with `NNN` being the new number of the replacing ADR).
