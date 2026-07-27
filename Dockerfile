# syntax=docker/dockerfile:1.7

FROM node:22-bookworm-slim AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@11.17.0 --activate
WORKDIR /app

FROM base AS dependencies
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

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
RUN pnpm build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3000
WORKDIR /app

# ffmpeg powers video poster frames; exiftool recovers previews from RAW files.
# Both the web role (inline images, RAW retry) and the worker role (video, RAW)
# shell out to these, so they belong in the shared runtime image.
RUN apt-get update && apt-get install -y --no-install-recommends \
  ffmpeg \
  libimage-exiftool-perl \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build --chown=node:node /app/.output ./.output
COPY --from=build --chown=node:node /app/content ./content
COPY --chown=node:node ops ./ops
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", ".output/server/index.mjs"]
