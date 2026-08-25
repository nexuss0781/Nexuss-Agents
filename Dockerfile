# Nexuss-Agent — full application image with server-side authentication callbacks.
FROM node:22-slim

WORKDIR /app

# The full source is copied before installation because the lockfile references local patches.
COPY . .
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/* \
  && npm install -g corepack@latest \
  && corepack pnpm install --frozen-lockfile \
  && corepack pnpm run build

ENV NODE_ENV=production NEXUSS_PROJECTS_ROOT=/var/lib/nexuss-projects
EXPOSE 3000

CMD ["node", "dist/index.js"]
