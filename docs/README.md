# Documentation

**Start here:** [../README.md](../README.md) — project overview, quick start, features, env vars, and deployment.

This folder holds deeper reference docs. Pick by topic:

| Doc                                                                    | Contents                                                                                               |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [design-language.md](./design-language.md)                             | Design language — palette, typography, motion, interaction rules, and why the UI looks the way it does |
| [navigation.md](./navigation.md)                                       | URL, browser-history, breadcrumbs, journey rails, game screens, and footer rules                       |
| [architecture.md](./architecture.md)                                   | Provider-neutral runtime boundaries, ownership, storage, maintenance, and health                       |
| [events-platform.md](./events-platform.md)                             | Events, ticketing, signed QR, door check-in, email and payments — spec and phasing                     |
| [admin-control.md](./admin-control.md)                                 | Terminal control for deployed admin API routes, events, tickets, email, and operations                 |
| [deployment.md](./deployment.md)                                       | Railway, Docker/VPS deployment, cutover, and rollback                                                  |
| [observability.md](./observability.md)                                 | Health checks, structured logs, dependency probes, and operator signals                                |
| [security.md](./security.md)                                           | Authentication, rate limiting, incident response & key rotation                                        |
| [canonical-host-and-redirects.md](./canonical-host-and-redirects.md)   | Why canonical host redirects exist and how they affect auth/session flows                              |
| [storage-and-auth.md](./storage-and-auth.md)                           | Mental model: httpOnly cookies vs localStorage in this app (feature-by-feature)                        |
| [media-pipeline.md](./media-pipeline.md)                               | OG images, face detection, focal points, image rotation & HEIC, blog file uploads                      |
| [operations.md](./operations.md)                                       | Redis command budget, cost & limits, R2 lifecycle rules                                                |
| [media-worker.md](./media-worker.md)                                   | Queued RAW/video processing: the worker role, delivery guarantees, live updates, and cutover           |
| [cloudflare-rate-limit-images.md](./cloudflare-rate-limit-images.md)   | Step-by-step Cloudflare WAF rate limiting setup                                                        |
| [service-worker-cache-recovery.md](./service-worker-cache-recovery.md) | Manual recovery when Cloudflare unexpectedly caches `/sw.js`                                           |
| [testing.md](./testing.md)                                             | Testing strategy — unit vs integration vs E2E, what we test and why                                    |
| [room-first-multiplayer.md](./room-first-multiplayer.md)               | Canonical standard for multiplayer fun, flow, device topology, shared screens, hosts, and phones       |
| [room-first-multiplayer-audit.md](./room-first-multiplayer-audit.md)   | Dated audit of shipped room games plus the target design for the planned survey-board game             |
| [multiplayer-testing.md](./multiplayer-testing.md)                     | One-person multiplayer QA — real role panels, bots, scenarios, captures, clocks, and failure testing   |
