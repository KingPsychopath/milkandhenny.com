# Service worker cache recovery

`/sw.js` must always bypass Cloudflare's cache. The application also serves it
with `Cache-Control: no-cache, max-age=0, must-revalidate`, and registration uses
`updateViaCache: "none"`. Keep all three controls active.

GitHub Actions doesn't purge `/sw.js`. If Cloudflare unexpectedly serves a
cached service worker, recover it manually.

## Confirm the problem

Run the request several times:

```bash
for attempt in 1 2 3; do
  curl -fsSI "https://milkandhenny.com/sw.js?check=${attempt}" |
    grep -Ei '^(cache-control|cf-cache-status|service-worker-allowed):'
done
```

Expected results:

- `CF-Cache-Status: DYNAMIC`
- `Cache-Control: no-cache, max-age=0, must-revalidate`
- `Service-Worker-Allowed: /`

## Recover manually

1. In Cloudflare, open the `milkandhenny.com` zone.
2. Confirm the cache rule that bypasses `/sw.js` is enabled. Restore it before
   purging if it was disabled or changed.
3. Open **Caching > Configuration > Purge Cache > Custom Purge**.
4. Purge the exact URL `https://milkandhenny.com/sw.js`.
5. Repeat the verification command above. Every response must remain
   `CF-Cache-Status: DYNAMIC`.

If the response is still cached, inspect the matching cache rules and their
order. Don't add a routine purge or deploy-time purge. The permanent fix is for
`/sw.js` to bypass Cloudflare's cache.
