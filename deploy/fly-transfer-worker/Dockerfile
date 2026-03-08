FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  libvips-dev \
  libraw-dev \
  libheif-dev \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN corepack enable

COPY package.transfer-worker.json ./package.json
COPY tsconfig.worker.json ./
COPY scripts ./scripts
COPY features ./features
COPY lib ./lib

RUN pnpm install --prod --no-frozen-lockfile

ENV NODE_ENV=production
EXPOSE 8080

CMD ["pnpm", "worker:transfer-media"]
