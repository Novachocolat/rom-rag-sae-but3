# Changelog

**All notable changes to this project are documented here.**

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Please, follow these types of changes:

- `Added` for new features.
- `Changed` for changes in existing functionality.
- `Deprecated` for soon-to-be removed features.
- `Removed` for now removed features.
- `Fixed` for any bug fixes.
- `Security` in case of vulnerabilities.

_The changelog must only be updated at the end of the day, **not at every single
commit!**_

## [Unreleased] - 2026-09-12

### Added

- Add an Express server with default configuration (helmet, CORS, JSON)
- Add `GET /api/health` endpoint to get a per-dependency (PostgreSQL, Redis)
  health state of the backend server
- Add root devDependencies (concurrently + yaml for workflows) + Docker scripts
- Add docker-compose services to build the monorepo
- Add a test `User` model + initial Prisma migration to see if PostgreSQL is
  healthy
- Add README.md with team members, stack, getting started, ...

### Changed

- Updated docs
- `shared/types` and `shared/schemas` moved into `shared/scr` for functional
  build
- Renamed files (e.g. `health.test.ts` -> `health.routes.test.ts`)
- TypeScript is now set to version 6.0.3 for the whole monorepo

### Removed

- Empty backend files (`/service/core.ts`, `/service/utils.ts`,
  `/storage/base.ts`, `/client/llm.ts`, `/client/embedding.ts`,
  `/client/base.ts`)
- Empty Nginx configuration file
- Empty Dockerfile-s in `backend` and `frontend`
- Removed string interpolation in `.env.example` as dotenv does not interpolate
  strings (Docker does!)

### Fixed

- Fixed typos in `.dat` file names

## [Unreleased] - 2026-09-10

### Added

- New documentation (ADRs, README, CONVENTIONS, CHANGELOG, etc.) files for
  easier management
- Bruno collection to test API requests with a development environment
- Simple dataset with 3 example `.dat` files (Game Boy, Nintendo 64, Wii)

### Changed

- Move `envSchema` to `@repo/shared`
- Documented `.editorconfig` for the team's knowledge

## [Unreleased] - 2026-09-09

### Added

- GitHub Actions workflow with configured Pull Request checks
- Pull Request template for GitHub

## [Unreleased] - 2026-09-07

### Added

- Monorepo scaffolding (shared/backend/frontend workspaces)
- Prettier, oxlint, Husky, commitlint setup
- Docker Compose for dev and prod, Nginx reverse proxy
- Prisma + PostgreSQL + Redis backend scaffold
