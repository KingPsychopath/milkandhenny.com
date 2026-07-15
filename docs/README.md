# Documentation

**Start here:** [../README.md](../README.md) — project overview, quick start, features, env vars, and deployment.

This folder holds deeper reference docs. Pick by topic:

| Doc                                                                  | Contents                                                                                               |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| [design-language.md](./design-language.md)                           | Design language — palette, typography, motion, interaction rules, and why the UI looks the way it does |
| [architecture.md](./architecture.md)                                 | Provider-neutral runtime boundaries, ownership, storage, maintenance, and health                       |
| [deployment.md](./deployment.md)                                     | Railway, Docker/VPS deployment, cutover, and rollback                                                  |
| [observability.md](./observability.md)                               | Health checks, structured logs, dependency probes, and operator signals                                |
| [security.md](./security.md)                                         | Authentication, rate limiting, incident response & key rotation                                        |
| [canonical-host-and-redirects.md](./canonical-host-and-redirects.md) | Why canonical host redirects exist and how they affect auth/session flows                              |
| [storage-and-auth.md](./storage-and-auth.md)                         | Mental model: httpOnly cookies vs localStorage in this app (feature-by-feature)                        |
| [media-pipeline.md](./media-pipeline.md)                             | OG images, face detection, focal points, image rotation & HEIC, blog file uploads                      |
| [operations.md](./operations.md)                                     | KV command budget, cost & limits, R2 lifecycle rules                                                   |
| [cloudflare-transfer-worker.md](./cloudflare-transfer-worker.md)     | Cloudflare Worker + Container setup for queued RAW/video transfer processing                           |
| [cloudflare-rate-limit-images.md](./cloudflare-rate-limit-images.md) | Step-by-step Cloudflare WAF rate limiting setup                                                        |
| [testing.md](./testing.md)                                           | Testing strategy — unit vs integration vs E2E, what we test and why                                    |
