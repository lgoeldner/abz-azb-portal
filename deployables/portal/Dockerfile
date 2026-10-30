# syntax=docker/dockerfile:1.7
FROM node:24-alpine AS web-dev
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./

CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

FROM web-dev AS web-build
RUN npm run build

FROM golang:1.27.3-alpine AS go-build
RUN apk add --no-cache ca-certificates git
ENV GOWORK=off
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN --mount=type=cache,id=portal-go-mod,target=/go/pkg/mod go mod download
COPY server/ ./
RUN --mount=type=cache,id=portal-go-mod,target=/go/pkg/mod \
    --mount=type=cache,id=portal-go-build,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/portal ./cmd/portal

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 portal && adduser -S -D -H -u 10001 -G portal portal \
    && mkdir -p /app/static /var/lib/portal/uploads /var/lib/portal/status \
    && chown -R portal:portal /var/lib/portal \
    && chmod 0750 /var/lib/portal /var/lib/portal/uploads /var/lib/portal/status
COPY --from=go-build /out/portal /usr/local/bin/portal
COPY --chmod=0755 entrypoint.sh /usr/local/bin/portal-entrypoint
COPY --from=web-build --chown=portal:portal /src/web/dist/ /app/static/
USER portal
ENV APP_ENV=production ADDR=:8080 UPLOAD_DIR=/var/lib/portal/uploads STATIC_DIR=/app/static
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/portal-entrypoint"]
CMD ["serve"]
