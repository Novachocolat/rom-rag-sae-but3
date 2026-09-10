# Contributing

## Onboarding

```sh
# Install project dependencies
npm ci

# Copy the environment variables
cp .env.example .env

# Run the project
npm run docker:dev
```

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
- `scope`: list allowed scopes that must match commitlint.config.js, e.g.
  frontend, backend, shared, docker, ci, deps, config, db, repo
- `subject`: imperative, lowercase, no trailing period

**Never work on `main`/`master` branch!**

`dev` only contains reviewed code after validated merging (after your PR was
reviewed).

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
