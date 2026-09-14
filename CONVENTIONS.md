# Conventions

## Foreword

**Before writing anything, read the code that is already there.** This document
sets the baseline, but the codebase itself is the more detailed and more current
reference: when a rule below is silent on a case, match the closest existing
file rather than inventing a new pattern.

## TypeScript

- No `any`. Enforced by `typescript/no-explicit-any: error` in
  [.oxlintrc.json](./.oxlintrc.json).
- Use `unknown` + narrowing, or a proper type/generic.
- Strict mode is on across all three tsconfigs (`strict`,
  `noUncheckedIndexedAccess`, `noImplicitOverride`, `noUnusedLocals`,
  `noUnusedParameters`, `noFallthroughCasesInSwitch`, see
  [tsconfig.base.json](./tsconfig.base.json)). Do not weaken it locally, and do
  not silence it with inline suppressions instead of fixing the actual type.
- **Cross-boundary types and schemas belong in `shared/`, never duplicated.** If
  a type or Zod schema is used by both `frontend` and `backend`, it goes in
  `shared/src/{schemas,types}` and both workspaces import `@repo/shared/*`.
- Favor Zod schemas as the single source of truth for runtime-validated data:
  derive the static type with `z.infer<>` rather than hand-writing a matching
  `interface`. For everything else (function signatures, component props,
  internal domain shapes), prefer explicit `interface`/`type` declarations over
  inferring from usage. See `shared/src/schemas/env.ts` for the pattern already
  in place.

## Naming

- Files: `kebab-case.ts` (e.g. `user-service.ts`), except React components:
  `PascalCase.tsx` (e.g. `UserCard.tsx`).
- Routes: `kebab-case.routes.ts` (e.g. `health.routes.ts`)
- Services: `kebak-case.service.ts`
- Tests: `kebab-case.test.ts` (e.g. `health.test.ts`)
- Schemas: `kebab-case.schema.ts` (e.g. `health.schema.ts`)
- Variables/functions: `camelCase`
- Types/interfaces: `PascalCase`
- Zod schemas: `xSchema`, inferred type `X` (e.g. `healthSchema`)

## Project structure

- `shared/` — Zod schemas and types consumed by both `frontend` and `backend`
  (`shared/src/schemas`, `shared/src/types`). Nothing here imports from either
  workspace.
- `backend/src/client` — outbound adapters to external inference services
  (Ollama LLM/embedding clients).
- `backend/src/service` — pure business logic. No HTTP (`express`) and no React
  imports here.
- `backend/src/storage` — Prisma/pgvector/Redis access. Business logic in
  `service/` depends on this through function signatures, not the other way
  around.
- `backend/src/routes` — Express route handlers; delegate to `service/`.
- `frontend/src/components/ui` — shadcn-generated components, not hand-edited
  (regenerate via `npx shadcn add`).

## Comments and documentation

- Default to no comments; add one only when the code cannot explain itself (a
  non-obvious constraint, a workaround, a "why").
- Use JSDoc (`/** ... */`) specifically for anything exported from `shared/` or
  for a `backend/src/client`, `service`, or `storage` function whose contract
  isn't obvious from its name and types alone: one clear summary sentence,
  `@param`/`@returns` only when they add information the type signature doesn't
  already give (e.g. units, valid ranges, side effects). Do not write
  multi-paragraph doc blocks. If a function needs that much explanation, it is
  doing too much.
- Every `TODO` must name an owner and be resolvable; see
  [CONTRIBUTING.md](./CONTRIBUTING.md#definition-of-done) on orphan TODOs.
  Follow the existing `// TODO: ...` / `// FIX (@handle, YYYY-MM-DD): ...` style
  already used in `backend/src/env.ts` and `backend/src/routes/health.ts`.
- Keep documentation up to date in the same PR as the code it describes.

## Dataset and prompts hygiene

- `dataset/` holds only license-safe reference data: No-Intro `.dat` catalogs
  (`dataset/dat/`) and ROMs used to test the scanner (`dataset/roms/`). `.dat`
  catalogs are checksum/metadata databases and are fine to version.
- `prompts/` holds only reviewed, versioned prompt files that the backend
  actually loads. Treat a prompt change like a code change: it goes through a
  PR.

## Styling

- Tailwind utility classes only; avoid new CSS files unless Tailwind cannot
  express the style.
- Use the `cn()` helper (`clsx` + `tailwind-merge`, see
  `frontend/src/lib/utils.ts`) when composing conditional class names. Never
  string-concatenate classes. Click here for
  [tailwind-merge + clsx documentation](https://dev.to/sheraz4194/mastering-tailwind-css-overcome-styling-conflicts-with-tailwind-merge-and-clsx-1dol).

## Testing

- Vitest. Co-locate tests as `*.test.ts` next to the file under test.
- Every route under `backend/src/` must have a co-located test (enforced by CI's
  `tests-and-comments` job).
- At least reach **>= 80%** coverage.

## Infrastructure

- **No Nginx configuration.** This project is assessed locally only, never
  hosted. `docker compose` (dev) is the entire runtime target. Do not introduce
  a reverse proxy, TLS termination, or any production-hosting concern; if
  `docker-compose.prod.yml` needs a static-file server for the frontend build,
  keep it as simple as the dev setup.
