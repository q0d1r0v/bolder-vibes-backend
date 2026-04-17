# Pin to a specific patch + Alpine version so the image is reproducible.
# Bump intentionally; do not track floating `:20-alpine` tags.
FROM node:20.18.1-alpine3.20 AS base

FROM base AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM base AS runner
WORKDIR /app
ENV NODE_ENV=production
# `wget` powers the HEALTHCHECK probe; `docker-cli` lets this container
# talk to the host Docker daemon (mounted /var/run/docker.sock) so the
# preview + APK build subcontainers can be spawned from inside.
RUN apk add --no-cache wget docker-cli && \
    addgroup --system --gid 1001 appgroup && \
    adduser --system --uid 1001 appuser
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
COPY --from=builder /app/prisma ./prisma
USER appuser
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/health || exit 1

# Migrations are NOT run here — a dedicated `migrate` service in
# docker-compose (or an init container in k8s) is responsible. Running
# migrations from every replica creates a race condition in production.
CMD ["node", "dist/src/main.js"]
