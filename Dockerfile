# Vendor-neutral container image for statewave-admin.
# Builds the static bundle + the Node HTTP server, then runs the Node server.
# Works on any container runtime (Docker, containerd, Kubernetes, ECS, Nomad,
# Cloud Run, App Runner, Render, fly, etc.). No platform-specific config.

FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build

FROM node:20-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
# No node_modules copy needed — the server has zero npm runtime deps.
EXPOSE 8080
CMD ["node", "dist-server/index.js"]
