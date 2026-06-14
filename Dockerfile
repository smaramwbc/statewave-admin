# Vendor-neutral container image for statewave-admin.
# Builds the static bundle + the Node HTTP server, then runs the Node server.
# Works on any container runtime (Docker, containerd, Kubernetes, ECS, Nomad,
# Cloud Run, App Runner, Render, fly, etc.). No platform-specific config.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
ARG APP_VERSION
RUN APP_VERSION=${APP_VERSION} npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# Bundled operator scripts. These are stdlib-only Node files runnable
# via `docker exec quickstart-admin-1 node /app/scripts/<name>.mjs`. The
# canonical one today is the encrypted-secrets recovery script — used
# when an operator forgets the admin password they generated via the
# UI wizard and the only on-disk copy is AES-256-GCM-encrypted with
# their STATEWAVE_ADMIN_MASTER_KEY.
COPY --from=build /app/scripts ./scripts
# No node_modules copy needed — the server has zero npm runtime deps.
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
