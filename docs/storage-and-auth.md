# Storage vs Cookies (Mental Model)

This doc explains when we use:

- **httpOnly cookies** (server-readable auth)
- **`localStorage`** (client-only UX state)
- **`sessionStorage`** (avoid; client-only and easy to lose/debug)

It also documents why the old model (client storage + `useEffect` fetch + API routes for everything) was slower and riskier in this codebase.

---

## Mental model

### Two separate questions

1) **Who needs to read the value?**

- **Server needs it** (Server Components, Server Actions, Route Handlers) -> use **cookies**
- **Only the browser needs it** -> use **localStorage** (or React state)

2) **Should JavaScript be allowed to read it?**

- **No** (auth/session tokens) -> use **httpOnly cookies**
- **Yes** (theme, UI preferences, convenience hints) -> use **localStorage**

### What cookies are in this app

- `mah-auth-staff` (JWT) - staff access (guestlist)
- `mah-auth-admin` (JWT) - admin access (admin dashboard + admin-only routes)
- `mah-auth-upload` (JWT) - upload access (optional; see upload note)
- `mah-bd-voter` (opaque id) - best-dressed per-device vote identity

Cookies are sent automatically by the browser on same-site requests, which makes them the only practical way to do server-authenticated App Router pages without pushing everything into `"use client"`.

---

## Feature-by-feature: what we store where (and why)

### Guestlist (`/guestlist`)

- **Auth**: JWT in **httpOnly cookie** (`mah-auth-staff` or `mah-auth-admin`)
- **Why**: server page can gate access and render initial data; client polling can stay lightweight
- **Client storage**: none for auth (no `staffToken`/`adminToken` in localStorage anymore)

### Admin (`/admin`)

- **Auth**: JWT in **httpOnly cookie** (`mah-auth-admin`)
- **Step-up**: still uses `POST /api/admin/step-up` and includes `x-admin-step-up`
- **Why**: server can gate the page and reduce client auth plumbing; destructive actions still require step-up

### Best dressed (`/best-dressed`)

- **Auth**: generally **no staff/admin auth** required to vote
- **Voter identity**: cookie (`mah-bd-voter`) for "one vote per device" and session enforcement
- **Client storage**: `localStorage["bestDressedVote"]` is a **UX hint** (not the source of truth)
- **Why**: server is the source of truth (cookie + Redis); localStorage is only for convenience UI

### Upload (`/upload`)

- **Auth**: currently still supports a client-stored token (upload is a client-driven presign/upload/finalize flow)
- **Client storage**: `uploadToken` / `adminToken` in `localStorage` for the upload dashboard
- **Why**: the browser needs the token to call presign/finalize endpoints and perform multi-request uploads
- **Future option**: migrate upload to cookie-backed auth too, but keep in mind CSRF + multi-part upload ergonomics

### Theme + reading preferences (site-wide)

- **Client storage**: theme preference in `localStorage` (non-sensitive)
- **Why**: this is a pure client preference and we want instant paint without network calls

---

## Why the previous model was weaker here

### The old pattern

- Store JWT in `localStorage`/`sessionStorage`
- Make pages `"use client"`
- Fetch initial data in `useEffect` from `/api/*`
- Do mutations via `/api/*` from client code

### Problems it creates (mental model)

1) **The server is blind**

Server Components / Server Actions cannot see browser storage. That forces the app into a client-first architecture even for pages that should be server-rendered.

2) **You can’t “render authenticated HTML”**

If auth is only in localStorage, the server can't know you're logged in while rendering HTML.
Result: you render a shell, then `useEffect` fetches, then the UI fills in (slower, more moving parts).

3) **More `useEffect` + more traffic amplifiers**

Every client fetch is an effect with dependencies. In a page with timers, polling, or frequent re-renders, it’s easy to accidentally restart effects and spike reads.

This repo already hit that exact failure mode:

- see `docs/postmortem-guestlist-kv-read-spike.md`

4) **Harder to use App Router primitives**

Server rendering, `loading.tsx`, caching/revalidation, and Server Actions become less useful when auth is only client-side.

5) **Security footgun**

Bearer tokens in localStorage are readable by JS, which raises the blast radius of any XSS.
httpOnly cookies reduce that risk by making the token inaccessible to client JS.

---

## Decision rules (quick)

- If you need the server to decide anything (gate a page, fetch initial data, run a Server Action) -> **cookie**
- If it’s a client-only preference or hint -> **localStorage**
- Avoid `sessionStorage` unless you have a very specific reason (debuggability and “tab lost state” issues)

