# Milk & Henny docs

Start with [the project](../README.md), [product direction](product.md), and
[architecture](architecture.md). This index separates current contracts from operational procedures
and historical evidence.

## Understand the application

| Read                                    | For                                                           |
| --------------------------------------- | ------------------------------------------------------------- |
| [Product direction](product.md)         | Experiences, priorities, and boundaries                       |
| [Architecture](architecture.md)         | System shape, module ownership, persistence, and execution    |
| [Design language](design-language.md)   | Typography, palette, layout, and interaction                  |
| [Navigation](navigation.md)             | URLs, history, context, and exits                             |
| [Server state](server-state.md)         | Loaders, Query, commands, live projections, and recovery      |
| [Storage and auth](storage-and-auth.md) | Cookies, browser storage, and access boundaries               |
| [Effect lifecycle](effect-lifecycle.md) | Runtime ownership, cancellation, failures, and shutdown       |
| [Durable work](durable-work.md)         | Transactions, queues, outboxes, leases, and reconciliation    |
| [Security](security.md)                 | Authentication, authorization, secrets, and incident response |

## Work on a feature

| Area                     | Contracts                                                                                                                                                                                                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Events and tickets       | [Platform](events-platform.md) · [Transfer and refund policy](ticket-transfer-and-refund-policy.md)                                                                                                                     |
| Operational UI           | [Admin workspace map](admin-ux-map.md) · [CLI and control](admin-control.md)                                                                                                                                            |
| Media and sharing        | [Pipeline](media-pipeline.md) · [Object operations](media-object-operations.md) · [Worker](media-worker.md)                                                                                                             |
| Pitch Night              | [Studio and presentation](pitch-night-platform.md)                                                                                                                                                                      |
| Shared play              | [Room-first design](room-first-multiplayer.md) · [Multiplayer testing](multiplayer-testing.md)                                                                                                                          |
| Game rules and content   | [Pairs](pairs.md) · [Twin](twin.md) · [Liars](liars.md) · [Family Feud content](family-feud-content.md)                                                                                                                 |
| Historical event scoring | [Retention and closeout](event-scoring/operations.md) · [Implementation record](https://github.com/machineyearningengineer/milkandhenny.com/blob/b283af0b19bd581f65cacd7bb52dff4982c90b57/docs/event-scoring/README.md) |

Public Things come from [`features/things/catalog.ts`](../features/things/catalog.ts).
A module or old acceptance checklist alone does not establish that a feature is live.

## Develop and verify

[Local development](local-development.md) covers the isolated Docker environment and everyday
commands. [Testing](testing.md) defines checks by blast radius and the release gate.
[`AGENTS.md`](../AGENTS.md) is the repository entry point for coding agents; the linked contracts
provide the detail.

## Run and recover

| Runbook                                                         | Use                                                       |
| --------------------------------------------------------------- | --------------------------------------------------------- |
| [Deployment](deployment.md)                                     | Image, configuration, release, cutover, and rollback      |
| [Operations](operations.md)                                     | Schedules, limits, workers, and manual recovery           |
| [Observability](observability.md)                               | Readiness, capability reporting, logs, and alerts         |
| [Disaster recovery](disaster-recovery.md)                       | Backups, restore drills, and object recovery              |
| [Postgres runtime roles](postgres-runtime-roles.md)             | Separate migrations from restricted runtime access        |
| [Local email](local-email.md)                                   | Mailpit delivery testing                                  |
| [Cloudflare email events](cloudflare-email-events.md)           | Delivery-event relay                                      |
| [Cache policy](cache-policy.md)                                 | Origin and shared-cache behavior                          |
| [Canonical host and redirects](canonical-host-and-redirects.md) | Public origin and auth-sensitive redirects                |
| [Public-media rate limits](cloudflare-rate-limit-images.md)     | WAF intent and checks                                     |
| [Service-worker recovery](service-worker-cache-recovery.md)     | Repair an incorrectly cached worker                       |
| [Historical guest archive](legacy-guest-archive.md)             | Restricted offline import tooling and access requirements |

Runbooks describe procedures. Dated observations inside them do not prove the current deployment
or credential state; verify those before acting.

## Evidence and history

[The archive](archive/README.md) indexes migration snapshots and review packets, with links to
retired delivery plans in Git history. Status statements apply to the dates recorded.

Two incident records retain useful failure lessons:

- [Guest-list read amplification](postmortem-guestlist-kv-read-spike.md): mutable collection shape and polling cost.
- [Idle media-worker command spike](postmortem-media-worker-idle-redis-commands.md): wake transport and idle behavior.

The README artwork has [editable source and rendering instructions](assets/README.md).
