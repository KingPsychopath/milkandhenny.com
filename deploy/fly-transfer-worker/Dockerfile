FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  libvips-dev \
  libraw-dev \
  libraw-bin \
  libheif-dev \
  && ln -sf "$(command -v dcraw_emu)" /usr/local/bin/dcraw \
  && command -v dcraw_emu \
  && command -v dcraw \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable

COPY package.transfer-worker.json ./package.json
COPY deploy/fly-transfer-worker/pnpm-lock.yaml ./pnpm-lock.yaml
COPY tsconfig.worker.json ./
COPY scripts ./scripts
COPY features ./features
COPY lib ./lib

RUN pnpm install --prod --frozen-lockfile

ENV NODE_ENV=production
EXPOSE 8080

CMD ["./node_modules/.bin/tsx", "--tsconfig", "tsconfig.worker.json", "scripts/transfer-media-worker.ts"]
