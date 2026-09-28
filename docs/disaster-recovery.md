# Disaster recovery

## Recovery targets

- PostgreSQL product state, including events, tickets, writing, albums, sessions, rooms, transfers,
  queues, scoring, communications, and Pitch Night: 24-hour recovery point; 4-hour recovery time.
- Permanent object-storage media: 24-hour recovery point; 8-hour recovery time.
- Admin-authored writing and its metadata are included in the PostgreSQL backup; permanent media
  needs its corresponding object backup. Git-owned writing and application configuration restore
  from Git and the deployment environment.

These are operating targets, not provider guarantees. Confirm that the selected database and object-storage plans can meet them before launch.

## PostgreSQL backup

Run this from a trusted maintenance host with PostgreSQL client tools. The command refuses to overwrite an archive. It also verifies the archive catalogue and writes a SHA-256 metadata file.

```bash
DATABASE_URL=… pnpm backup:postgres /absolute/secure/path/milkandhenny-YYYY-MM-DD.dump
```

Encrypt the archive at rest and copy it to a different account or failure domain. Keep at least 7 daily and 4 weekly archives. Never put an archive or database URL in git.

For the current production deployment, the owner chose Railway-managed daily and weekly volume
backups without an external backup destination. This narrows recovery to what remains available in
the Railway project; deleting the volume also deletes its Railway backups. Confirm the schedules
are enabled in the Postgres service before relying on the 24-hour recovery target. The one-time
encrypted local dump and restore drill are recorded in `plan.md`; they are not a recurring schedule.

## PostgreSQL restore drill

Create a separate empty database. Never use the live database for a drill. The restore command verifies the SHA-256 and byte count against its adjacent `.dump.json` file before connecting, checks that the public schema has no tables, and uses one transaction. Retain the sidecar with every archive.

```bash
DATABASE_URL=… pnpm restore:postgres /absolute/secure/path/milkandhenny-YYYY-MM-DD.dump --confirm-empty-target
```

After restore:

1. Start the application against the restored database and isolated object storage, with the same
   Postgres store selectors as production and no Redis connection variables.
2. Check `/api/health`.
3. Verify representative event/ticket, word, album, transfer, media-job, room, scoring,
   communication-outbox, and Pitch Night records.
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
4. Restore PostgreSQL and the matching permanent objects, then deploy the recorded application commit.
5. Rotate credentials if exposure caused the incident.
6. Check health, sign-in, an event, a ticket, writing, albums, private transfers, media queue,
   multiplayer recovery, email queue state, and Pitch Night.
7. Move traffic only after the checks pass. Keep the failed environment until the incident review is complete.

## Writing and album recovery

Word and album metadata are PostgreSQL-owned in production. Restore the PostgreSQL dump together
with the corresponding private and public object versions. Check one public word, one private
draft, one published album, and one unpublished album before reopening writes. Pending object
copies and deletions are durable database intents; start the media worker only after both stores
are available and let it resume those intents. Audit references against R2 before treating the
restore as complete. The pre-cutover Redis word archive commands are legacy migration tools and
must not be used as the production recovery path.
