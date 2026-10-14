# Cookies and browser storage

Server-rendered pages need credentials the server can read. Admin and upload JWTs therefore use
httpOnly cookies. Browser preferences and recoverable working copies have separate, feature-owned
storage. Neither a cached view nor a saved form proves authorization.

## Ownership

| Value                                      | Home                               | Rule                                                                  |
| ------------------------------------------ | ---------------------------------- | --------------------------------------------------------------------- |
| Admin and upload JWTs                      | httpOnly cookies                   | Server validates expiry, revocation, and role version                 |
| CLI session                                | Operating-system credential store  | Sent explicitly as Bearer auth; see [admin control](admin-control.md) |
| Theme and reading preferences              | `localStorage`                     | Non-sensitive browser defaults                                        |
| Local game and interrupted upload recovery | Versioned `sessionStorage` records | Bounded tab lifetime; validate before resuming                        |
| Offline pitch working copy                 | IndexedDB                          | Reconcile with server versions when connected                         |
| Live shared-room truth                     | Server room repository             | Browser holds only its authorized projection and recovery credentials |

Do not store admin or upload JWTs in JavaScript-readable storage. A feature that uses a capability
URL or browser-held recovery key must document its scope, expiry, revocation, and server checks.
Such keys never belong in shared query keys or the site-wide browser profile.

## Feature access

Admin uses `mah-auth-admin`; uploads accept `mah-auth-upload` or an admin session. Protected
production mutations require step-up through `/api/admin/step-up`. The development-only admin
shortcut uses a process-scoped cookie and is unavailable in production. Word media uploads remain
admin-only; the upload role grants transfer-upload access.

A ticket identifier is a bearer capability. The server validates it before revealing protected
data or accepting ticket actions. Opening a ticket does not establish a personal account or game
identity. Ticket pages are excluded from indexing.

Best Dressed uses the `mah-bd-voter` cookie and server voting records. A saved browser vote is a
convenience hint; the server decides whether another vote is allowed.

## Scanner recovery

The scanner link token is a revocable bearer credential. The scanner route authorizes access on
the server, disables route caching, and excludes the page from indexing and referrers.

[`scanner-memory.ts`](../features/tickets/scanner-memory.ts) remembers up to four scanner links in
`localStorage` for 14 days. This is an explicit capability-storage exception, not an account
session. Server revocation still applies, and an inactive link is removed from the return prompt.

The door scanner keeps its offline admission queue and accepted hashes in tab-scoped
`sessionStorage`. Its current manifest is a server projection. Reconnect reconciles queued scans
against authoritative admission records; a local acceptance cannot guarantee that another device
has not admitted the same ticket.

## Browser profile

`localStorage["mah-browser-profile-v1"]` stores preferred name, game name, and email defaults for
public ticket, pitch, recovery, and multiplayer forms. Save them only after a successful action;
typing alone does not persist them. The profile is editable convenience data and grants no access.
It is not submitted automatically or sent with unrelated requests.

A game name is separate from ticket-holder names and names already chosen in a room. New fields
need typed validation and a form that uses them. Keep payment details, credentials, feature state,
and private links out of the profile. `/privacy` removes it without clearing unrelated saved work.
Operator forms that describe another person do not use this profile.

## Loading and navigation

Load critical remote data through a route loader or server function. Copying credentials into
browser storage and fetching initial data after mount prevents the server from authorizing the
first render and adds requests. Query owns ordinary remote snapshots; see [server state](server-state.md).

Local game state stays in its reducer and recovery model. The URL identifies the tool or durable
room; temporary history entries control Back behavior, not game truth. See [navigation](navigation.md).
Polling callbacks must remain stable across renders and enforce a minimum fetch gap. The
[guest-list incident](postmortem-guestlist-kv-read-spike.md) records the failure that prompted this rule.
