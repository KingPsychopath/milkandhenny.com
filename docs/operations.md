# Operations

## Daily maintenance

Run once per day:

```bash
APP_BASE_URL=https://milkandhenny.com CRON_SECRET=… pnpm maintenance
```

The web process owns user-visible timed work through durable Postgres job leases: communication
fan-out, email delivery, scoring transitions and result recovery, Pitch reminders, and operations
digests. Every replica can recover the work, but only one lease holder runs a job at a time.

The daily runner drains the transactional-email outbox, applies email retention, then calls
transfer cleanup, Pitch Night cleanup, expired word-share cleanup, orphaned word-media cleanup, and
media reconciliation. It is the independent housekeeping and recovery backstop. Each job emits one
structured result, and the runner exits non-zero if any job fails.

## Capability checks

```bash
curl -fsS https://milkandhenny.com/api/health
```

Use `/health` for the safe human view. Use the admin-protected `/api/debug` only when diagnosing dependencies; it deliberately spends one Redis and one object-storage operation.

## Backups and restore

Follow [disaster-recovery.md](./disaster-recovery.md). Run the PostgreSQL archive daily and a restore drill before launch and every quarter. Keep the archive outside the deployment account. Configure a separate copy of permanent object storage; private transfers and live rooms expire and are not restored.

## Email delivery events

Follow [cloudflare-email-events.md](./cloudflare-email-events.md). Cloudflare Queue events are the authoritative path for bounce and complaint suppression. The initial REST response proves only that Cloudflare accepted the message.

The admin **communications → delivery** view and `pnpm cli email …` expose the same authenticated
ledger and controls. “Provider accepted” never means “delivered”: inbox delivery is shown only after
a provider event. The admin warns when accepted messages have no provider event after 15 minutes.

Email is deliberately transient:

- the outbox's message body and recipient-address copy are removed immediately after provider
  acceptance or a terminal failure;
- retryable content is removed after 7 days or 10 attempts;
- normalized provider delivery events are kept for 30 days;
- masked operational ledger metadata is kept for 120 days;
- bounce and complaint suppressions keep only a recipient hash and masked hint until an operator
  reviews them, because forgetting them would cause repeat delivery to a bad or objecting address.

Payment, refund, ticket and consent records have their own retention rules and are not deleted by
email cleanup. Run `pnpm cli email status` to inspect the policy, `pnpm cli email drain` to process
the queue, and `pnpm cli email cleanup --step-up` to apply retention immediately.

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

The worker's queue cost is proportional to work, not to time. Each concurrency
slot holds one indefinite blocking claim on its own Redis connection, so an
idle queue does not issue repeated commands. The only time-based writes are a
heartbeat every five minutes and a reconciliation sweep every 15 minutes.
