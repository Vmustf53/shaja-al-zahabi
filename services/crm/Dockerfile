# ══════════════════════════════════════════════════════════════════════════════
# crm-service — multi-stage Dockerfile
# Builds natively on M1 (linux/arm64) and via GitHub Actions buildx for
# linux/amd64 (VPS deployment later) — see SRS v2.1 Section 7.1
# ══════════════════════════════════════════════════════════════════════════════

# ── Stage 1: dependencies (includes devDependencies for any future build step) ──
FROM node:18-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm install

# ── Stage 2: production image — minimal, no dev dependencies ────────────────────
FROM node:18-alpine AS production
WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force

COPY src ./src

EXPOSE 3003

# DevOps note: HEALTHCHECK lets Docker/K8s know if the container is alive
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3003/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

# Run as non-root user — security best practice, built into the alpine image
USER node

CMD ["node", "src/index.js"]
