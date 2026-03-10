# Cloudflare Transfer Worker

This replaces the old Fly transfer worker with a Cloudflare Worker plus one Cloudflare Container.

Current intended use:
- transfer RAW preview generation via `exiftool`
- transfer video thumb/poster generation via `ffmpeg`
- word-media queue drain in the same singleton container

Files:
- Worker config: `deploy/cloudflare-transfer-worker/wrangler.jsonc`
- Container image: `deploy/cloudflare-transfer-worker/Dockerfile`
- Worker entrypoint: `deploy/cloudflare-transfer-worker/src/index.ts`
- Container server: `deploy/cloudflare-transfer-worker/container/server.ts`

## App envs

Set these on the Vercel app:

```bash
MEDIA_PROCESSOR_MODE=hybrid
TRANSFER_MEDIA_WAKE_URL=https://party-guest-list-transfer-worker.<your-subdomain>.workers.dev/wake
TRANSFER_MEDIA_WAKE_TOKEN=replace-with-a-long-random-secret
NEXT_PUBLIC_MULTI_FILE_ZIP_URL=https://party-guest-list-transfer-worker.<your-subdomain>.workers.dev/zip
NEXT_PUBLIC_MULTI_FILE_ZIP_MODE=auto
```

Hybrid mode keeps JPEG/PNG/GIF/HEIC inline and queues RAW/video immediately.
ZIP fallback mode:
- `auto`: use Worker ZIP only for non-streaming multi-file downloads when configured
- `client`: keep the legacy browser ZIP fallback
- `worker`: force the Worker ZIP path for non-streaming multi-file downloads

## Cloudflare setup

Install the worker project deps once:

```bash
cd deploy/cloudflare-transfer-worker
npm install
cd ../..
```

Deploy from the repo root so the container Docker build can copy the shared app files:

```bash
npx wrangler deploy -c deploy/cloudflare-transfer-worker/wrangler.jsonc
```

Required secrets on the Cloudflare worker:

```bash
npx wrangler secret put KV_REST_API_URL --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put KV_REST_API_TOKEN --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put REDIS_URL --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put R2_ACCOUNT_ID --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put R2_ACCESS_KEY --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put R2_SECRET_KEY --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put R2_BUCKET --config deploy/cloudflare-transfer-worker/wrangler.jsonc
npx wrangler secret put TRANSFER_MEDIA_WAKE_TOKEN --config deploy/cloudflare-transfer-worker/wrangler.jsonc
```

If you use discrete Upstash direct Redis fields instead of `REDIS_URL`, set those secrets too.

Set `R2_PUBLIC_URL` in `deploy/cloudflare-transfer-worker/wrangler.jsonc` to the same public media origin as `NEXT_PUBLIC_R2_PUBLIC_URL`.

## Endpoints

- `GET /health` returns worker health
- `POST /wake` validates the bearer token and tells the singleton container to start draining
- `POST /zip` streams a store-mode ZIP from the public media origin for Safari/Firefox-style fallback downloads
- container-private `POST /drain` returns `202` immediately and drains queues in the background

## Notes

- The container is singleton by design: one named instance, internal concurrency controlled by `TRANSFER_MEDIA_WORKER_CONCURRENCY`.
- `scripts/transfer-media-worker.ts` is now a one-shot local drain helper, not an HTTP server.
- The shared media pipeline remains in `features/media/processing.ts`; Cloudflare only replaces the runtime that executes the RAW/video path.
