FROM node:22-slim

WORKDIR /app

COPY . .

RUN npm install -g corepack@latest \
  && corepack pnpm install \
  && corepack pnpm run build

ENV NODE_ENV=production

EXPOSE 3000

CMD ["sh", "-c", "sh scripts/write-runtime-config.sh && exec node dist/index.js"]

