import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Client } from "pg";

const HASH = /^[a-f0-9]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TYPES = new Set([
  "client_error",
  "site_feedback",
  "draw_country_result_issue",
  "things_room_issue",
  "pitch_issue",
  "upload_issue",
]);
const STATUSES = new Set(["new", "investigating", "resolved", "ignored", "duplicate"]);

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid report timestamp");
  return new Date(value).toISOString();
}

function parseSource(bytes) {
  const source = JSON.parse(bytes.toString("utf8"));
  if (!source || !Array.isArray(source.reports) || !Array.isArray(source.state))
    throw new Error("Invalid report export");
  const seen = new Set();
  const current = [];
  const legacy = [];
  for (const row of source.reports) {
    if (!row || typeof row.key !== "string" || seen.has(row.key))
      throw new Error("Invalid or duplicate report key");
    seen.add(row.key);
    const value = row.value;
    if (
      !value ||
      typeof value !== "object" ||
      Array.isArray(value) ||
      !UUID.test(value.id) ||
      !TYPES.has(value.type) ||
      typeof value.subjectKey !== "string" ||
      !value.subjectKey ||
      typeof value.createdAt !== "string" ||
      !row.key.endsWith(`:${value.id}`)
    )
      throw new Error("Invalid report record");
    const expiresAt = timestamp(row.expiresAt);
    const createdAt = timestamp(value.createdAt);
    if (Date.parse(expiresAt) <= Date.parse(createdAt))
      throw new Error("Report expiry precedes creation");
    if (row.key.startsWith("diagnostic-report:v1:")) {
      if (
        row.key !== `diagnostic-report:v1:${value.id}` ||
        !STATUSES.has(value.status) ||
        !["low", "medium", "high"].includes(value.severity) ||
        !["user", "automatic"].includes(value.source) ||
        !value.context ||
        typeof value.context !== "object" ||
        Array.isArray(value.context)
      )
        throw new Error("Invalid current diagnostic report");
      current.push({
        key: row.key,
        value,
        createdAt,
        expiresAt,
        updatedAt: timestamp(value.updatedAt),
      });
    } else if (row.key === `user-report:v1:${value.id}`) {
      legacy.push({ key: row.key, value, expiresAt });
    } else {
      throw new Error("Unknown report key format");
    }
  }
  const state = source.state.map((row) => {
    if (!row || typeof row.key !== "string" || typeof row.value !== "string" || seen.has(row.key))
      throw new Error("Invalid or duplicate report state key");
    seen.add(row.key);
    const expiresAt = timestamp(row.expiresAt);
    const families = [
      ["diagnostic-report:rate:v1:", "rate"],
      ["diagnostic-report:duplicate:v1:", "duplicate"],
      ["diagnostic-report:idempotency:v1:", "idempotency"],
      ["diagnostic-report:follow-up-lock:v1:", "follow-up-lock"],
    ];
    const found = families.find(([prefix]) => row.key.startsWith(prefix));
    if (!found) throw new Error("Unknown report state key");
    const [, kind] = found;
    if (kind === "follow-up-lock")
      throw new Error("Active report follow-up lock must drain before import");
    const suffix = row.key.slice(found[0].length);
    if (!suffix) throw new Error("Empty report state identity");
    if (kind === "rate") {
      const count = Number(row.value);
      if (!/^[0-9]+$/.test(row.value) || !Number.isSafeInteger(count) || count < 1)
        throw new Error("Invalid report rate count");
      return {
        kind,
        hash: createHash("sha256").update(suffix).digest("hex"),
        count: Math.min(count, 8),
        expiresAt,
      };
    }
    if (!UUID.test(row.value) || !current.some(({ value }) => value.id === row.value))
      throw new Error("Report receipt references an absent current report");
    return {
      kind,
      hash: createHash("sha256").update(suffix).digest("hex"),
      reportId: row.value,
      expiresAt,
    };
  });
  return { current, legacy, state };
}

async function main() {
  const [sourceHash, filePath] = process.argv.slice(2);
  if (!HASH.test(sourceHash ?? "") || !filePath || !isAbsolute(filePath))
    throw new Error(
      "Usage: node ops/import-diagnostic-reports.mjs <rdb-sha256> <absolute-private-json-path>",
    );
  const file = await stat(filePath);
  if (!file.isFile() || file.size > 16 * 1024 * 1024 || (file.mode & 0o077) !== 0)
    throw new Error("Input must be a private regular JSON file no larger than 16 MiB");
  const source = parseSource(await readFile(filePath));
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    for (const table of [
      "diagnostic_reports",
      "diagnostic_legacy_reports",
      "diagnostic_report_receipts",
      "diagnostic_report_rates",
    ]) {
      const existing = await client.query(
        `select count(*)::integer as total,
                count(*) filter (where source_rdb_sha256 = $1)::integer as matching
           from ${table}`,
        [sourceHash],
      );
      if (existing.rows[0].total !== existing.rows[0].matching)
        throw new Error(`${table} contains runtime or another export's rows`);
    }
    for (const row of source.current) {
      const record = JSON.stringify(row.value);
      await client.query(
        `insert into diagnostic_reports
           (id, type, subject_key, severity, status, source, created_at,
            updated_at, expires_at, record, source_rdb_sha256, source_key)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12)
         on conflict (id) do nothing`,
        [
          row.value.id,
          row.value.type,
          row.value.subjectKey,
          row.value.severity,
          row.value.status,
          row.value.source,
          row.createdAt,
          row.updatedAt,
          row.expiresAt,
          record,
          sourceHash,
          row.key,
        ],
      );
      const verified = await client.query(
        `select 1 from diagnostic_reports where id = $1 and record = $2::jsonb
           and expires_at = $3 and source_rdb_sha256 = $4 and source_key = $5`,
        [row.value.id, record, row.expiresAt, sourceHash, row.key],
      );
      if (verified.rowCount !== 1) throw new Error("Diagnostic report import conflict");
    }
    for (const row of source.legacy) {
      const record = JSON.stringify(row.value);
      await client.query(
        `insert into diagnostic_legacy_reports
           (source_key, source_rdb_sha256, original_record, expires_at)
         values ($1, $2, $3::jsonb, $4) on conflict (source_key) do nothing`,
        [row.key, sourceHash, record, row.expiresAt],
      );
      const verified = await client.query(
        `select 1 from diagnostic_legacy_reports
           where source_key = $1 and source_rdb_sha256 = $2
             and original_record = $3::jsonb and expires_at = $4`,
        [row.key, sourceHash, record, row.expiresAt],
      );
      if (verified.rowCount !== 1) throw new Error("Legacy report import conflict");
    }
    for (const row of source.state) {
      if (row.kind === "rate") {
        await client.query(
          `insert into diagnostic_report_rates
             (fingerprint_hash, count, expires_at, source_rdb_sha256)
           values ($1,$2,$3,$4) on conflict (fingerprint_hash) do nothing`,
          [row.hash, row.count, row.expiresAt, sourceHash],
        );
        const verified = await client.query(
          `select 1 from diagnostic_report_rates where fingerprint_hash = $1
             and count = $2 and expires_at = $3 and source_rdb_sha256 = $4`,
          [row.hash, row.count, row.expiresAt, sourceHash],
        );
        if (verified.rowCount !== 1) throw new Error("Report rate import conflict");
      } else {
        await client.query(
          `insert into diagnostic_report_receipts
             (key_hash, kind, report_id, expires_at, source_rdb_sha256)
           values ($1,$2,$3,$4,$5) on conflict (key_hash) do nothing`,
          [row.hash, row.kind, row.reportId, row.expiresAt, sourceHash],
        );
        const verified = await client.query(
          `select 1 from diagnostic_report_receipts where key_hash = $1 and kind = $2
             and report_id = $3 and expires_at = $4 and source_rdb_sha256 = $5`,
          [row.hash, row.kind, row.reportId, row.expiresAt, sourceHash],
        );
        if (verified.rowCount !== 1) throw new Error("Report receipt import conflict");
      }
    }
    await client.query("commit");
    console.log(
      `diagnostic_reports=${source.current.length} legacy_reports=${source.legacy.length} report_state=${source.state.length}`,
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
