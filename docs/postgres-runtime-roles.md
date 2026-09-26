# Postgres migration and runtime roles

Status: local role separation verified; production still uses the `postgres` superuser for the
web connection. Do not switch production credentials until the release and backup gates in
[the migration plan](../plan.md) pass.

The application now supports two schema startup modes:

| `DATABASE_SCHEMA_MODE` | Startup behavior                                                                          | Credential                                 |
| ---------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------ |
| `migrate` (default)    | Apply ordered migrations under an advisory lock, then start scheduled work                | Existing privileged development credential |
| `verify`               | Read and verify every migration checksum and required pitch-document schema; issue no DDL | Non-superuser runtime credential           |

Migration errors keep database readiness failed. The release process must run
`DATABASE_URL=<administrator URL> pnpm database:migrate` before starting a `verify` runtime.
The command is safe to rerun with unchanged source migrations. For preflight, run
`DATABASE_URL=<runtime URL> pnpm database:verify` using the exact web/worker credential.
Do not put a privileged migration URL in web or worker environments.

Install [the runtime-role grants](../ops/postgres-runtime-role.sql) as the owner of public
migrations. It creates a no-login `mah_app_runtime` role, grants DML on existing public tables,
usage on their sequences, and default grants for future tables created by the same migration
owner. The role has no schema CREATE permission. Enable LOGIN and set its password
interactively in `psql`; store its URL as the runtime `DATABASE_URL`. Keep the administrator URL
only in the deploy/migration secret scope. Re-run the grant script after a migration-owner
change and before switching a runtime to a newly created table.

Before production credential change, prove all of the following with the runtime connection:

- `current_user = 'mah_app_runtime'` and its `rolsuper`, `rolcreaterole` and `rolcreatedb` flags
  are false.
- `has_schema_privilege(current_user, 'public', 'CREATE')` and
  `has_schema_privilege(current_user, 'legacy_archive', 'USAGE')` are false.
- `has_table_privilege(current_user, 'diagnostic_legacy_reports', 'SELECT')` is false
  after migration `0104`; current diagnostic reports remain readable.
- `has_table_privilege(current_user, 'best_dressed_legacy_votes', 'SELECT')` is false
  after migration `0105`; active voting tables remain accessible.
- `pnpm database:verify` succeeds, representative web/worker reads and writes succeed, and
  the [guest archive importer](./legacy-guest-archive.md) remains the only archive login.

The live production web role was observed as `postgres` with `rolsuper=true` on 2026-09-26.
Until that credential is replaced and production access checks pass, the restricted archive
must not be installed or imported there.
