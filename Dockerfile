# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS system
# ffmpeg powers video poster frames; exiftool recovers previews from RAW files.
# Tests exercise both tools, and both production roles shell out to them.
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*

FROM system AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# The sentence-embedding weights for same brain, fetched at build time rather than committed (23MB
# that never changes) or downloaded at boot (a live round would depend on the Hugging Face CDN).
# Its own stage so the layer caches: the weights are pinned and re-fetching them on every source
# change would be pure waste. A failure here is not fatal — the game scores on exact matches without
# them — so the build continues either way.
FROM dependencies AS model
COPY scripts/fetch-same-brain-model.ts ./scripts/
COPY tsconfig.cli.json tsconfig.json ./
# Created up front so the COPY in the runtime stage has something to copy even if the fetch fails.
RUN mkdir -p models && \
  (pnpm exec tsx --tsconfig tsconfig.cli.json scripts/fetch-same-brain-model.ts || \
  echo "same brain: continuing without embedding weights")

FROM dependencies AS build
ARG VITE_BASE_URL
ARG VITE_MEDIA_PUBLIC_URL
ARG VITE_TRANSFER_MEDIA_BROWSER_PREP=auto
ARG VITE_MULTI_FILE_ZIP_URL
ARG VITE_MULTI_FILE_ZIP_MODE=auto
ENV VITE_BASE_URL=$VITE_BASE_URL
ENV VITE_MEDIA_PUBLIC_URL=$VITE_MEDIA_PUBLIC_URL
ENV VITE_TRANSFER_MEDIA_BROWSER_PREP=$VITE_TRANSFER_MEDIA_BROWSER_PREP
ENV VITE_MULTI_FILE_ZIP_URL=$VITE_MULTI_FILE_ZIP_URL
ENV VITE_MULTI_FILE_ZIP_MODE=$VITE_MULTI_FILE_ZIP_MODE
COPY . .
# CI owns the full quality gate. The release image only compiles the verified source so
# one Docker layer does not retain the test runner and production bundler heaps together.
RUN pnpm build

FROM system AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/content ./content
# same brain reads these from ./models at runtime; absent, it scores on exact matches.
COPY --from=model --chown=node:node /app/models ./models
COPY --chown=node:node ops ./ops
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
