FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable

COPY package.transfer-worker.json ./package.json
COPY tsconfig.worker.json ./
COPY scripts ./scripts
COPY features ./features
COPY lib ./lib
COPY deploy/cloudflare-transfer-worker/container ./deploy/cloudflare-transfer-worker/container

RUN pnpm install --prod --no-frozen-lockfile

ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080

CMD ["./node_modules/.bin/tsx", "--tsconfig", "tsconfig.worker.json", "deploy/cloudflare-transfer-worker/container/server.ts"]
