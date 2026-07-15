# Optional Cloudflare media worker

This deployment is not required for the core application and is intentionally disabled during the Railway migration.

It combines:

- a lightweight Cloudflare Worker for authenticated wake requests and streamed ZIP responses;
- a sleeping Cloudflare Container for ffmpeg, ExifTool, Sharp, RAW, and video processing;
- Redis for the durable queue;
- R2 for originals and derivatives.

## Disabled state

The web application must use:

```dotenv
MEDIA_PROCESSOR_MODE=local
```

Do not configure a wake URL. `/health` should report advanced media processing as disabled, and the application must not accumulate worker jobs.

## Future enablement

Enable Cloudflare Workers Paid, then configure the worker/container with:

```text
REDIS_REST_URL
REDIS_REST_TOKEN
REDIS_URL (or direct UPSTASH_REDIS_* fields)
R2_ACCOUNT_ID
R2_ACCESS_KEY
R2_SECRET_KEY
R2_BUCKET
TRANSFER_MEDIA_WAKE_TOKEN
```

Configure the web application with the same wake-token value:

```dotenv
MEDIA_PROCESSOR_MODE=hybrid
TRANSFER_MEDIA_WAKE_URL=https://<worker-host>/wake
TRANSFER_MEDIA_WAKE_TOKEN=<shared-secret>
```

Before switching modes, verify:

1. `GET /health` on the Worker succeeds.
2. An unauthorized `/wake` request is rejected.
3. An authorized wake drains a disposable queue item.
4. Worker heartbeat and queue depth appear in admin diagnostics.
5. RAW and video derivatives are readable from the public media origin.

Use concurrency `1` initially. Raise it only after observing memory and CPU usage.
