# syntax=docker/dockerfile:1
# Build context is the repository root (see docker-compose.yml).

FROM oven/bun:1.3.14-alpine AS base
WORKDIR /app

FROM base AS build
COPY bun.lock bunfig.toml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
RUN bun install --frozen-lockfile --filter @my-bookmark/api
COPY packages ./packages
COPY apps/api ./apps/api
# tsup bundles @my-bookmark/* workspace sources and the AI SDKs into dist;
# only apps/api's own dependencies stay external.
RUN bun run --filter @my-bookmark/api build

FROM base AS prod-deps
COPY bun.lock bunfig.toml package.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
RUN bun install --frozen-lockfile --production --filter @my-bookmark/api

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
EXPOSE 3001
USER node
CMD ["node", "apps/api/dist/index.js"]
