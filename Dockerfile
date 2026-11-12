FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

# Trivy (vulnerability scanner), pinned by version and sha256. Runs on the build host; only downloads.
FROM --platform=$BUILDPLATFORM alpine:3.22 AS trivy
ARG TARGETARCH
ARG TRIVY_VERSION=0.76.2
ARG TRIVY_SHA256_AMD64=bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf
ARG TRIVY_SHA256_ARM64=ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3
RUN apk add --no-cache curl \
 && case "$TARGETARCH" in \
      amd64) A=64bit; SUM="$TRIVY_SHA256_AMD64" ;; \
      arm64) A=ARM64; SUM="$TRIVY_SHA256_ARM64" ;; \
      *) echo "unsupported architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
 && F="trivy_${TRIVY_VERSION}_Linux-${A}.tar.gz" \
 && curl -fsSL -o "/tmp/$F" "https://github.com/aquasecurity/trivy/releases/download/v${TRIVY_VERSION}/$F" \
 && echo "$SUM  /tmp/$F" | sha256sum -c - \
 && tar -xzf "/tmp/$F" -C /usr/local/bin trivy

FROM node:22-alpine
LABEL org.opencontainers.image.title="Captain" \
      org.opencontainers.image.description="Secure your Docker containers: audit risky settings, scan images for vulnerabilities, and manage everything from one small dashboard." \
      org.opencontainers.image.source="https://github.com/aimansam/captain" \
      org.opencontainers.image.licenses="MIT"
RUN apk add --no-cache docker-cli docker-cli-compose docker-cli-buildx
COPY --from=trivy /usr/local/bin/trivy /usr/local/bin/trivy
RUN mkdir -p /data
WORKDIR /app
ENV NODE_ENV=production WEB_DIR=/app/web-dist DATA_DIR=/data
COPY server/package.json ./
RUN npm install --omit=dev --omit=optional
COPY server/src ./src
COPY --from=web /web/dist ./web-dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
