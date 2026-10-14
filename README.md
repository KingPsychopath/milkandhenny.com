# milk & henny

Thoughts, stories, and things worth sharing.

![Milk & Henny: an editorial page, a picture contact sheet, a pair of matching cards, and a ticket, arranged on warm paper.](docs/assets/milk-and-henny.png)

[Visit the site](https://milkandhenny.com) · [Explore Things](https://milkandhenny.com/things) · [Architecture](docs/architecture.md) · [Docs](docs/README.md)

Milk & Henny is a place to read something, keep a moment, play with friends, and bring people
together. The quiet editorial site and the tools behind an event live in the same application:
from a photo album to a shared game, from an invitation to the person checking tickets at the door.

## What's here

|               |                                                                              |
| ------------- | ---------------------------------------------------------------------------- |
| **Words**     | Essays, stories, and notes, with an editor and private sharing.              |
| **Pics**      | Photo albums, captions, responsive images, and deliberately published media. |
| **Things**    | Games for a spare minute or a room full of people, plus a pitch studio.      |
| **Events**    | Event pages, tickets, waitlists, attendee access, and door tools.            |
| **Transfers** | Private file sharing with expiry, upload recovery, and media previews.       |

Try [Pairs](https://milkandhenny.com/things/pairs) for a small, immediate game,
[Hot & Cold](https://milkandhenny.com/things/hot-and-cold) for a hidden-word puzzle, or
[Family Feud](https://milkandhenny.com/things/family-feud) for a host-led room.
[Words](https://milkandhenny.com/words) and [Pics](https://milkandhenny.com/pics) are the slower side.

## Play, refresh, pick up where you left off

![Pairs: Alex and Jo share a table, match a pair, refresh the page, and resume with the score and cleared cards intact.](docs/assets/pairs-recovery.gif)

A recording of the local application: two players on one device, a matching pair, a real page
reload, and the same table restored. [Watch the video](docs/assets/pairs-recovery.mp4) ·
[Capture notes and source](docs/assets/README.md#pairs-recovery-demo).

<details>
<summary>A little motion study</summary>

![A matching pair turns over, the contact sheet gains a photograph, and a ticket receives its admission mark.](docs/assets/milk-and-henny.gif)

An illustrated product study, using the site's own typography and palette. These are drawn
representations of the features, rather than screen recordings. [Static version](docs/assets/milk-and-henny.png).

</details>

## What it's working towards

A useful place around the things people make and do together. Reading should feel unhurried.
Games should give people a reason to look up and talk. Sharing should make it clear what is public,
what is private, and what happens next. The backstage tools should make an event easier to run.

Those goals shape both the interface and the code: a small visual vocabulary, explicit ownership,
and recovery when a connection drops or a process restarts. [Product direction](docs/product.md)
sets out the priorities and the boundaries.

## How it's built

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/architecture-dark.png" />
  <img src="docs/assets/architecture-light.png" alt="Browser requests cross the TanStack Start and Nitro web process into feature workflows and platform adapters. Postgres owns state and durable jobs; R2 owns private sources and public derivatives. A media worker uses the same Docker image. Dashed arrows show advisory wakes and live updates." />
</picture>

One **TanStack Start / React** application, served by **Nitro** as a Node process. Features own their
rules; routes and server functions expose them. **Postgres** owns records, transactions, rooms,
and durable work. **R2** holds private sources and intentional public derivatives.

**Effect** coordinates fallible backend work and subsystem lifetimes. Game rules, validation,
repositories, and browser code stay ordinary TypeScript. Heavy media can run in a separate worker
using the same Docker image. The application can run on Railway or another container host.

The [architecture overview](docs/architecture.md) explains the boundaries and follows a request
through the system. The [design language](docs/design-language.md) explains the warm paper,
serif reading type, monospace controls, and restrained motion.

## Run it locally

Use the Node version in [Dockerfile](Dockerfile) and the pnpm version pinned in
[package.json](package.json). Start Docker, then:

```bash
pnpm install --frozen-lockfile
pnpm dev:setup
pnpm dev
```

Open [127.0.0.1:3000](http://127.0.0.1:3000). Local mode supplies Postgres, object storage, and
Mailpit; it excludes inherited remote credentials and dotenv files. The first setup downloads
service images and the semantic model. Later starts use the cached copies.

[Local development](docs/local-development.md) covers sign-in, data, email, and stopping services.
[Deployment](docs/deployment.md) covers configuration and the production image.

## Find your way around

| Path                                          | Purpose                                                  |
| --------------------------------------------- | -------------------------------------------------------- |
| [`src/routes`](src/routes)                    | Pages, URL state, and HTTP boundaries                    |
| [`features`](features)                        | Product workflows, rules, and feature UI                 |
| [`components`](components) · [`hooks`](hooks) | Shared interface and browser behavior                    |
| [`lib/platform`](lib/platform)                | Database, storage, email, payments, and runtime adapters |
| [`lib/shared`](lib/shared)                    | Environment-safe constants and utilities                 |
| [`server/plugins`](server/plugins)            | Startup, readiness, and shutdown                         |
| [`ops`](ops) · [`scripts`](scripts)           | Operations, local tools, and generated assets            |
| [`docs`](docs/README.md)                      | Product, architecture, contracts, and runbooks           |

For code changes, start with `pnpm check` and the tests for the behavior you changed. Build when
bundling or server/client boundaries change. The [verification guide](docs/testing.md) describes
the broader release checks.

The repository is available for viewing and reference under its [license](LICENSE).
