# Documentation

[../README.md](../README.md) is the project entry point. Documents here are classified so a dated
audit or completed implementation checklist is not mistaken for current architecture.

## Normative engineering contracts

These describe how current code should be designed and reviewed.

| Document                                                 | Contract                                                                 |
| -------------------------------------------------------- | ------------------------------------------------------------------------ |
| [architecture.md](./architecture.md)                     | Module ownership, persistence, runtimes, maintenance, and deployment     |
| [effect-lifecycle.md](./effect-lifecycle.md)             | Effect adoption, resources, cancellation, errors, retry, and shutdown    |
| [durable-work.md](./durable-work.md)                     | Outboxes, queues, leases, wake signals, recovery, and idempotency        |
| [testing.md](./testing.md)                               | Blast-radius verification, test tiers, coverage, and release gates       |
| [security.md](./security.md)                             | Authentication, authorization boundaries, secrets, and incident response |
| [design-language.md](./design-language.md)               | Visual tokens, typography, layout, interaction, and accessibility        |
| [navigation.md](./navigation.md)                         | URL ownership, browser history, breadcrumbs, rails, and exits            |
| [room-first-multiplayer.md](./room-first-multiplayer.md) | Co-located multiplayer product and interaction standard                  |
| [multiplayer-testing.md](./multiplayer-testing.md)       | One-person harnesses, scenarios, captures, and failure testing           |
| [storage-and-auth.md](./storage-and-auth.md)             | Cookies, browser storage, and server/client state boundaries             |

## Product and feature contracts

| Document                                                                       | Contract                                                          |
| ------------------------------------------------------------------------------ | ----------------------------------------------------------------- |
| [events-platform.md](./events-platform.md)                                     | Current event, ticket, attendee, communication, and scoring shape |
| [event-scoring/operations.md](./event-scoring/operations.md)                   | Scoring policy, retention, closeout, and recovery                 |
| [ticket-transfer-and-refund-policy.md](./ticket-transfer-and-refund-policy.md) | Transfer/refund product boundary and operational rules            |
| [pitch-night-platform.md](./pitch-night-platform.md)                           | Pitch studio, persistence, presentation, and lifecycle            |
| [liars.md](./liars.md)                                                         | Liars game rules, room behavior, privacy, and controls            |
| [twin.md](./twin.md)                                                           | Twin game rules, fairness, architecture, and build contract       |
| [family-feud-content.md](./family-feud-content.md)                             | Family Feud content provenance and editorial policy               |
| [admin-ux-map.md](./admin-ux-map.md)                                           | Admin information architecture and workspace rules                |

## Operations and provider runbooks

| Document                                                               | Use                                                             |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| [operations.md](./operations.md)                                       | Scheduling, runtime limits, deploy checks, incidents, workers   |
| [deployment.md](./deployment.md)                                       | Portable image, Railway/VPS setup, cutover, and rollback        |
| [observability.md](./observability.md)                                 | Health semantics, logs, metrics, and minimum alerts             |
| [disaster-recovery.md](./disaster-recovery.md)                         | Backup targets, PostgreSQL restore drills, and object recovery  |
| [admin-control.md](./admin-control.md)                                 | Authenticated CLI operations and safety controls                |
| [media-pipeline.md](./media-pipeline.md)                               | Bucket ownership, album lifecycle, and media validation         |
| [media-worker.md](./media-worker.md)                                   | Heavy-media queue, leases, retries, reconciliation, and cutover |
| [local-email.md](./local-email.md)                                     | Mailpit-based local delivery testing                            |
| [cloudflare-email-events.md](./cloudflare-email-events.md)             | Email-event Queue relay and verification                        |
| [cache-policy.md](./cache-policy.md)                                   | Origin and shared-cache response policy                         |
| [canonical-host-and-redirects.md](./canonical-host-and-redirects.md)   | Canonical origin and auth-sensitive redirect behavior           |
| [cloudflare-rate-limit-images.md](./cloudflare-rate-limit-images.md)   | Public-media WAF intent and verification                        |
| [service-worker-cache-recovery.md](./service-worker-cache-recovery.md) | Manual recovery for an incorrectly cached service worker        |

## Dated evidence and incident records

These records explain what was checked or what failed at a point in time. They do not prove the
current tree or deployment is ready.

| Document                                                                                           | Record                                                    |
| -------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [event-night-readiness.md](./event-night-readiness.md)                                             | Event-night audit snapshot and physical rehearsal gaps    |
| [event-scoring/README.md](./event-scoring/README.md)                                               | Completed scoring implementation and acceptance checklist |
| [room-first-multiplayer-audit.md](./room-first-multiplayer-audit.md)                               | Dated conformance and fun-hypothesis audit                |
| [postmortem-guestlist-kv-read-spike.md](./postmortem-guestlist-kv-read-spike.md)                   | Guest-list Redis read-amplification incident              |
| [postmortem-media-worker-idle-redis-commands.md](./postmortem-media-worker-idle-redis-commands.md) | Idle worker command-spike incident                        |

Obsolete handoffs, superseded migration notes, completed transient roadmaps, and tool-output
snapshots belong in git history rather than this directory.
