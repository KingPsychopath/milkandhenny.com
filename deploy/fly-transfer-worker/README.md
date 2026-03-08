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
  R2_ACCOUNT_ID=... \
  R2_ACCESS_KEY=... \
  R2_SECRET_KEY=... \
  R2_BUCKET=...
```

Recommended runtime defaults:

- `MEDIA_PROCESSOR_MODE=hybrid`
- `TRANSFER_MEDIA_WORKER_ENABLED=1`
- `TRANSFER_MEDIA_QUEUE_ENABLED=1`
- `TRANSFER_MEDIA_FORCE_WORKER_FOR_HEIF=1`
- `TRANSFER_MEDIA_FORCE_WORKER_FOR_RAW=0`
- `TRANSFER_MEDIA_FORCE_WORKER_FOR_VIDEO=0`

Operational notes:

- The worker is a background poller, not a public HTTP service.
- Browser uploads can still do local browser prep first.
- In `hybrid` mode, the app still tries local processing for supported formats and only uses the worker for worker-first routes or local failures.
- Flip `MEDIA_PROCESSOR_MODE=local` or `TRANSFER_MEDIA_WORKER_ENABLED=0` to degrade back to local-only behavior.
