# syntax=docker/dockerfile:1
# Build context is the repository root (see docker-compose.yml).
# VITE_* values are baked into the client bundle at build time.

FROM docker.io/oven/bun:1.4.0-alpine AS base
WORKDIR /app

FROM base AS build
ENV NITRO_PRESET=node-server
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_API_URL
ARG VITE_VAPID_PUBLIC_KEY
ARG VITE_NAVER_MAP_CLIENT_ID
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_API_URL=$VITE_API_URL \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY \
    VITE_NAVER_MAP_CLIENT_ID=$VITE_NAVER_MAP_CLIENT_ID
COPY bun.lock bunfig.toml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/
RUN bun install --frozen-lockfile --filter @my-bookmark/web
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN bun run --filter @my-bookmark/web build

FROM docker.io/library/caddy:2-alpine AS runtime
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/.output/public /srv
EXPOSE 3000
