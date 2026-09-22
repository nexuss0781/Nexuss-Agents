# Nexuss-Agent — full application image with server-side authentication callbacks.
FROM node:22-slim

WORKDIR /app

# Copy dependency metadata and local pnpm patches before installation. The lockfile
# references the patch path, so the patch must be present in the install layer.
COPY package.json pnpm-lock.yaml ./
COPY patches ./patches
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g corepack@latest \
  && corepack pnpm install --frozen-lockfile

# Copy application source only after dependencies are installed so source changes
# do not invalidate the dependency layer.
COPY . .
RUN corepack pnpm run build

ENV NODE_ENV=production NEXUSS_PROJECTS_ROOT=/var/lib/nexuss-projects
EXPOSE 3000

CMD ["node", "dist/index.js"]
