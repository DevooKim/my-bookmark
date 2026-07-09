# syntax=docker/dockerfile:1
# Build context is the repository root (see docker-compose.yml).

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
RUN pnpm fetch
COPY packages ./packages
COPY apps/api ./apps/api
RUN pnpm install --frozen-lockfile --offline --filter @my-bookmark/api...
# tsup bundles @my-bookmark/* workspace sources and the AI SDKs into dist;
# only apps/api's own dependencies stay external.
RUN pnpm --filter @my-bookmark/api build

FROM base AS prod-deps
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
RUN pnpm fetch --prod && \
    pnpm install --frozen-lockfile --offline --prod --filter @my-bookmark/api

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=prod-deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY apps/api/package.json ./apps/api/package.json
EXPOSE 3001
USER node
CMD ["node", "apps/api/dist/index.js"]
