# Local development

The default development environment runs the application with local Postgres, S3-compatible
storage, and Mailpit. It excludes inherited provider credentials and dotenv files, and selects
Postgres for the application stores. No hosted project or Redis service is needed.

## Start

Use the Node version in [Dockerfile](../Dockerfile) and the package-manager version in
[package.json](../package.json). Install Docker and start its engine, then:

```bash
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev
```

Setup caches service images and the semantic model. `pnpm dev` starts the cached services,
prepares local buckets, and runs Vite. Open [127.0.0.1:3000](http://127.0.0.1:3000).

The development-only admin shortcut is available on the sign-in page. The local admin password is
`local-admin-password`; the upload PIN is `local-upload-pin`. These fixed values belong only to the
isolated development environment in [`scripts/local-dev-env.mjs`](../scripts/local-dev-env.mjs).

## Data and tools

Database and object data persist in Docker volumes. The generated local authentication secret
persists in ignored `.local-dev/auth-secret`. Stopping services keeps both:

```bash
pnpm dev:stop
```

Use `pnpm dev:cli <command>` for CLI operations against the same environment. Mailpit is at
[127.0.0.1:18025](http://127.0.0.1:18025); see [local email](local-email.md) for delivery testing.

## Verification

| Command                                    | Use                                               |
| ------------------------------------------ | ------------------------------------------------- |
| `pnpm check`                               | Formatting, architectural checks, types, and lint |
| `pnpm exec vitest run <test-path>`         | Focused behavior checks                           |
| `pnpm test`                                | Full unit and integration suite                   |
| `pnpm build`                               | Production bundling                               |
| `pnpm exec playwright test <journey-path>` | Focused browser journeys                          |
| `pnpm verify:release`                      | Full release gate                                 |

Choose verification by the changed behavior; see [testing](testing.md). The toolchain uses tsgo,
Oxlint, and Oxfmt. Package scripts and dependency versions remain in `package.json`.

## Explicitly configured environments

[`.env.example`](../.env.example) documents the configuration contract. To use your own development
configuration, supply `.env.local` and run `pnpm dev:server` directly. This lower-level command does
not provision the isolated default environment. Browser tests use it with their own fixtures.

Only public `VITE_*` configuration enters the browser bundle. Never use that prefix for secrets.
Real payments, external email, and hybrid media processing need their provider configuration;
see [deployment](deployment.md) and [media worker](media-worker.md).
