import { readFile, stat } from "node:fs/promises";
import { Client } from "pg";

type SourceStatus = {
  lastHeartbeatAt?: string;
  lastProcessedAt?: string;
  lastErrorAt?: string;
  lastErrorMessage?: string;
};

const FIELDS = new Set(["lastHeartbeatAt", "lastProcessedAt", "lastErrorAt", "lastErrorMessage"]);

function parseStatus(raw: unknown): SourceStatus {
  if (!raw || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("Invalid worker status source");
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !FIELDS.has(key)))
    throw new Error("Unexpected worker status field");
  for (const key of ["lastHeartbeatAt", "lastProcessedAt", "lastErrorAt"] as const) {
    if (
      value[key] !== undefined &&
      (typeof value[key] !== "string" || !Number.isFinite(Date.parse(value[key])))
    )
      throw new Error("Invalid worker status timestamp");
  }
  if (
    value.lastErrorMessage !== undefined &&
    (typeof value.lastErrorMessage !== "string" || value.lastErrorMessage.length > 500)
  )
    throw new Error("Invalid worker status message");
  return value as SourceStatus;
}

async function main() {
  const [sourcePath, rdbHash] = process.argv.slice(2);
  if (!sourcePath || !/^[a-f0-9]{64}$/.test(rdbHash ?? ""))
    throw new Error(
      "Usage: tsx ops/import-media-worker-status.ts <private-status-json> <rdb-sha256>",
    );
  const info = await stat(sourcePath);
  if (!info.isFile() || (info.mode & 0o077) !== 0) throw new Error("Source file must be private");
  const source = parseStatus(JSON.parse(await readFile(sourcePath, "utf8")) as unknown);
  const url = process.env.DATABASE_URL?.trim();
  if (!url) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("begin");
    const existing = await client.query<{
      source_rdb_sha256: string | null;
      last_heartbeat_at: Date | null;
      last_processed_at: Date | null;
      last_error_at: Date | null;
      last_error_message: string | null;
    }>(
      `select source_rdb_sha256, last_heartbeat_at, last_processed_at,
              last_error_at, last_error_message
         from media_worker_instances
        where deployment_id='legacy-rdb' for update`,
    );
    const hasSource = Object.keys(source).length > 0;
    if (existing.rows.length > 1 || (!hasSource && existing.rows.length))
      throw new Error("Target has conflicting legacy worker status");
    const previous = existing.rows[0];
    if (previous) {
      if (
        previous.source_rdb_sha256 !== rdbHash ||
        previous.last_heartbeat_at?.toISOString() !== (source.lastHeartbeatAt ?? undefined) ||
        previous.last_processed_at?.toISOString() !== (source.lastProcessedAt ?? undefined) ||
        previous.last_error_at?.toISOString() !== (source.lastErrorAt ?? undefined) ||
        (previous.last_error_message ?? undefined) !== source.lastErrorMessage
      )
        throw new Error("Target has conflicting legacy worker status");
    } else if (hasSource) {
      const timestamp = [source.lastHeartbeatAt, source.lastProcessedAt, source.lastErrorAt]
        .filter((value): value is string => !!value)
        .sort()[0];
      if (!timestamp) throw new Error("Worker status has no timestamp");
      const id = `${rdbHash!.slice(0, 8)}-${rdbHash!.slice(8, 12)}-${rdbHash!.slice(12, 16)}-${rdbHash!.slice(16, 20)}-${rdbHash!.slice(20, 32)}`;
      await client.query(
        `insert into media_worker_instances
           (instance_id, deployment_id, started_at, last_heartbeat_at,
            last_processed_at, last_error_at, last_error_message, stopped_at,
            source_rdb_sha256)
         values ($1,'legacy-rdb',$2,$3,$4,$5,$6,now(),$7)`,
        [
          id,
          timestamp,
          source.lastHeartbeatAt ?? null,
          source.lastProcessedAt ?? null,
          source.lastErrorAt ?? null,
          source.lastErrorMessage ?? null,
          rdbHash,
        ],
      );
    }
    await client.query("commit");
    console.log(`legacy_media_worker_status=${hasSource ? 1 : 0}`);
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
