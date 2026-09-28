# Media worker

RAW previews and video posters cost seconds of CPU and can pull gigabytes off
object storage. Doing that on the request that finalises an upload makes the
upload slow and competes with the CPU serving the gallery. So the heavy routes
go through a queue, and a second service drains it.

---

## Shape

**One image, two roles.** The web service and the media worker deploy the same
Dockerfile with the same start command. The only difference is one variable:

```dotenv
MEDIA_WORKER_ROLE=worker
```

A nitro startup plugin reads it and, on the worker, starts the drain loop
alongside the normal server. The worker still answers `/api/health` so Railway
can supervise it.

The shared Media `ManagedRuntime` owns worker fibers, processing deadlines, bounded concurrency,
recovery telemetry, and private-transfer orchestration. Postgres owns the queue, processing
leases, transfer records, and worker status; R2 owns the files. Effect owns execution lifecycle,
not durable state. See [durable work](./durable-work.md) and
[worker status](./media-worker-status-postgres.md).

### Postgres worker credentials

After the Postgres transfer migrations are applied, run
[`ops/postgres-media-worker-role.sql`](../ops/postgres-media-worker-role.sql) as the schema owner.
It grants the `mah_media_worker` role access to the migration ledger and transfer/media execution
tables, read-only album and photo references, and permission to advance an album publication
status. Create a separate login with a password, grant it this role, and give its connection
URL only to the media-worker service. The role has no credential, ticket, or checkout-table access.
The script grants no default privileges, so rerun it after later migrations add worker tables.

The Postgres worker must use `DATABASE_SCHEMA_MODE=verify`, `TRANSFER_CATALOGUE_STORE=postgres`,
`TRANSFER_MEDIA_JOB_STORE=postgres`, `MEDIA_WORKER_STATUS_STORE=postgres`,
`TRANSFER_MEDIA_EVENT_BACKPLANE=postgres`, and `TRANSFER_OBJECT_DELETION_RUNNER=postgres`.
When `ALBUM_STORE=postgres`, set `ALBUM_OBJECT_DELETION_RUNNER=postgres` as well so album public
copies and public/private deletes are retried by this worker.
The worker verifies the migration ledger without
reading Pitch documents. Its web counterpart still performs the full Pitch document check.
Production uses this mode. The accepted Redis export was imported, source objects reconciled, and
the separate worker release passed its recovery checks.
The worker registers its close hook before async startup; Node signals drain that hook and close
the process-wide Postgres pool after the worker records its stopped state.

There is no second build, no separate worker bundle, and no way for the
worker's copy of the processing code to drift from the app's — it _is_ the
app's.

The roles do not share the same secret set. The web service owns user-facing
authentication (`ADMIN_PASSWORD` and `UPLOAD_PIN`) and payment,
email, and database credentials. The media worker does not receive those
secrets. It needs its scoped database credential and private R2 credentials. When album operations
are enabled, it also needs a credential scoped to the
public R2 bucket for publication and deletion.

`/api/health` is role-aware. Web readiness checks the site and its required
dependencies; worker readiness checks the worker runtime, required Postgres capabilities, and
private media storage configuration. This prevents an
unrelated web login secret from taking a healthy worker out of service while
keeping the readiness request independent of a slow object-storage control
plane.

|                        | web             | media-worker       |
| ---------------------- | --------------- | ------------------ |
| `MEDIA_WORKER_ROLE`    | `web` (default) | `worker`           |
| `MEDIA_PROCESSOR_MODE` | `hybrid`        | `hybrid`           |
| Serves traffic         | yes             | health checks only |
| Drains the queue       | no              | yes                |
| Public domain          | yes             | none               |

## What goes where

| Route                                                   | Where it runs | Why                             |
| ------------------------------------------------------- | ------------- | ------------------------------- |
| `local_image` (JPEG, PNG, WebP, TIFF, HEIF)             | inline, web   | sub-second in Sharp             |
| `local_gif`                                             | inline, web   | one frame, then Sharp           |
| `raw_try_local` (DNG, ARW, CR2/CR3, NEF, ORF, RAF, RW2) | queued        | exiftool + Sharp, large sources |
| `local_video` (MP4, MOV, WebM, AVI, MKV, M4V, WMV, FLV) | queued        | ffmpeg, sources up to gigabytes |
| everything else                                         | passthrough   | stored as-is, no derivatives    |

Both roles have `ffmpeg` and `exiftool` in the image, so the split is about
_resources_, not capability.

## Modes

```dotenv
MEDIA_PROCESSOR_MODE=local    # everything inline, no queue — the default, and right for development
MEDIA_PROCESSOR_MODE=hybrid   # heavy routes queued for the worker
```

In `local` mode the queue is disabled outright and a worker-role instance logs
a warning and stays idle — a queue with no consumer is worse than no queue.

## Live updates

A file queued for the worker reaches the browser as `original_only` — no
preview yet. With `TRANSFER_MEDIA_EVENT_BACKPLANE=postgres`, the worker publishes
a file wake on `transfer_media_events_v1`. Each web process holds one Postgres
LISTEN connection, reads the committed file state, and streams it through
`GET /api/transfers/:id/events` as SSE.

The SSE route sends a current snapshot after subscribing. If the Postgres
backplane reconnects while browser streams remain open, it refreshes every
subscribed transfer after restoring LISTEN to recover updates missed during the
outage. The Media runtime shutdown closes the shared subscriber, including any
connection still being established, before the process closes its Postgres pool.

The gallery opens the stream only while something is outstanding and closes it
when everything is ready, so idle pages hold no connection. Cost scales with
work done, not with viewers — the failure mode recorded in
[postmortem-guestlist-kv-read-spike.md](./postmortem-guestlist-kv-read-spike.md).

If the selected backplane cannot subscribe, the route reports `unavailable`
and the client closes the stream instead of reconnecting forever.

## Delivery, retries, and idempotency

- **At-least-once.** A transfer mutation and its media job commit together in Postgres. The
  worker claims a job with a lease and marks it complete only after the result is committed.
- **Recovery respects leases.** An expired claim can be recovered after a crash without stealing
  work from a healthy worker.
- **Replays are safe.** A job whose file is already `local_done`/`worker_done`
  is skipped, derivative keys are deterministic so re-uploads overwrite, and a
  job for a deleted file finds nothing to update.
- **Terminal failures are not retried.** `raw_preview_unavailable` is a property
  of the file, not of the attempt. Retrying costs a download and a decode and
  ends in the same state, so the answer is recorded once. Everything else
  retries up to three times.
- **Nothing runs unbounded.** One job may take `MEDIA_WORKER_JOB_TIMEOUT_MS`
  (default 10 min) before it is failed and acked rather than requeued —
  retrying a job that already blew its budget would just wedge the next slot.

## Reconciliation

An interrupted job can leave a file queued or processing without a current claim. The Postgres
reconciler finds retryable failed files and queued or processing files older than 15 minutes that
have no pending job or live claim. It checks candidates in bounded batches of 100 and rechecks
each file under its row lock before enqueueing, so overlapping runs cannot duplicate the repair.
It does not treat a ready file as missing solely because a derivative later disappears from R2;
an object audit or explicit reprocess is needed for that case.

Two paths run reconciliation:

1. **The worker's independent repair timer** (`MEDIA_RECONCILE_INTERVAL_MS`,
   default 15 min). It runs independently of job claims and rechecks expired
   processing leases.
2. **The web scheduler's daily maintenance run**, under a Postgres lease.
   This is the backstop for the case the worker sweep cannot cover: the worker
   itself being down.

The sweep skips terminal failures, including `raw_preview_unavailable`. It does not repeatedly
download and decode files that cannot produce a preview.

## Configuration

| Variable                             | Default  | Applies to | Meaning                                         |
| ------------------------------------ | -------- | ---------- | ----------------------------------------------- |
| `MEDIA_PROCESSOR_MODE`               | `local`  | both       | `local` or `hybrid`                             |
| `MEDIA_WORKER_ROLE`                  | `web`    | both       | `web` or `worker`                               |
| `MEDIA_WORKER_CONCURRENCY`           | `1`      | worker     | jobs in flight per instance                     |
| `MEDIA_WORKER_JOB_TIMEOUT_MS`        | `600000` | worker     | per-job ceiling                                 |
| `MEDIA_WORKER_ERROR_BACKOFF_MS`      | `15000`  | worker     | pause after a claim error                       |
| `MEDIA_WORKER_HEARTBEAT_INTERVAL_MS` | `300000` | worker     | liveness write interval; minimum 30 seconds     |
| `MEDIA_RECONCILE_INTERVAL_MS`        | `900000` | worker     | periodic sweep for stranded files; `0` disables |
| `MEDIA_INLINE_PROCESSING_TIMEOUT_MS` | `120000` | web        | ceiling for work the request path still does    |
| `DATABASE_URL`                       | —        | both       | scoped Postgres connection for queue and state  |
| `TRANSFER_UPLOAD_URL_TTL_SECONDS`    | `21600`  | web        | how long a batch has to finish uploading        |

## Operating it

Health and queue depth appear in the admin dashboard and in
`GET /api/cron/process-transfer-media`. Worth alerting on:

- **stale heartbeat** — the worker writes one every five minutes by default.
  Nothing for two configured intervals means it is down or wedged.
- **growing queue depth** — arrivals outpacing the worker; raise
  `MEDIA_WORKER_CONCURRENCY` or add a replica.
- **repeated retry exhaustion** — something is failing that is not terminal.
- **a reconcile sweep that keeps finding work** — files are being stranded
  faster than they are processed, which usually means the worker is flapping.

The worker claims from the leased Postgres media queue. Shutdown stops intake and interrupts the
scoped worker fibers. A job interrupted after claim remains recoverable through its processing
lease; shutdown does not pretend every in-flight provider call definitively failed or completed.

Scaling out is safe: the queue is the coordination point, and recovery skips
every processing entry whose lease is still current.

## Rebuilding finished files

Reconciliation deliberately leaves `ready` files alone — nothing about their
recorded state says anything is wrong. But when the pipeline itself learns
something new (a metadata field we did not used to read, a decode bug fixed),
existing derivatives are stale in a way no inspection can detect.

That is what `mode: "reprocess"` on `POST /api/admin/transfers/process-media`
is for — an explicit "do it again" for a chosen set. Admin plus step-up:

```jsonc
{ "mode": "reprocess", "transferId": "abc123", "kind": "video" }   // every video
{ "mode": "reprocess", "transferId": "abc123", "mediaId": "IMG_1741" } // just one
```

It force-requeues matching files regardless of their current state and returns
the ids it queued. Files with no worker route (audio, documents) are reported
as skipped rather than silently ignored.

## Cutover

Order matters. Setting `hybrid` before a worker exists queues jobs nobody
drains.

1. Deploy the code and the `media-worker` service, with the worker on
   `MEDIA_PROCESSOR_MODE=hybrid` and the web service still on `local`.
2. Confirm the worker is up and its heartbeat is fresh.
3. Set `MEDIA_PROCESSOR_MODE=hybrid` on the web service.

To roll back, set the web service to `local`; new uploads process inline again.
Drain whatever is already queued before removing the worker.
