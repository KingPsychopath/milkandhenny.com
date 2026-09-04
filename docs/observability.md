# Observability

## Signals

| Question                                              | Signal                                                 | Owner                   |
| ----------------------------------------------------- | ------------------------------------------------------ | ----------------------- |
| Is the process configured to serve traffic?           | `GET /api/health`                                      | Web runtime             |
| Which core and optional capabilities are enabled?     | `GET /health`                                          | Capability model        |
| Can Redis and object storage actually be reached?     | Admin `GET /api/debug`                                 | Platform adapters       |
| Did an API workflow succeed and how long did it take? | Structured JSON request/domain logs                    | Route and feature owner |
| Did scheduled cleanup run?                            | `maintenance.request` plus cleanup completion events   | Maintenance runner      |
| Is the optional worker alive and draining?            | Worker heartbeat, queue depth, completion/error events | Media worker            |
| Is multiplayer healthy on this replica?               | Admin multiplayer runtime panel                        | Multiplayer runtime     |
| Are replicas sharing realtime wakes?                  | Backplane mode/publication/failure counters            | Realtime backplane      |
| Is transactional email draining?                      | Admin `GET /api/debug` email-outbox snapshot           | Email outbox            |

## Health semantics

`/api/health` checks the live required dependencies, returns `Cache-Control: no-store`, and uses status 503 when a required capability is unavailable. Its probes are bounded and do not expose credentials, hostnames, or raw provider errors. Optional maintenance or worker degradation remains visible without failing platform readiness.

`/health` uses the same model and exposes no credentials, provider account identifiers, hostnames, or raw errors.

`/api/debug` requires admin authentication. It performs bounded live dependency probes and returns
the email outbox, scheduler leases, game pools, media queue, official-result durable work, and a
per-replica Multiplayer metric snapshot. It normalizes failures without returning secrets or
recipients. Runtime counters reset when that replica restarts.

## Multiplayer signals

The managed runtime records bounded, low-cardinality metrics for:

- operations and operational failures by game;
- authoritative reconciliation latency;
- authenticated active sockets and bounded termination reasons;
- command/socket rate-limit enforcement;
- Spelling Party lock acquisition, contention, failure, and wait time;
- Redis backplane publication, receipt, and failure.

Room IDs, player IDs, credentials, action IDs, and tokens are never metric labels or log context. The admin panel provides the current replica view. Production history comes from Railway structured logs; use an OTLP-compatible collector when cross-replica percentile dashboards and longer retention become necessary.

## Structured events

Production logs are one-line JSON objects with stable fields:

```json
{
  "level": "info",
  "scope": "cron.cleanup-transfers",
  "message": "Cron cleanup finished",
  "context": {
    "requestId": "…",
    "durationMs": 120,
    "deletedObjects": 4
  },
  "ts": "2026-07-15T12:00:00.000Z"
}
```

Never log passwords, PINs, tokens, cookies, presigned URLs, or direct personal identifiers.

## Minimum monitoring

- Poll `/api/health` every five minutes from outside the host.
- Alert after two consecutive failures, not a single transient error.
- Alert when scheduled maintenance has no successful completion for 36 hours.
- Track memory, CPU, restarts, HTTP 5xx rate, and response latency at the host.
- Track Redis command usage and R2 storage/operation usage at their providers.
- Alert on sustained multiplayer operation failures, lock failures, or realtime backplane failures.
- If the media worker is enabled, alert on stale heartbeat, growing queue depth, or repeated retry exhaustion.
- Alert when the email outbox has failed rows, its oldest pending message is more than 15 minutes
  old, or provider-accepted messages have no delivery event after 15 minutes while delivery events
  are configured.

Every alert needs a target owner and a link to [`deployment.md`](./deployment.md) for rollback.

## Time-driven product readiness

`product-readiness.yml` checks the rolling Hot & Cold quality window daily, seven days ahead.
A failed run contains the affected puzzle/date; use repository workflow-failure notifications rather
than sending unchanged application alerts every polling cycle. The protected System panel shows
oldest pending email/media age and scheduler last-success/next-due times. Scheduled-job rows and
queue state are shared durable state; multiplayer counters belong to the displayed replica and
reset when that process restarts. Aggregate those process metrics in the log/metrics backend.
Configure the deployment's alert receiver for growing queue age or missed job success windows;
workflow scheduling and notification delivery must be verified after this change is deployed.
