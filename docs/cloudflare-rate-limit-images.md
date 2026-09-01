# Public-media rate limiting

Status: operator intent; deployed Cloudflare rules remain external configuration

Public album media is served from the proxied `VITE_MEDIA_PUBLIC_URL` hostname. Private transfer
objects have no public bucket hostname; the application authorizes a protected media route before
issuing a short-lived signed read.

## Rule intent

Create a zone-level Cloudflare rate-limiting rule for the public media host and the published album
prefix:

```text
http.host eq "pics.milkandhenny.com"
and starts_with(http.request.uri.path, "/albums/")
and http.request.method in {"GET" "HEAD"}
```

Track by source IP and include cached-asset requests when the goal is to limit scraping rather than
only protect the origin. Choose the request period, threshold, action, and mitigation timeout from
observed normal gallery bursts and the options available on the current Cloudflare plan. Do not
copy an old plan limit or price from repository history.

If protected transfer-link generation is being abused, add a separate rule on the application host
for its media route. Keep it separate from public albums because the traffic profile and security
meaning differ.

Current Cloudflare configuration concepts and dashboard steps are documented in the official
[rate-limiting rules](https://developers.cloudflare.com/waf/rate-limiting-rules/) and
[dashboard creation](https://developers.cloudflare.com/waf/rate-limiting-rules/create-zone-dashboard/)
guides.

## Verification

1. Confirm the media hostname is proxied through Cloudflare and the rule expression matches only
   the intended host, methods, and prefix.
2. Load a large album normally on desktop and mobile. Responsive image bursts must remain below the
   threshold.
3. Send a controlled burst above the threshold from a test client and confirm the configured action
   occurs without blocking the application host.
4. Check the public R2 bucket's request metrics before and after the test. Cloudflare documents the
   current dashboard and GraphQL views in [R2 metrics and
   analytics](https://developers.cloudflare.com/r2/platform/metrics-analytics/).
5. Record the deployed expression, threshold, action, owner, and review date in the operator's
   Cloudflare configuration or infrastructure inventory.

Review the rule after a gallery traffic change, a Cloudflare plan change, or an incident. Provider
configuration is not proven merely because this runbook exists.
