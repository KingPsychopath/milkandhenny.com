# Fly Transfer Media Worker

Deploy from the repo root:

```bash
fly deploy -c deploy/fly-transfer-worker/fly.toml
```

Required secrets:

```bash
fly secrets set \
  KV_REST_API_URL=... \
  KV_REST_API_TOKEN=... \
  REDIS_URL=... \
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY=... \
  R2_SECRET_KEY=... \
  R2_BUCKET=...
```

`REDIS_URL` should be a direct Redis connection string such as:

```bash
rediss://default:<password>@<host>:6379
```

If you prefer discrete fields instead of `REDIS_URL`, set:

```bash
fly secrets set \
  UPSTASH_REDIS_HOST=... \
  UPSTASH_REDIS_PORT=6379 \
  UPSTASH_REDIS_PASSWORD=... \
  UPSTASH_REDIS_USERNAME=default
```

Recommended runtime defaults:

- `MEDIA_PROCESSOR_MODE=hybrid`
- `TRANSFER_MEDIA_WORKER_ENABLED=1`
- `TRANSFER_MEDIA_QUEUE_ENABLED=1`
- `TRANSFER_MEDIA_FORCE_WORKER_FOR_RAW=0`
- `TRANSFER_MEDIA_FORCE_WORKER_FOR_VIDEO=0`

Operational notes:

- The worker uses a blocking direct Redis consumer (`BRPOPLPUSH` + processing list), not REST polling.
- Browser uploads must convert HEIC/HIF client-side before transfer upload.
- In `hybrid` mode, the app still tries local processing for supported formats and only uses the worker for worker-first routes or local failures.
- Flip `MEDIA_PROCESSOR_MODE=local` or `TRANSFER_MEDIA_WORKER_ENABLED=0` to degrade back to local-only behavior.
