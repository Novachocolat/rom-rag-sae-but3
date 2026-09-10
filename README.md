# ROM RAG

## About

[Décrire en 2-3 phrases le problème métier résolu par ROM RAG : contexte SAE
BUT3, cas d'usage du système RAG (Retrieval-Augmented Generation), et pourquoi
ce projet existe. À compléter par l'équipe.]

## Table des matières

- 🪧 [À propos](#à-propos)
- 📦 [Prérequis](#prérequis)
- 🚀 [Installation](#installation)
- 🛠️ [Utilisation](#utilisation)
- 🤝 [Contribution](#contribution)
- 🏗️ [Construit avec](#construit-avec)
- 📚 [Documentation](#documentation)
- 🏷️ [Gestion des versions](#gestion-des-versions)
- 📝 [Licence](#licence)

## Prérequis

- [Node.js](https://nodejs.org/) >= 22 (utilise les npm workspaces)
- [npm](https://docs.npmjs.com/cli/) >= 11
- [Docker](https://docs.docker.com/get-docker/) et
  [Docker Compose](https://docs.docker.com/compose/) (v2, intégré à Docker
  Desktop)
- [Git](https://git-scm.com/)

## Installation

```bash
git clone https://github.com/Novachocolat/rom-rag-sae-but3.git
cd rom-rag-sae-but3

cp .env.example .env    # renseigner les valeurs locales (DB, Redis, ports…)

npm install              # installe les 3 workspaces (shared, backend, frontend)
npm run build:shared     # compile shared/ (requis avant de lancer backend/frontend)
npm run db:generate       # génère le client Prisma
```

## Utilisation

### En local (sans Docker)

```bash
npm run dev             # lance shared (watch), backend et frontend en parallèle
npm run db:migrate       # applique les migrations Prisma (nécessite Postgres démarré)
npm run db:studio        # ouvre Prisma Studio
```

### Avec Docker

```bash
npm run docker:dev       # stack complète (Postgres, Redis, backend, frontend) en mode dev
npm run docker:prod      # build + démarrage des images de production (Nginx, backend)
```

### Qualité de code

```bash
npm run format           # formate le code avec Prettier
npm run lint              # vérifie le code avec oxlint
npm run lint:fix           # corrige automatiquement ce qui peut l'être
npm run ts:check           # vérifie les types TypeScript sur les 3 workspaces
npm test                  # lance les tests (Vitest) sur les 3 workspaces
```

## Contribution

Voir [CONTRIBUTING.md](./CONTRIBUTING.md) pour le détail du flux de contribution
(branches, commits, pull requests) et [CONVENTIONS.md](./CONVENTIONS.md) pour
les conventions de code.

En résumé :

- Les commits suivent la spécification
  [Conventional Commits](https://www.conventionalcommits.org/) (vérifié
  automatiquement par commitlint via un hook Husky).
- Toute modification passe par une pull request vers `dev`, avec au moins une
  revue approuvée avant fusion (règle appliquée par GitHub).

## Construit avec

### Langages & Frameworks

- [TypeScript](https://www.typescriptlang.org/) — langage utilisé sur l'ensemble
  du monorepo (frontend, backend, shared)
- [React](https://react.dev/) — bibliothèque UI du frontend
- [Express](https://expressjs.com/) — framework HTTP du backend
- [Prisma](https://www.prisma.io/) + [PostgreSQL](https://www.postgresql.org/) —
  ORM et base de données relationnelle
- [Redis](https://redis.io/) (via [ioredis](https://github.com/redis/ioredis)) —
  cache / stockage clé-valeur
- [Zod](https://zod.dev/) — schémas de validation partagés entre frontend et
  backend (`shared/`)
- [TailwindCSS](https://tailwindcss.com/) + [shadcn/ui](https://ui.shadcn.com/)
  — design system du frontend
- [Redux Toolkit](https://redux-toolkit.js.org/) — état global côté frontend
- [TanStack Query](https://tanstack.com/query) — gestion des requêtes serveur
  côté frontend

### Outils

#### CI

[À configurer — GitHub Actions n'est pas encore en place. Prévu : un workflow
exécutant `format:check`, `lint`, `ts:check` et `test` sur chaque pull request.]

#### Déploiement

- [Docker](https://www.docker.com/) /
  [Docker Compose](https://docs.docker.com/compose/) — conteneurisation des
  services (backend, frontend, Postgres, Redis)
- [Nginx](https://nginx.org/) — sert le build statique du frontend et fait
  office de reverse proxy vers le backend en production

## Documentation

- [docs/adr/](./docs/adr/) — Architecture Decision Records (choix techniques
  structurants et leur justification)

## Gestion des versions

Afin de maintenir un cycle de publication claire et de favoriser la
rétrocompatibilité, la dénomination des versions suit la spécification décrite
par la [Gestion sémantique de version](https://semver.org/lang/fr/)

Les versions disponibles ainsi que les journaux décrivant les changements
apportés sont disponibles depuis
[la page des Releases](https://github.com/Novachocolat/rom-rag-sae-but3/releases).

## Licence

[Aucune licence n'a encore été choisie — le fichier `LICENSE.md` référencé
ci-dessous n'existe pas encore. À décider avec l'équipe/l'encadrement (projet
académique : souvent "All rights reserved" ou une licence permissive type MIT).]

Voir le fichier [LICENSE](./LICENSE.md) du dépôt.
