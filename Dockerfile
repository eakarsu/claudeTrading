# Multi-stage build: build the client, then produce a slim runtime image that
# serves the static bundle from the Express server.
#
# ── Stage 1: build the Vite client ──
FROM node:20-alpine AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

# ── Stage 2: install server deps (prod only) ──
FROM node:20-alpine AS server-deps
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

# ── Stage 3: final runtime ──
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
# Non-root user. Node images ship a "node" uid 1000 user by default.
WORKDIR /app

# Server code + prod deps
COPY --chown=node:node server/ ./server/
COPY --from=server-deps --chown=node:node /app/server/node_modules ./server/node_modules

# Built client bundle — served by the Express static handler.
COPY --from=client-build --chown=node:node /app/client/dist ./client/dist

USER node
EXPOSE 3001
WORKDIR /app/server

# Health probe uses /api/health. Docker will mark the container unhealthy if
# the liveness endpoint doesn't return 200 within the timeout.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://localhost:'+(process.env.SERVER_PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
