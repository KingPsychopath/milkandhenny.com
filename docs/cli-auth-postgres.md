# CLI authorization migration

Status: opt-in Postgres backend verified locally. Production remains on Redis. Set
`AUTH_CLI_STORE=postgres` only after the planned writer freeze and source reconciliation. The
supplied 2026-09-26 RDB contains no active `auth:cli-*` request, approval, code or claim keys.
The user accepted the 2026-09-26 export as the cutoff, so later handshakes are outside the
preservation requirement. Freeze the old writer before switching; no handshake in the accepted
export may be silently dropped.

The browser request ID and authorization code are HMAC lookup keys under `AUTH_SECRET`; the
one-minute code's bearer token and the recoverable callback redirect are encrypted with
AES-256-GCM. A request row lock serializes approve and deny. Approval creates the code, stores its
redirect and registers the JWT session in one Postgres transaction. PKCE verification and code
consumption occur under a row lock, so concurrent exchanges return one token at most. A retry of
an approved or denied request returns the same redirect while its receipt is live.

Use `AUTH_TOKEN_STORE=postgres` alongside `AUTH_CLI_STORE=postgres` for a Redis-free CLI login
path. Attendee sessions and other Redis-backed features retain their own cutover gates. The daily
auth cleanup removes expired request and code rows in bounded batches. Keep `AUTH_SECRET` stable
through the outstanding request/code lifetime, since it authenticates lookup and encryption.
