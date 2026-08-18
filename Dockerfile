# Nexuss-Agent — full application image with server-side authentication callbacks.
FROM node:22-slim

WORKDIR /app

# The full source is copied before installation because the lockfile references local patches.
COPY . .
RUN npm install -g corepack@latest \
  && corepack pnpm install --frozen-lockfile \
  && corepack pnpm run build

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "dist/index.js"]
