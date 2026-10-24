FROM golang:1.27.3-alpine AS build
ENV GOWORK=off
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . ./
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/auth-mock .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates \
    && addgroup -S -g 10002 authmock && adduser -S -D -H -u 10002 -G authmock authmock
COPY --from=build /out/auth-mock /usr/local/bin/auth-mock
COPY users.yaml /config/users.yaml
USER authmock
ENV ADDR=:9090 AUTH_MOCK_USERS=/config/users.yaml
EXPOSE 9090
ENTRYPOINT ["/usr/local/bin/auth-mock"]
