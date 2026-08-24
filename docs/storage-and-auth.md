# Storage vs Cookies (Mental Model)

This doc explains when we use:

- **httpOnly cookies** (server-readable auth)
- **`localStorage`** (client-only UX state)
- **`sessionStorage`** (short-lived, tab-scoped recovery only)

It also documents why the old model (client storage + `useEffect` fetch + API routes for everything) was slower and riskier in this codebase.

---

## Mental model

### Two separate questions

1. **Who needs to read the value?**

- **Server needs it** (server-rendered routes, TanStack server functions, Nitro handlers) -> use **cookies**
- **Only the browser needs it** -> use **localStorage** (or React state)

2. **Should JavaScript be allowed to read it?**

- **No** (auth/session tokens) -> use **httpOnly cookies**
- **Yes** (theme, UI preferences, convenience hints) -> use **localStorage**

### What cookies are in this app

- `mah-auth-admin` (JWT) - admin access (admin dashboard + admin-only routes)
- `mah-auth-upload` (JWT) - upload access (optional; see upload note)
- `mah-bd-voter` (opaque id) - best-dressed per-device vote identity

Cookies are sent automatically by the browser on same-site requests, which lets
TanStack Start render and protect server-backed routes without moving the whole
page into a client-only shell.

---

## Feature-by-feature: what we store where (and why)

### Ticket scanning (`/scan/{token}`)

Replaced `/guestlist`, which was removed along with the standalone guest list.

- **Auth**: revocable scanner-link token in the URL
- **Why**: the server page gates access and ships the manifest with the first render, so a phone on bad signal makes one request rather than three
- **Client storage**: no auth. The offline scan queue and downloaded manifest live in component state; the manifest holds truncated hashes, never ticket ids, so a lost device is not a forgery kit

### Ticket (`/ticket/$id`)

- **Auth**: none — the ticket id in the URL is the bearer token, so the page is `noindex`
- **Client storage**: none
- **Cookie side effect**: opening a valid ticket sets `mah-ticket-holder`, an **httpOnly, signed** list of event slugs this browser holds a ticket for. That cookie is what reveals the exact address on the event page. It is a convenience marker, not authorization — anything that matters re-checks the ticket server-side

### Admin (`/admin`)

- **Auth**: JWT in **httpOnly cookie** (`mah-auth-admin`)
- **Step-up**: still uses `POST /api/admin/step-up` and includes `x-admin-step-up`
- **Local development**: the login page has a development-only button that creates a process-scoped httpOnly admin session (`mah-auth-admin-dev`). It is available only when `NODE_ENV=development`; protected admin actions also skip step-up in that mode.
- **Why**: server can gate the page and reduce client auth plumbing; production destructive actions still require step-up

### Best dressed (`/best-dressed`)

- **Auth**: generally **no staff/admin auth** required to vote
- **Voter identity**: cookie (`mah-bd-voter`) for "one vote per device" and session enforcement
- **Client storage**: `localStorage["bestDressedVote"]` is a **UX hint** (not the source of truth)
- **Why**: server is the source of truth (cookie + Redis); localStorage is only for convenience UI

### Upload (`/upload`)

- **Auth**: JWT in **httpOnly cookie** (`mah-auth-upload` or `mah-auth-admin`)
- **Why**: admin sessions should satisfy upload access (least privilege + fewer logins). Upload API routes accept cookie auth.
- **Client storage**: none for authentication. Authorization tokens are not stored in browser storage.

Notes:

- Transfer uploads are available to `upload` role (UPLOAD_PIN) and `admin`.
- Blog media uploads are admin-only.

### Theme + reading preferences (site-wide)

- **Client storage**: theme preference in `localStorage` (non-sensitive)
- **Why**: this is a pure client preference and we want instant paint without network calls

### Live game state and navigation

- **Client storage**: React state for the active round; `sessionStorage` only
  for bounded, tab-scoped recovery where a feature explicitly supports it.
- **Navigation**: the route identifies the tool. A local setup-to-round change
  may add one temporary browser-history marker so Back returns to setup. The
  marker is not the game state and does not make a round shareable.
- **Why**: timers, scores, drawings, motion, permissions, and device state are
  not safe or useful to serialise into a URL. A room URL is different: it
  identifies a server-backed multiplayer session, while the room protocol
  remains authoritative.

### Browser profile (site-wide)

- **Client storage**: a name and email address in `localStorage["mah-browser-profile-v1"]`
- **Why**: editable identity fields can be filled on this browser without an account
- **Write rule**: remember values only after a successful ticket, pitch, recovery, presentation, or
  multiplayer action; typing alone does not persist them
- **Trust rule**: the profile is a convenience default only. It is never submitted automatically,
  sent with unrelated requests, or used as authentication or authorization
- **Extension rule**: new reusable fields must be explicit in the typed profile, validated on read
  and write, and introduced only when a real form needs them
- **Scope**: feature state, payment details, credentials, room tokens, and private links never belong
  in this profile
- **Removal**: `/privacy` can remove the shared profile without clearing unrelated saved work,
  preferences, or sessions

Current public call sites:

- Event ticket claim: name and email after the visitor chooses a ticket type
- Lost-ticket resend: email
- Pitch creation and recovery: name and email
- Multiplayer rooms, game pools, and presentation remotes: display name

Do not use the browser profile in admin, scanner, or operator forms that describe another person.

---

## Why the previous model was weaker here

### The old pattern

- Store JWT in `localStorage`/`sessionStorage`
- Make server-backed pages client-only
- Fetch initial data in `useEffect` from API routes
- Do every mutation from client code

### Problems it creates (mental model)

1. **The server is blind**

Server-rendered routes and server functions cannot see browser storage. That
forces the app into a client-first architecture even for pages that should be
server-rendered.

2. **You can’t “render authenticated HTML”**

If auth is only in localStorage, the server can't know you're logged in while rendering HTML.
Result: you render a shell, then `useEffect` fetches, then the UI fills in (slower, more moving parts).

3. **More `useEffect` + more traffic amplifiers**

Every client fetch is an effect with dependencies. In a page with timers, polling, or frequent re-renders, it’s easy to accidentally restart effects and spike reads.

This repo already hit that exact failure mode:

- see `docs/postmortem-guestlist-kv-read-spike.md`

4. **Harder to use server-rendering primitives**

Server rendering, route loaders, caching/revalidation, and server functions
become less useful when auth is only client-side.

5. **Security footgun**

Bearer tokens in localStorage are readable by JS, which raises the blast radius of any XSS.
httpOnly cookies reduce that risk by making the token inaccessible to client JS.

---

## Decision rules (quick)

- If you need the server to decide anything (gate a page, fetch initial data, run a server function) -> **cookie**
- If it’s a client-only preference or hint -> **localStorage**
- Avoid `sessionStorage` for durable data, auth, or source-of-truth state. It is
  appropriate for a bounded tab-scoped recovery value when losing the tab is an
  acceptable outcome and the feature documents the behaviour.
