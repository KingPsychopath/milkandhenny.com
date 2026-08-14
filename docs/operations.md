# Operations

## Daily maintenance

Run once per day:

```bash
APP_BASE_URL=https://milkandhenny.com CRON_SECRET=… pnpm maintenance
```

The runner drains the transactional-email outbox, then calls transfer cleanup, Pitch Night cleanup,
expired word-share cleanup, orphaned word-media cleanup, and media reconciliation. The web process
also drains email every five seconds; maintenance is its independent backstop. Each job emits one
structured result, and the runner exits non-zero if any job fails.

## Capability checks

```bash
curl -fsS https://milkandhenny.com/api/health
```

Use `/health` for the safe human view. Use the admin-protected `/api/debug` only when diagnosing dependencies; it deliberately spends one Redis and one object-storage operation.

## Runtime limits

- Start the web process at 512 MB–1 GB RAM and 0.5–1 vCPU.
- Keep one replica until observed traffic requires more.
- Before adding a second web replica, link direct Redis as `REDIS_URL`; otherwise WebSocket wake delivery is process-local.
- Do not attach a volume; application durability belongs in Redis, object storage, or git.
- Keep `MEDIA_PROCESSOR_MODE=local` while no media worker is running; a queue with no consumer only accumulates.
- Set host-level memory and spending limits, but leave enough headroom for image transformations.
- Set `RAILWAY_DEPLOYMENT_DRAINING_SECONDS=30` so Nitro can close sockets and dispose the Effect runtime after `SIGTERM`.

`RAILWAY_DEPLOYMENT_DRAINING_SECONDS` is Railway lifecycle configuration, not part of the application environment contract. Application runtime metadata uses `APP_COMMIT_SHA` and `APP_INSTANCE_ID`; Railway-provided metadata is an optional deployment adapter.

## Multiplayer scaling

Each replica owns one managed Effect runtime, one bounded local socket registry, and—when `REDIS_URL` is configured—one Redis publisher and one Redis subscriber. Authoritative rooms remain in Redis REST storage; the direct connection carries advisory cross-replica wake events only.

The admin system-health panel reports the current replica and whether fan-out is `local` or `redis`. Do not scale past one replica while it reports `local`. Sticky routing can reduce fan-out traffic but is not required for correctness once the Redis backplane is enabled.

Socket input is bounded by message size, message rate, wake frequency, per-room connections, and per-process connections. Rejected overloads use a retryable WebSocket close code. Durable HTTP reconciliation remains authoritative when a wake is delayed or lost.

## Deploy

1. Build and deploy the Dockerfile.
2. Wait for a successful terminal deployment state.
3. Verify `/api/health` and inspect bounded startup logs.
4. Exercise images, authentication, admin reads, uploads, and a disposable transfer.
5. Keep the prior deployment available until the observation window ends.

## Incident order

1. Check platform deployment state and restarts.
2. Check `/api/health`.
3. Inspect recent structured error logs by request ID/scope.
4. Use `/api/debug` to distinguish Redis, object-storage, lock contention, and realtime fan-out failure.
5. Roll back DNS or the deployment if a required flow is broken.
6. Rotate credentials only if exposure is suspected; rotation makes rollback harder.

## Media worker

Bring the worker up before switching the web service to `hybrid` — the reverse order queues jobs nobody drains. Full cutover and rollback order is in [media-worker.md](./media-worker.md#cutover).

The worker's Redis cost is proportional to work, not to time: one blocking claim per queue while idle, a heartbeat at most every 30s, and one publish per file processed.
