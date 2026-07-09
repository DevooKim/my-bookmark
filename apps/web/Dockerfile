# syntax=docker/dockerfile:1
# Build context is the repository root (see docker-compose.yml).
# VITE_* values are baked into the client bundle at build time.

FROM node:22-alpine AS base
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_PUBLISHABLE_KEY
ARG VITE_API_URL
ARG VITE_VAPID_PUBLIC_KEY
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_PUBLISHABLE_KEY=$VITE_SUPABASE_PUBLISHABLE_KEY \
    VITE_API_URL=$VITE_API_URL \
    VITE_VAPID_PUBLIC_KEY=$VITE_VAPID_PUBLIC_KEY
COPY pnpm-workspace.yaml pnpm-lock.yaml package.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
RUN pnpm fetch
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
RUN pnpm install --frozen-lockfile --offline --filter @my-bookmark/web...
RUN pnpm --filter @my-bookmark/web build

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
# nitro's .output is self-contained (server bundle + client assets)
COPY --from=build /app/apps/web/.output ./.output
EXPOSE 3000
USER node
CMD ["node", ".output/server/index.mjs"]
