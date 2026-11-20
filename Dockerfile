FROM node:22-alpine AS frontend
WORKDIR /work
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY src ./src
COPY public ./public
RUN npm run lint && npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /work
ARG GOPROXY=https://proxy.golang.org,direct
ENV GOPROXY=$GOPROXY
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
ARG BUILD_COMMIT=development
ARG BUILD_TIME=
ARG APP_VERSION=1.0.5
RUN test "$APP_VERSION" = "$(cat internal/buildinfo/version.txt | tr -d '\r\n')" \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w -X navigation/server/internal/buildinfo.Commit=${BUILD_COMMIT} -X navigation/server/internal/buildinfo.BuiltAt=${BUILD_TIME}" -o /out/navigation . \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/updater ./cmd/updater \
    && CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/start-navigation ./cmd/start-navigation

FROM alpine:3.22
RUN apk add --no-cache ca-certificates && mkdir -p /app/dist /data && chown 10001:10001 /data
WORKDIR /app
COPY --from=frontend /work/dist ./dist
COPY --from=backend /out/navigation ./navigation
COPY --from=backend /out/start-navigation ./start-navigation
COPY --from=backend /out/updater ./updater
COPY ASSET_NOTICES.md ./ASSET_NOTICES.md
ARG APP_VERSION=1.0.5
ARG BUILD_COMMIT=development
LABEL org.opencontainers.image.version=$APP_VERSION \
      org.opencontainers.image.revision=$BUILD_COMMIT \
      org.opencontainers.image.source="https://github.com/Qiangii/QiangMacNav" \
      io.qiangmacnav.update.protocol="1"
ENV HOST=0.0.0.0 PORT=8080 STATIC_DIR=/app/dist DB_PATH=/data/navigation.db
EXPOSE 8080
VOLUME /data
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s CMD wget -q -O /dev/null http://127.0.0.1:8080/api/bootstrap || exit 1
CMD ["/app/start-navigation"]
