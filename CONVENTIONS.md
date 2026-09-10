# Conventions

## TypeScript

- No `any`.
- Use `unknown` + narrowing, or a proper type/generic.
- Strict mode is on across all three tsconfigs — do not weaken it locally.
- Shared types/schemas that cross the frontend/backend boundary belong in
  `shared/`, not duplicated in each workspace.

## Naming

- Files: `kebab-case.ts` (e.g. `user-service.ts`), except React components:
  `PascalCase.tsx` (e.g. `UserCard.tsx`).
- Variables/functions: `camelCase`
- Types/interfaces: `PascalCase`
- Zod schemas: `xSchema`, inferred type `X` (e.g. `userSchema`)

## Project structure

- `shared/` — Zod schemas and types consumed by both `frontend` and `backend`.
  Nothing here should import from either.
- `backend/src/{client,service,storage}` — external LLM modules suggested by the
  client
- `frontend/src/components/ui` — shadcn-generated components, not hand-edited
  (regenerate via `npx shadcn add`).

## Styling

- Tailwind utility classes only; avoid new CSS files unless Tailwind cannot
  express the style.
- Use the `cn()` helper (`clsx` + `tailwind-merge`) when composing conditional
  class names. Never string-concatenate classes. Click here for
  [tailwind-merge + clsx documentation](https://dev.to/sheraz4194/mastering-tailwind-css-overcome-styling-conflicts-with-tailwind-merge-and-clsx-1dol).

## Testing

- Vitest. Co-locate tests as `*.test.ts(x)` next to the file under test.
- Every PR must at least reach **>= 80%** coverage.
