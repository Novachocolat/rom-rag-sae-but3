FROM node:24-alpine AS deps
WORKDIR /app
ENV CI=true
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --ignore-scripts

FROM deps AS build
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL
COPY tsconfig.base.json ./
COPY shared shared
COPY frontend frontend
RUN npm run build -w @repo/shared && npm run build -w @repo/frontend

FROM nginx:1.29-alpine AS prod
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html
EXPOSE 80