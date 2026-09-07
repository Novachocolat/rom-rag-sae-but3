FROM node:24-alpine AS base
WORKDIR /app
ENV CI=true

FROM base AS deps
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts

FROM deps AS build
COPY tsconfig.base.json ./
COPY shared shared
COPY backend backend
RUN npx prisma generate --schema backend/prisma/schema.prisma \
 && npm run build -w @repo/shared \
 && npm run build -w @repo/backend

FROM base AS prod
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --ignore-scripts --workspace @repo/backend --include-workspace-root

COPY --from=build /app/shared/dist shared/dist
COPY --from=build /app/backend/dist backend/dist
COPY --from=build /app/backend/prisma backend/prisma

USER node
EXPOSE 3000
CMD ["node", "backend/dist/server.js"]