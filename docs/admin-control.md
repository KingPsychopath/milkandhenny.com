# Admin control from the terminal

The CLI uses the same authenticated `/api/admin/*` routes as the browser admin
panel. This keeps event, ticket, refund, email, scanner, content, and storage
rules in the application instead of bypassing them with direct SQL.

## Authentication

Use a deployed base URL. Sign in once and let the CLI store the short-lived JWT
in the operating system's protected credential store:

```sh
pnpm cli auth login --base-url https://milkandhenny.com
pnpm cli events list --base-url https://milkandhenny.com
pnpm cli auth logout --base-url https://milkandhenny.com
```

`auth login` prompts privately. It stores only the JWT, not the password. macOS
uses Keychain, Linux uses Secret Service, and Windows uses user-scoped DPAPI
storage. When the JWT expires or is revoked, the next command prompts again and
updates the stored value. `auth revoke` requires step-up re-authentication,
revokes the exact current CLI session remotely, and removes the local token. Use
`auth revoke --role admin` or `--role all` for role-wide invalidation.

For one-off or non-interactive commands, avoid putting a real password in shell
history. An existing JWT can be supplied through a protected environment
variable:

```sh
pnpm cli admin request GET /api/admin/events \
  --base-url https://milkandhenny.com \
  --admin-token "$MILK_HENNY_ADMIN_TOKEN"
```

## Any existing admin control

`admin request` can call every route below the `/api/admin/` boundary, plus
protected system diagnostics and the best-dressed admin controls:

```sh
pnpm cli admin request GET /api/admin/events --admin-token "$TOKEN"

pnpm cli admin request PATCH /api/admin/events/after-school-club-2026-09-01 \
  --file ./event-update.json --admin-token "$TOKEN" --yes

pnpm cli admin request POST /api/admin/events/after-school-club-2026-09-01/tickets \
  --json '{"action":"resend","ticketId":"TICKET_ID"}' \
  --admin-token "$TOKEN" --yes
```

Useful controls include:

- event settings, ticket types, guest requests, ticket actions, checkpoints,
  scanner links, uploads, and attendee email;
- albums, photos, word media, word shares, pitches, reports, and content
  summaries;
- transfer cleanup and media processing;
- token sessions and token revocation.

The non-`/api/admin/` controls are deliberately allow-listed. The CLI can read
`/api/debug` and `/api/health`, and can operate the protected best-dressed
voting window and code controls. It cannot submit public votes through the
admin command.

The CLI rejects paths outside this allow-list. It does not expose arbitrary SQL:
direct SQL would bypass capacity, refund, redemption, and authentication rules.

## Event shortcuts

Common event and ticket changes have shorter commands:

```sh
pnpm cli events list --base-url https://milkandhenny.com --admin-token "$TOKEN"
pnpm cli events show EVENT_SLUG --base-url https://milkandhenny.com --admin-token "$TOKEN"

pnpm cli events ticket list EVENT_SLUG --admin-token "$TOKEN"

pnpm cli events ticket add EVENT_SLUG \
  --id entry \
  --name 'Entry' \
  --price 10 \
  --quantity 80 \
  --per-person-limit 3 \
  --description 'Entry only. Food is an extra £10 per person on the day, subject to availability.' \
  --admin-token "$TOKEN" --yes

pnpm cli events ticket update EVENT_SLUG standard \
  --name 'Entry + Food Pass' \
  --price 15 \
  --quantity 50 \
  --admin-token "$TOKEN" --yes
```

Ticket updates preserve the ticket type ID. Removing a sold ticket type is
still rejected by the database, as it should be.

## Safety controls

- `GET` requests run immediately.
- Mutations show a confirmation prompt by default.
- `--dry-run` prints the exact method, path, and body without sending it.
- `--yes` skips the prompt for scripts and agent workflows.
- `--step-up` obtains a fresh step-up token with a private password prompt (or
  `--admin-password`) for money-adjacent or destructive routes.

For an email, use the event email route with `preview: true` first. Send only
after reviewing the rendered message and recipient count.
