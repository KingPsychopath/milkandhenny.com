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

There is no second build, no separate worker bundle, and no way for the
worker's copy of the processing code to drift from the app's — it *is* the
app's.

| | web | media-worker |
| --- | --- | --- |
| `MEDIA_WORKER_ROLE` | `web` (default) | `worker` |
| `MEDIA_PROCESSOR_MODE` | `hybrid` | `hybrid` |
| Serves traffic | yes | health checks only |
| Drains the queue | no | yes |
| Public domain | yes | none |

## What goes where

| Route | Where it runs | Why |
| --- | --- | --- |
| `local_image` (JPEG, PNG, WebP, TIFF, HEIF) | inline, web | sub-second in Sharp |
| `local_gif` | inline, web | one frame, then Sharp |
| `raw_try_local` (DNG, ARW, CR2/CR3, NEF, ORF, RAF, RW2) | queued | exiftool + Sharp, large sources |
| `local_video` (MP4, MOV, WebM, AVI, MKV, M4V, WMV, FLV) | queued | ffmpeg, sources up to gigabytes |
| everything else | passthrough | stored as-is, no derivatives |

Both roles have `ffmpeg` and `exiftool` in the image, so the split is about
*resources*, not capability.

## Modes

```dotenv
MEDIA_PROCESSOR_MODE=local    # everything inline, no queue — the default, and right for development
MEDIA_PROCESSOR_MODE=hybrid   # heavy routes queued for the worker
```

`worker` is accepted as a deprecated alias for `hybrid`. It once meant "queue
without attempting locally first", but that distinction died with the
local-first attempt: the worker runs the same image as the web role, so a
decode the web role cannot do the worker cannot do either.

In `local` mode the queue is disabled outright and a worker-role instance logs
a warning and stays idle — a queue with no consumer is worse than no queue.

## Live updates

A file queued for the worker reaches the browser as `original_only` — no
preview yet. Rather than have clients poll, the worker publishes each state
change to the Redis channel `transfer:media:events`, every web replica
subscribes once per process, and `GET /api/transfers/:id/events` streams the
relevant ones to viewers of that transfer as SSE.

The gallery opens the stream only while something is outstanding and closes it
when everything is ready, so idle pages hold no connection. Cost scales with
work done, not with viewers — the failure mode recorded in
[postmortem-guestlist-kv-read-spike.md](./postmortem-guestlist-kv-read-spike.md).

If Redis has no direct connection configured the route reports `unavailable`
and the client closes the stream instead of reconnecting forever.

## Delivery, retries, and idempotency

- **At-least-once.** `BRPOPLPUSH` moves a job to a processing list; it is
  removed only after the job settles. A worker that dies mid-job leaves the job
  there, and the next worker start requeues it.
- **Recovery runs once, at startup.** A sweep cannot tell a crashed job from
  one another replica is working on right now, so the long-running loop never
  repeats it.
- **Replays are safe.** A job whose file is already `local_done`/`worker_done`
  is skipped, derivative keys are deterministic so re-uploads overwrite, and a
  job for a deleted file finds nothing to update.
- **Terminal failures are not retried.** `raw_preview_unavailable` and
  `video_too_large_for_poster` are properties of the file, not of the attempt.
  Retrying costs a download and a decode and ends in the same state, so the
  answer is recorded once. Everything else retries up to three times.
- **Nothing runs unbounded.** One job may take `MEDIA_WORKER_JOB_TIMEOUT_MS`
  (default 10 min) before it is failed and acked rather than requeued —
  retrying a job that already blew its budget would just wedge the next slot.

## Reconciliation

Jobs get lost. A worker dies between claiming a job and finishing it, a deploy
lands mid-flight, a derivative gets deleted from object storage. Each leaves a
file stuck: `queued` with no job behind it, `processing` with no worker on it,
or `ready` pointing at a thumbnail that is gone.

`backfillTransferMedia` repairs all of those — it re-derives each file's state
from what is actually in object storage and requeues whatever is genuinely
unfinished. Two things run it:

1. **The worker, whenever its queue goes idle** (`MEDIA_RECONCILE_INTERVAL_MS`,
   default 15 min — the staleness window, so a stranded file is repaired within
   about two windows). Idle is the cheapest moment to look for work that should
   have been in the queue.
2. **The daily maintenance run**, as `POST /api/cron/process-transfer-media`.
   This is the backstop for the case the worker sweep cannot cover: the worker
   itself being down.

Both take the same Redis lock (`transfer:media:reconcile-lock`), so overlap is
harmless — two backfills racing on one transfer would each write their own view
of the file list.

The sweep reads every live transfer in **one pipelined round trip** and filters
in memory, so a healthy transfer costs no object-storage calls at all. It only
descends into object storage for files that look unfinished, and it skips
terminal failures entirely.

What it does **not** do is retry `raw_preview_unavailable` or
`video_too_large_for_poster` — see the delivery section above. Those are
properties of the file, and a sweep every 15 minutes re-downloading and
re-decoding them forever would be the worst possible version of this.

## Configuration

| Variable | Default | Applies to | Meaning |
| --- | --- | --- | --- |
| `MEDIA_PROCESSOR_MODE` | `local` | both | `local` or `hybrid` |
| `MEDIA_WORKER_ROLE` | `web` | both | `web` or `worker` |
| `MEDIA_WORKER_CONCURRENCY` | `1` | worker | jobs in flight per instance |
| `MEDIA_WORKER_JOB_TIMEOUT_MS` | `600000` | worker | per-job ceiling |
| `MEDIA_WORKER_ERROR_BACKOFF_MS` | `15000` | worker | pause after a claim error |
| `MEDIA_RECONCILE_INTERVAL_MS` | `900000` | worker | idle sweep for stranded files; `0` disables |
| `MEDIA_INLINE_PROCESSING_TIMEOUT_MS` | `120000` | web | ceiling for work the request path still does |
| `MEDIA_VIDEO_POSTER_MAX_BYTES` | `2147483648` | worker | above this, skip the poster; `0` disables the cap |
| `REDIS_URL` | — | both | direct connection; required for the queue and for SSE |
| `TRANSFER_UPLOAD_URL_TTL_SECONDS` | `21600` | web | how long a batch has to finish uploading |

## Operating it

Health and queue depth appear in the admin dashboard and in
`GET /api/cron/process-transfer-media`. Worth alerting on:

- **stale heartbeat** — the worker writes one at least every 30s while idle.
  Nothing for several minutes means it is down or wedged.
- **growing queue depth** — arrivals outpacing the worker; raise
  `MEDIA_WORKER_CONCURRENCY` or add a replica.
- **repeated retry exhaustion** — something is failing that is not terminal.
- **a reconcile sweep that keeps finding work** — files are being stranded
  faster than they are processed, which usually means the worker is flapping.

The worker drains one queue, `transfer:media:queue`. A parallel word-media
queue used to be claimed on every idle pass; it had a consumer but no producer
— word uploads have always been processed inline by the finalize route — so it
was costing a blocking Redis call every loop to watch a queue nothing wrote to.
It is gone.

Scaling out is safe: the queue is the coordination point, and recovery only
runs at startup, so replicas do not steal each other's in-flight jobs.

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
