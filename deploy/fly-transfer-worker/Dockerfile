FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  libheif-dev \
  libraw-bin \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable

COPY package.json pnpm-lock.yaml tsconfig.json tsconfig.cli.json ./
COPY scripts ./scripts
COPY features ./features
COPY lib ./lib

RUN pnpm install --frozen-lockfile

ENV NODE_ENV=production

CMD ["pnpm", "worker:transfer-media"]
