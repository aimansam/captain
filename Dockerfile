FROM --platform=$BUILDPLATFORM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM node:22-alpine
LABEL org.opencontainers.image.title="Captain" \
      org.opencontainers.image.description="A tiny Docker dashboard that shows what's stale before you clean it." \
      org.opencontainers.image.source="https://github.com/aimansam/captain" \
      org.opencontainers.image.licenses="MIT"
WORKDIR /app
ENV NODE_ENV=production WEB_DIR=/app/web-dist
COPY server/package.json ./
RUN npm install --omit=dev --omit=optional
COPY server/src ./src
COPY --from=web /web/dist ./web-dist
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/index.js"]
