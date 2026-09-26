# Passkey ceremony migration

Status: opt-in Postgres backend verified locally. Production remains on Redis. Set
`PASSKEY_CEREMONY_STORE=postgres` only after a fresh source check under the planned writer freeze.
The supplied 2026-09-26 RDB has no `attendee-passkey:ceremony:v1:*` keys. Any keys in the final
export must be imported with their original expiry or allowed to expire during a five-minute
maintenance drain before the switch.

The backend uses an HMAC of the 24-character ceremony ID under `AUTH_SECRET`. The JSON ceremony
record retains its challenge, session binding, origin, RP ID and optional person context. A
single `DELETE ... RETURNING` consumes it atomically; an expired or already consumed ceremony
cannot authenticate. Daily maintenance removes expired rows in bounded batches. Keep
`AUTH_SECRET` stable through the ceremony lifetime.

When `RATE_LIMIT_STORE=postgres`, attendee email login, passkey and TOTP throttles use the shared
Postgres fixed-window limiter. Their Redis behavior remains the default until the corresponding
active source windows are reconciled. The supplied export has no keys in those three rate-limit
families; recheck the final snapshot. Action-link redemption and Pitch recovery also use the
shared limiter when selected. Report submission and multiplayer command throttles still have
their own migration work and block the overall Redis retirement gate.
