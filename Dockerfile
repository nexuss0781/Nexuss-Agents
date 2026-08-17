# Nexuss-Agent frontend — production static SPA image.
# Build with: docker build -t nexuss-agent-frontend .
# Run with:   docker run --rm -p 8080:80 nexuss-agent-frontend

FROM node:22-alpine AS builder

WORKDIR /app

# Keep dependency installation reproducible and cache-friendly.
RUN corepack enable && corepack prepare pnpm@10.4.1 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

# Vite is configured with client/ as the source root and dist/public as output.
RUN pnpm exec vite build

FROM nginx:1.27-alpine AS runtime

LABEL org.opencontainers.image.title="Nexuss-Agent Frontend"
LABEL org.opencontainers.image.description="Dark-mode Nexuss-Agent static frontend playground"

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /app/dist/public /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
