import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Client } from "pg";

const HASH = /^[a-f0-9]{64}$/;
const ROLES = new Set(["admin", "upload", "staff"]);

async function main() {
  const [sourceHash, filePath] = process.argv.slice(2);
  if (!HASH.test(sourceHash ?? "") || !filePath || !isAbsolute(filePath)) {
    throw new Error(
      "Usage: node ops/import-auth-token-versions.mjs <rdb-sha256> <absolute-private-json-path>",
    );
  }
  const file = await stat(filePath);
  if (!file.isFile() || file.size > 4096 || (file.mode & 0o077) !== 0) {
    throw new Error("Input must be a private regular JSON file no larger than 4 KiB");
  }
  const versions = JSON.parse((await readFile(filePath)).toString("utf8"));
  if (!versions || typeof versions !== "object" || Array.isArray(versions)) {
    throw new Error("Auth versions must be a JSON object");
  }
  for (const [role, version] of Object.entries(versions)) {
    if (!ROLES.has(role) || !Number.isSafeInteger(version) || version < 1) {
      throw new Error("Unknown role or invalid auth token version");
    }
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      "select role, version, source_rdb_sha256 from auth_role_token_versions for update",
    );
    if (
      existing.rows.some(
        (row) => row.source_rdb_sha256 !== sourceHash || versions[row.role] !== row.version,
      )
    ) {
      throw new Error("Auth versions already contain runtime or another export's state");
    }
    for (const [role, version] of Object.entries(versions)) {
      await client.query(
        `insert into auth_role_token_versions (role, version, source_rdb_sha256)
         values ($1, $2, $3) on conflict (role) do nothing`,
        [role, version, sourceHash],
      );
    }
    const stored = await client.query(
      "select role, version, source_rdb_sha256 from auth_role_token_versions",
    );
    if (
      stored.rows.length !== Object.keys(versions).length ||
      stored.rows.some(
        (row) => row.source_rdb_sha256 !== sourceHash || versions[row.role] !== row.version,
      )
    ) {
      throw new Error("Auth version import did not reconcile");
    }
    await client.query("commit");
    console.log(
      JSON.stringify({
        event: "auth_token_versions.imported",
        sourceHash,
        roles: stored.rows.length,
      }),
    );
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Auth version import failed");
  process.exitCode = 1;
});
