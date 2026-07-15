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

## Health semantics

`/api/health` is configuration-only. It performs no Redis or object-storage operations, returns `Cache-Control: no-store`, and uses status 503 only when a required capability is unavailable. Optional maintenance or worker degradation remains visible without failing platform readiness.

`/health` uses the same model and exposes no credentials, provider account identifiers, hostnames, or raw errors.

`/api/debug` requires admin authentication. It performs one read-only Redis operation and one object-storage bucket probe, reports bounded latency, and normalizes failures without returning secrets.

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
- If the media worker is enabled, alert on stale heartbeat, growing queue depth, or repeated retry exhaustion.

Every alert needs a target owner and a link to [`deployment.md`](./deployment.md) for rollback.
