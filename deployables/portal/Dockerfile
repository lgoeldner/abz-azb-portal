FROM node:24-alpine AS web-build
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

FROM golang:1.27.3-alpine AS go-build
RUN apk add --no-cache ca-certificates git
ENV GOWORK=off
WORKDIR /src/server
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
COPY --from=web-build /src/web/dist/ ./static/
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/portal ./cmd/portal

FROM alpine:3.22 AS runtime
RUN apk add --no-cache ca-certificates tzdata \
    && addgroup -S -g 10001 portal && adduser -S -D -H -u 10001 -G portal portal \
    && mkdir -p /app/static /var/lib/portal/uploads /var/lib/portal/status \
    && chown -R portal:portal /var/lib/portal \
    && chmod 0750 /var/lib/portal /var/lib/portal/uploads /var/lib/portal/status
COPY --from=go-build /out/portal /usr/local/bin/portal
COPY --from=go-build --chown=portal:portal /src/server/static/ /app/static/
USER portal
ENV APP_ENV=production ADDR=:8080 UPLOAD_DIR=/var/lib/portal/uploads STATIC_DIR=/app/static
EXPOSE 8080
ENTRYPOINT ["/usr/local/bin/portal"]
CMD ["serve"]
