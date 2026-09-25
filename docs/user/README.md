# @repo/docs

User-facing documentation site for ROM RAG, built with
[Astro Starlight](https://starlight.astro.build/). See
[ADR-013](../docs/adr/013-astro-starlight.md) for why this stack was chosen.

This is a workspace from [`docs/`](../docs), which holds the contributor-facing
technical documentation (architecture, ADRs, ...).

## Structure

Starlight looks for `.md`/`.mdx` files under `src/content/docs/`; each file
becomes a route named after its path.

```
docs/user/
├── src/content/docs/   # pages (Markdown/MDX)
├── src/assets/         # images referenced from pages
├── public/              # static assets (favicon, ...)
└── astro.config.mjs     # sidebar + Starlight config
```

## Commands

Run through Docker Compose from the repo root, same as the other services:

```
docker compose up docs   # dev server, http://localhost:4321
```

Or, from this workspace, with the monorepo's dependencies already installed:

| Command           | Action                                   |
| :---------------- | :--------------------------------------- |
| `npm run dev`     | Start the dev server at `localhost:4321` |
| `npm run build`   | Build the static site to `./dist/`       |
| `npm run preview` | Preview the production build locally     |
