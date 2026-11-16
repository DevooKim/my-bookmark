# syntax=docker/dockerfile:1
# Build context is the repository root (see docker-compose.yml).
FROM docker.io/library/golang:1.27.4-alpine AS build
RUN apk add --no-cache build-base pkgconf vips-dev
WORKDIR /src/apps/api
COPY apps/api/go.mod apps/api/go.sum ./
RUN go mod download
COPY apps/api/cmd ./cmd
COPY apps/api/internal ./internal
RUN CGO_ENABLED=1 go build -trimpath -o /out/my-bookmark-api ./cmd/server

FROM docker.io/library/alpine:3.23
RUN apk add --no-cache ca-certificates tzdata vips && adduser -D -H -u 10001 api
COPY --from=build /out/my-bookmark-api /usr/local/bin/my-bookmark-api
ENV NODE_ENV=production PORT=3001
USER api
EXPOSE 3001
CMD ["/usr/local/bin/my-bookmark-api"]
