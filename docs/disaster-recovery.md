# Disaster recovery

## Recovery targets

- PostgreSQL relational product state, including events, tickets, scoring, communications, and
  Pitch Night: 24-hour recovery point; 4-hour recovery time.
- Permanent object-storage media: 24-hour recovery point; 8-hour recovery time.
- Redis sessions, rate limits, live games, Pitch Night rooms, private transfers, and expiring word
  shares: no application-managed restore guarantee. Most are short-lived by design; any durable
  Redis-backed content requires a provider backup policy before it can claim a recovery target.
- Admin-authored writing: daily checksummed word archive plus permanent media backup; 24-hour recovery point target. Git-owned writing and application configuration restore from Git and the deployment environment.

These are operating targets, not provider guarantees. Confirm that the selected database and object-storage plans can meet them before launch.

## PostgreSQL backup

Run this from a trusted maintenance host with PostgreSQL client tools. The command refuses to overwrite an archive. It also verifies the archive catalogue and writes a SHA-256 metadata file.

```bash
DATABASE_URL=… pnpm backup:postgres /absolute/secure/path/milkandhenny-YYYY-MM-DD.dump
```

Encrypt the archive at rest and copy it to a different account or failure domain. Keep at least 7 daily and 4 weekly archives. Never put an archive or database URL in git.

## PostgreSQL restore drill

Create a separate empty database. Never use the live database for a drill. The restore command verifies the SHA-256 and byte count against its adjacent `.dump.json` file before connecting, checks that the public schema has no tables, and uses one transaction. Retain the sidecar with every archive.

```bash
DATABASE_URL=… pnpm restore:postgres /absolute/secure/path/milkandhenny-YYYY-MM-DD.dump --confirm-empty-target
```

After restore:

1. Start the application against the restored database and isolated Redis and object storage.
2. Check `/api/health`.
3. Verify representative event/ticket, scoring, communication-outbox, and Pitch Night records.
4. Record the archive date, restore duration, operator, and result outside the repository.
5. Delete the drill environment and its credentials.

Run this drill before launch and every quarter.

## Object storage

Enable the provider's object versioning or scheduled replication if the selected S3-compatible provider supports it. Otherwise, run a daily `rclone copy` from the production bucket to a new dated prefix in an encrypted bucket in a separate account. Never mirror source deletions into the only backup. Retain at least 7 daily and 4 weekly versions; expire old prefixes separately after verification. Use a read-only source credential and a write-only backup credential. Include all permanent media prefixes. Private transfers can be excluded because they expire and are not a system of record.

Test a restore of one image, one video, and one document every quarter. Verify the object key, content type, byte size, and checksum before replacing any production object.

## Incident restore order

1. Stop writes or direct traffic to a maintenance response.
2. Preserve logs and the failed system for investigation.
3. Create new database and storage resources. Do not restore over the failed resources.
4. Restore PostgreSQL, then permanent objects, then deploy the recorded application commit.
5. Rotate credentials if exposure caused the incident.
6. Check health, sign-in, an event, a ticket, an upload, email queue state, and Pitch Night.
7. Move traffic only after the checks pass. Keep the failed environment until the incident review is complete.

## Word metadata and index recovery

With the source Redis and object-storage credentials exported on a trusted maintenance host:

```bash
pnpm backup:words /absolute/secure/path/words-YYYY-MM-DD.json
```

The archive includes public, unlisted, and private content, visibility, body keys, dates, tags, and
media references, with a SHA-256 integrity check. Missing bodies or inconsistent index membership fail the export. It never includes
sessions or share tokens. Protect this file like a database backup, encrypt the off-host copy, and
retain the same daily/weekly versions. Media binaries are restored from the corresponding object
backup. The command refuses to overwrite an archive. Supply credentials explicitly; it does not
implicitly load the developer's environment file.

For a drill, select empty isolated Redis and object storage, restore permanent media first, then:

```bash
pnpm restore:words /absolute/secure/path/words-YYYY-MM-DD.json --confirm-empty-target
```

Verify one public word and one private draft, timestamps, markdown, image/media references, and the
admin listing. Restore recreates metadata and the index together and refuses existing metadata.
A failed partial restore should be investigated and repeated in a fresh isolated target. Archive
creation must run in a quiet write window; it is not a cross-provider point-in-time snapshot.
Provider backup schedules, off-host retention, and a real-provider drill remain operational checks.
The local regression drill verifies a complete public/private loss and reconstruction using test storage.

For a suspected interrupted word write, run `pnpm inspect:words` first. It checks independent
metadata keys against the index and reports missing bodies without exposing their content.
`pnpm inspect:words --repair-index` repairs only provable index membership using atomic existence
checks. Missing bodies require the last verified archive/object version; do not infer visibility
from an orphaned blob or publish it. Retain the last verified archive before a planned repair. Re-run inspection after index repair, then
create a fresh archive when every body is readable. Object deletion and visibility moves span providers and
still require recovery if interrupted; index repair does not pretend to make those atomic.
