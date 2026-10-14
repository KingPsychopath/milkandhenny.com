# Canonical host and redirects

The production origin is `https://milkandhenny.com`. Cloudflare permanently redirects
`https://www.milkandhenny.com` to that origin while preserving the path and query string.
Railway keeps both domains attached for TLS and origin ownership.

## Authenticated requests

A client or proxy can drop `Authorization` when following a redirect. The symptom is a successful
login followed by a `401` from a protected endpoint.

CLI authentication resolves the final origin before sending credentials or looking up a stored
session. `auth sessions`, `auth revoke`, and `auth diagnose` use that origin consistently.
Prefer the canonical origin in scripts and API clients.

If verification succeeds but protected probes fail, check the redirect and header handling first,
then confirm that the server instances use the same `AUTH_SECRET`. Use the CLI's browser login
and diagnostics described in [admin control](admin-control.md).
