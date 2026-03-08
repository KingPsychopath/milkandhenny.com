# Fly Transfer Worker

This worker drains the transfer media queue for formats that are awkward or expensive to process on a serverless host.

Current intended use:
- HEIC/HIF fallback when browser prep does not convert successfully
- RAW fallback when local preview extraction fails
- Video fallback when local poster/thumb generation fails

Worker media stack:
- `ffmpeg` for video poster/thumb work
- `libheif` for HEIF/HIF fallback support
- `libraw-bin` / `dcraw_emu` for worker-side RAW decode

## Minimum envs

For most setups, you only need these app-side envs:

```bash
MEDIA_PROCESSOR_MODE=hybrid
NEXT_PUBLIC_TRANSFER_MEDIA_BROWSER_PREP=auto
TRANSFER_MEDIA_WORKER_ENABLED=1
TRANSFER_MEDIA_QUEUE_ENABLED=1
TRANSFER_MEDIA_FORCE_WORKER_FOR_HEIF=1
TRANSFER_MEDIA_WORKER_WAKE_URL=https://party-guest-list-transfer-worker.fly.dev/wake
TRANSFER_MEDIA_WORKER_WAKE_TOKEN=replace-with-a-long-random-secret
```

Cheap local-only fallback:

```bash
MEDIA_PROCESSOR_MODE=local
NEXT_PUBLIC_TRANSFER_MEDIA_BROWSER_PREP=auto
TRANSFER_MEDIA_WORKER_ENABLED=0
TRANSFER_MEDIA_QUEUE_ENABLED=0
```

Optional advanced knobs:

```bash
TRANSFER_MEDIA_FORCE_WORKER_FOR_RAW=0
TRANSFER_MEDIA_FORCE_WORKER_FOR_VIDEO=0
TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS=30000
```

## Files

- Fly config: `deploy/fly-transfer-worker/fly.toml`
- Dockerfile: `deploy/fly-transfer-worker/Dockerfile`
- Worker entrypoint: `scripts/transfer-media-worker.ts`
- Fly helper: `scripts/fly-worker.ts`

Repo helper commands:

```bash
pnpm fly:worker
pnpm fly:worker -- deploy
pnpm fly:worker -- logs
pnpm fly:worker -- status
pnpm fly:worker -- machines
pnpm fly:worker -- restart-all
pnpm fly:worker -- sync-secrets
pnpm worker:lock
```

## First-time setup

Login:

```bash
fly auth login
```

Create the app once:

```bash
fly apps create party-guest-list-transfer-worker
```

Set secrets:

```bash
fly secrets set \
  KV_REST_API_URL=... \
  KV_REST_API_TOKEN=... \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY=... \
  R2_SECRET_KEY=... \
  R2_BUCKET=... \
  TRANSFER_MEDIA_WORKER_WAKE_TOKEN=... \
  -a party-guest-list-transfer-worker
```

Sync directly from local `.env.local` without hand-copying values:

```bash
fly secrets set \
  KV_REST_API_URL="$(grep '^KV_REST_API_URL=' .env.local | cut -d= -f2-)" \
  KV_REST_API_TOKEN="$(grep '^KV_REST_API_TOKEN=' .env.local | cut -d= -f2-)" \
  R2_ACCOUNT_ID="$(grep '^R2_ACCOUNT_ID=' .env.local | cut -d= -f2-)" \
  R2_ACCESS_KEY="$(grep '^R2_ACCESS_KEY=' .env.local | cut -d= -f2-)" \
  R2_SECRET_KEY="$(grep '^R2_SECRET_KEY=' .env.local | cut -d= -f2-)" \
  R2_BUCKET="$(grep '^R2_BUCKET=' .env.local | cut -d= -f2-)" \
  TRANSFER_MEDIA_WORKER_WAKE_TOKEN="$(grep '^TRANSFER_MEDIA_WORKER_WAKE_TOKEN=' .env.local | cut -d= -f2-)" \
  -a party-guest-list-transfer-worker
```

Deploy from the repo root:

```bash
fly deploy -c deploy/fly-transfer-worker/fly.toml
```

Check logs:

```bash
fly logs -a party-guest-list-transfer-worker
```

Check status:

```bash
fly status -a party-guest-list-transfer-worker
```

## Updating later

After code changes:

```bash
fly deploy -c deploy/fly-transfer-worker/fly.toml
```

If secrets changed:

```bash
fly secrets set KEY=value -a party-guest-list-transfer-worker
```

Or re-sync the required worker secrets from `.env.local`:

```bash
fly secrets set \
  KV_REST_API_URL="$(grep '^KV_REST_API_URL=' .env.local | cut -d= -f2-)" \
  KV_REST_API_TOKEN="$(grep '^KV_REST_API_TOKEN=' .env.local | cut -d= -f2-)" \
  R2_ACCOUNT_ID="$(grep '^R2_ACCOUNT_ID=' .env.local | cut -d= -f2-)" \
  R2_ACCESS_KEY="$(grep '^R2_ACCESS_KEY=' .env.local | cut -d= -f2-)" \
  R2_SECRET_KEY="$(grep '^R2_SECRET_KEY=' .env.local | cut -d= -f2-)" \
  R2_BUCKET="$(grep '^R2_BUCKET=' .env.local | cut -d= -f2-)" \
  TRANSFER_MEDIA_WORKER_WAKE_TOKEN="$(grep '^TRANSFER_MEDIA_WORKER_WAKE_TOKEN=' .env.local | cut -d= -f2-)" \
  -a party-guest-list-transfer-worker
```

## Runtime defaults

Configured in `deploy/fly-transfer-worker/fly.toml`:

```bash
MEDIA_PROCESSOR_MODE=hybrid
NEXT_PUBLIC_TRANSFER_MEDIA_BROWSER_PREP=auto
TRANSFER_MEDIA_WORKER_ENABLED=1
TRANSFER_MEDIA_QUEUE_ENABLED=1
TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS=30000
TRANSFER_MEDIA_FORCE_WORKER_FOR_HEIF=1
```

Browser prep policy:
- keep browser prep for HEIC/HIF
- do not use browser RAW prep
- keep RAW/video as local-first with worker fallback

These defaults keep the pipeline simple while the worker blocks on Redis for new jobs.

## Cost

Rough monthly estimate:

- Fly `shared-cpu-1x 1GB`: about `$5-6/month`
- Fly `shared-cpu-1x 512MB`: about `$3.19/month`
- Fly `shared-cpu-1x 256MB`: about `$1.94/month`
- Upstash Redis:
  - free tier includes `500K` commands/month
  - after that, about `$0.20 / 100K` commands

Practical expectation with current polling defaults:

- Fly: about `$2-4/month`
- Upstash: usually free or very low unless polling is too aggressive or the queue is busy all day

Main cost risk is the machine footprint, not app-level polling. Keep:

```bash
TRANSFER_MEDIA_WORKER_ERROR_BACKOFF_MS=30000
```

## Troubleshooting

If deploy says Dockerfile not found:
- use `fly deploy -c deploy/fly-transfer-worker/fly.toml` from the repo root
- ensure `[build].dockerfile` in `deploy/fly-transfer-worker/fly.toml` is exactly:

```toml
[build]
  dockerfile = "Dockerfile"
```

If you need to disable the worker quickly:

App side:

```bash
MEDIA_PROCESSOR_MODE=local
NEXT_PUBLIC_TRANSFER_MEDIA_BROWSER_PREP=auto
TRANSFER_MEDIA_WORKER_ENABLED=0
TRANSFER_MEDIA_QUEUE_ENABLED=0
```

That degrades back to local-only behavior without removing functionality.

## What to set where

Vercel app:
- `MEDIA_PROCESSOR_MODE`
- `NEXT_PUBLIC_TRANSFER_MEDIA_BROWSER_PREP`
- `TRANSFER_MEDIA_WORKER_ENABLED`
- `TRANSFER_MEDIA_QUEUE_ENABLED`
- `TRANSFER_MEDIA_FORCE_WORKER_FOR_HEIF`
- same Redis/R2 envs the app already uses

Fly worker:
- Redis secrets
- R2 secrets
- worker polling envs from `fly.toml`

Fly only consumes jobs. Vercel still has to enqueue them.

## How to test

1. Check worker logs:

```bash
fly logs -a party-guest-list-transfer-worker
```

Healthy idle worker:
- starts without Redis/R2 errors
- no repeated crash loop

2. Ensure app envs are set on Vercel:

```bash
MEDIA_PROCESSOR_MODE=hybrid
NEXT_PUBLIC_TRANSFER_MEDIA_BROWSER_PREP=auto
TRANSFER_MEDIA_WORKER_ENABLED=1
TRANSFER_MEDIA_QUEUE_ENABLED=1
TRANSFER_MEDIA_FORCE_WORKER_FOR_HEIF=1
```

3. Redeploy the app after setting envs.

4. Upload a mixed batch:
- one JPEG/PNG
- one HEIC/HIF
- one RAW
- one video

5. Expected behavior:
- JPEG/PNG: local success, ready immediately
- HEIC/HIF: browser prep or queued worker fallback
- RAW: local first, worker fallback on failure
- video: local first, worker fallback on failure

6. Watch Fly logs during the upload:

```bash
fly logs -a party-guest-list-transfer-worker
```

Success signs:
- processed job counts increase
- no Upstash URL errors
- no repeated worker failures on the same item

If the worker is being OOM-killed:
- use `shared-cpu-1x` with `1024MB`
