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

## [Unreleased] - 2026-09-10

### Added

- New documentation (ADRs, README, CONVENTIONS, CHANGELOG, etc.) files for
  easier management
- Bruno collection to test API requests with a development environment
- Simple dataset with 3 popular ROMs

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
