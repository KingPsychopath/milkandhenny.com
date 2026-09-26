# Postgres media worker status staging

Migration `0110_media_worker_instances` adds one row per worker process. Each process has a
random instance ID and an optional deployment ID (`MEDIA_WORKER_DEPLOYMENT_ID`, falling back to
`RAILWAY_DEPLOYMENT_ID`). Heartbeats, last processed time and last error are recorded on that row;
graceful shutdown marks it stopped. A dead process leaves a stale heartbeat for incident review.
The current status reader selects the freshest active instance, while
`listPostgresMediaWorkerInstances()` exposes every active row. Monitoring still needs an explicit
per-instance policy before cutover.

`MEDIA_WORKER_STATUS_STORE=postgres` opts into these writes and reads. It is unset in production.
The media job queue, processing leases, reconciliation lock and SSE event fan-out still use Redis.
Do not set this switch as a standalone production cutover. Apply it with the transfer queue and
worker migration so health, claims and jobs observe the same authority.

The supplied Redis export contains one `transfer:media:worker-status` hash. The pinned extractor
`ops/legacy-guest-rdb-extract.go` can write its four fields to a private JSON file as its last
optional output. The importer accepts that file and the verified RDB SHA-256:

```sh
DATABASE_URL="$RESTORE_DATABASE_URL" pnpm exec tsx --tsconfig tsconfig.cli.json \
  ops/import-media-worker-status.ts "$PRIVATE_WORKER_STATUS_JSON" "$VERIFIED_RDB_SHA256"
```

The import stores the source as a stopped `legacy-rdb` instance and records the source hash.
Re-running the same input is idempotent; conflicting input is refused. It never represents the
historical heartbeat as a currently running worker. Run this only against an isolated restore
until the fresh source delta is available and the planned maintenance cutover is authorized.
