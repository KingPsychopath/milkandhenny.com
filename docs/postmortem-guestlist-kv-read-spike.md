# Postmortem: Guestlist KV Read Spike (Local Dev)

## Incident

While developing the door-staff guestlist page, KV/Upstash reads jumped sharply (reported: ~42k -> ~88k, with ~96k reads in a single day). The local dev console was also flooded with:

- `GET /api/guests 200 ...`

This nearly exhausted the KV free tier for the day.

## Impact

- Significant and unexpected KV command usage from a single local browser tab.
- Local dev console spam, making real issues hard to notice.

## Root Cause

Two changes interacted badly:

1. The guestlist page added a 1-second UI tick to display "voting open (Xm left)" for best-dressed.
2. The guestlist page passed an inline `onUnauthorized` callback into `useGuests(...)`.

Because the UI tick caused a re-render every second, the inline callback became a *new function each render*, which caused the `useGuests` polling effect to restart and immediately refetch guests.

Result: the intended polling rate (seconds) accidentally became ~**1 request / second**.

## Why This Was Easy To Miss

- The bug looked like "just logs" in dev, but every log line was a real KV-backed API request.
- React Strict Mode can amplify "effect correctness" issues in dev (double-invocation), so code must be idempotent and cleanup must be correct. This incident was not *caused* by Strict Mode, but Strict Mode is a good forcing function to write safer effects.

## Fix

Layered fixes were applied so a single regression can't recreate the incident:

### 1) Make `useGuests` resilient to parent re-renders

- Store `onUnauthorized` in a ref (`onUnauthorizedRef`) so changes to the callback identity don't restart polling.

### 2) Only re-render each second while voting is open

- The 1-second tick on the guestlist page now runs only when the voting window is actively open.

### 3) Hard safety net: minimum fetch gap

Even if a future refactor reintroduces a render loop, `useGuests` enforces a minimum gap between guest fetches:

- `MIN_GUEST_FETCH_GAP_MS = 2000`

So `/api/guests` cannot be hit at ~1req/sec again.

### 4) Retry logic: never retry 4xx

Retry loops can multiply traffic quickly. The shared `fetchWithRetry` helper follows a strict rule:

- Never retry 4xx (401/403/400/etc).
- Only retry transient failures (network errors and 5xx).

This is unit-tested.

### 5) Reduce polling defaults (usage reduction)

Polling is now:

- Foreground: 10s
- Background: 60s

This halves reads vs the previous 5s/30s behavior while still feeling "live" for door staff.

## Verification / Regression Guard

- Added unit tests for `fetchWithRetry`:
  - does not retry on 401
  - retries on 500 then succeeds
- Lint/typecheck/tests pass with:
  - TypeScript `strict: true`
  - React Strict Mode enabled in `next.config.ts` (`reactStrictMode: true`)

## Lesson

When a page is allowed to re-render frequently (timers, animations, live countdowns), treat any `useEffect` that fetches data as a potential "traffic amplifier". Defensive measures (stable deps, refs for callbacks, minimum fetch gaps, and conservative retry rules) prevent expensive regressions.

