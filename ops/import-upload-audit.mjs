import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Client } from "pg";

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseEvents(bytes) {
  const values = JSON.parse(bytes.toString("utf8"));
  if (!Array.isArray(values) || values.length > 20) {
    throw new Error("Upload audit must be an array of at most 20 events");
  }
  const seen = new Set();
  return values.map((value, index) => {
    if (
      !value ||
      typeof value !== "object" ||
      !UUID.test(value.id) ||
      !["opened", "closed"].includes(value.action) ||
      typeof value.at !== "string" ||
      !Number.isFinite(Date.parse(value.at)) ||
      (value.durationMinutes !== undefined && ![15, 60].includes(value.durationMinutes))
    ) {
      throw new Error(`Invalid upload audit event at list index ${index}`);
    }
    const identity = `${value.id}:${value.action}`;
    if (seen.has(identity)) throw new Error(`Duplicate upload audit event at list index ${index}`);
    seen.add(identity);
    return {
      id: value.id,
      action: value.action,
      at: new Date(value.at).toISOString(),
      duration: value.durationMinutes ?? null,
      index,
    };
  });
}

async function main() {
  const [sourceHash, filePath] = process.argv.slice(2);
  if (!HASH.test(sourceHash ?? "") || !filePath || !isAbsolute(filePath)) {
    throw new Error(
      "Usage: node ops/import-upload-audit.mjs <rdb-sha256> <absolute-private-json-path>",
    );
  }
  const file = await stat(filePath);
  if (!file.isFile() || file.size > 64 * 1024 || (file.mode & 0o077) !== 0) {
    throw new Error("Input must be a private regular JSON file no larger than 64 KiB");
  }
  const events = parseEvents(await readFile(filePath));
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      "select window_id, action, at, duration_minutes, source_rdb_sha256, source_list_index from upload_access_audit order by source_list_index",
    );
    if (existing.rows.some((row) => row.source_rdb_sha256 !== sourceHash)) {
      throw new Error("Upload audit already contains runtime or another export's events");
    }
    for (const event of events) {
      await client.query(
        `insert into upload_access_audit
           (window_id, action, at, duration_minutes, source_rdb_sha256, source_list_index)
         values ($1, $2, $3, $4, $5, $6)
         on conflict (window_id, action) do nothing`,
        [event.id, event.action, event.at, event.duration, sourceHash, event.index],
      );
    }
    const stored = await client.query(
      "select window_id, action, at, duration_minutes, source_list_index from upload_access_audit where source_rdb_sha256 = $1 order by source_list_index",
      [sourceHash],
    );
    if (
      stored.rows.length !== events.length ||
      stored.rows.some((row, index) => {
        const event = events[index];
        return (
          row.window_id !== event.id ||
          row.action !== event.action ||
          row.at.toISOString() !== event.at ||
          row.duration_minutes !== event.duration ||
          row.source_list_index !== event.index
        );
      })
    ) {
      throw new Error("Upload audit import did not reconcile by event and list index");
    }
    await client.query("commit");
    console.log(
      JSON.stringify({ event: "upload_audit.imported", sourceHash, count: events.length }),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Upload audit import failed");
  process.exitCode = 1;
});
