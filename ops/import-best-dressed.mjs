import { createHmac } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";

import { Client } from "pg";

const HASH = /^[a-f0-9]{64}$/;

function timestamp(value) {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value)))
    throw new Error("Invalid Best Dressed expiry");
  return new Date(value).toISOString();
}

function parseSource(bytes, secret) {
  const source = JSON.parse(bytes.toString("utf8"));
  if (
    !source ||
    typeof source !== "object" ||
    Array.isArray(source) ||
    typeof source.session !== "string" ||
    source.session.length > 120 ||
    typeof source.openUntil !== "string" ||
    !source.votes ||
    typeof source.votes !== "object" ||
    Array.isArray(source.votes) ||
    typeof source.legacyVotes !== "string" ||
    !Array.isArray(source.strings) ||
    !Array.isArray(source.voted)
  )
    throw new Error("Invalid Best Dressed export");
  const session = source.session || "initial";
  const openSeconds = source.openUntil ? Number(source.openUntil) : 0;
  if (!Number.isSafeInteger(openSeconds) || openSeconds < 0)
    throw new Error("Invalid Best Dressed open window");
  const openUntil = openSeconds ? new Date(openSeconds * 1_000).toISOString() : null;
  const totals = Object.entries(source.votes).map(([name, count]) => {
    const votes = Number(count);
    if (
      !name ||
      name.length > 240 ||
      !/^[0-9]+$/.test(count) ||
      !Number.isSafeInteger(votes) ||
      votes > 2_147_483_647
    )
      throw new Error("Invalid Best Dressed active tally");
    return { name, votes };
  });
  const hash = (kind, value) =>
    createHmac("sha256", secret).update(`best-dressed:${kind}:v1:${value}`).digest("hex");
  const seen = new Set();
  const credentials = source.strings.map((row) => {
    if (!row || typeof row.key !== "string" || seen.has(row.key))
      throw new Error("Invalid or repeated Best Dressed credential");
    seen.add(row.key);
    const kind = row.key.startsWith("best-dressed:token:")
      ? "token"
      : row.key.startsWith("best-dressed:code:")
        ? "code"
        : null;
    if (!kind) throw new Error("Unknown Best Dressed credential");
    const raw = row.key.slice(`best-dressed:${kind}:`.length);
    if (!raw || (kind === "token" && !raw.startsWith("vt_")))
      throw new Error("Invalid Best Dressed credential identity");
    return {
      kind,
      hash: hash(kind, kind === "code" ? raw.trim().toLowerCase() : raw),
      expiresAt: timestamp(row.expiresAt),
    };
  });
  const voters = [];
  for (const row of source.voted) {
    if (
      !row ||
      typeof row.key !== "string" ||
      !row.key.startsWith("best-dressed:voted:") ||
      !row.values ||
      typeof row.values !== "object" ||
      Array.isArray(row.values) ||
      seen.has(row.key)
    )
      throw new Error("Invalid Best Dressed voter hash");
    seen.add(row.key);
    const votedSession = row.key.slice("best-dressed:voted:".length);
    if (!votedSession || votedSession.length > 120)
      throw new Error("Invalid Best Dressed voter session");
    const expiresAt = timestamp(row.expiresAt);
    for (const [voterId, candidate] of Object.entries(row.values)) {
      if (
        voterId.length < 16 ||
        voterId.length > 80 ||
        typeof candidate !== "string" ||
        !candidate ||
        candidate.length > 240
      )
        throw new Error("Invalid Best Dressed voter receipt");
      voters.push({ session: votedSession, hash: hash("voter", voterId), candidate, expiresAt });
    }
  }
  return { session, openUntil, totals, credentials, voters, legacyVotes: source.legacyVotes };
}

async function main() {
  const [sourceHash, filePath] = process.argv.slice(2);
  if (!HASH.test(sourceHash ?? "") || !filePath || !isAbsolute(filePath))
    throw new Error(
      "Usage: node ops/import-best-dressed.mjs <rdb-sha256> <absolute-private-json-path>",
    );
  const file = await stat(filePath);
  if (!file.isFile() || file.size > 16 * 1024 * 1024 || (file.mode & 0o077) !== 0)
    throw new Error("Input must be a private regular JSON file no larger than 16 MiB");
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is required");
  const source = parseSource(await readFile(filePath), secret);
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query("begin");
    const state = await client.query(
      "select session, open_until, source_rdb_sha256, runtime_revision from best_dressed_state where singleton = true for update",
    );
    const current = state.rows[0];
    if (
      !current ||
      Number(current.runtime_revision) !== 0 ||
      (current.source_rdb_sha256 !== null && current.source_rdb_sha256 !== sourceHash) ||
      (current.source_rdb_sha256 === null &&
        (current.session !== "initial" || current.open_until !== null))
    )
      throw new Error("Best Dressed state contains runtime or another export");
    for (const table of [
      "best_dressed_totals",
      "best_dressed_voters",
      "best_dressed_tokens",
      "best_dressed_codes",
      "best_dressed_legacy_votes",
    ]) {
      const existing = await client.query(
        `select count(*)::integer as total,
                count(*) filter (where source_rdb_sha256 = $1)::integer as matching
           from ${table}`,
        [sourceHash],
      );
      if (existing.rows[0].total !== existing.rows[0].matching)
        throw new Error(`${table} contains runtime or another export`);
    }
    if (
      current.source_rdb_sha256 === sourceHash &&
      (current.session !== source.session ||
        (current.open_until?.toISOString() ?? null) !== source.openUntil)
    )
      throw new Error("Best Dressed state differs from the same source");
    await client.query(
      `update best_dressed_state
       set session = $1, open_until = $2, source_rdb_sha256 = $3
       where singleton = true`,
      [source.session, source.openUntil, sourceHash],
    );
    for (const row of source.totals) {
      await client.query(
        `insert into best_dressed_totals (session, candidate_name, vote_count, source_rdb_sha256)
         values ($1,$2,$3,$4) on conflict (session, candidate_name) do nothing`,
        [source.session, row.name, row.votes, sourceHash],
      );
      const verified = await client.query(
        `select 1 from best_dressed_totals where session = $1 and candidate_name = $2
           and vote_count = $3 and source_rdb_sha256 = $4`,
        [source.session, row.name, row.votes, sourceHash],
      );
      if (verified.rowCount !== 1) throw new Error("Best Dressed tally import conflict");
    }
    for (const row of source.voters) {
      await client.query(
        `insert into best_dressed_voters
           (session, voter_hash, candidate_name, expires_at, source_rdb_sha256)
         values ($1,$2,$3,$4,$5) on conflict (session, voter_hash) do nothing`,
        [row.session, row.hash, row.candidate, row.expiresAt, sourceHash],
      );
      const verified = await client.query(
        `select 1 from best_dressed_voters where session = $1 and voter_hash = $2
           and candidate_name = $3 and expires_at = $4 and source_rdb_sha256 = $5`,
        [row.session, row.hash, row.candidate, row.expiresAt, sourceHash],
      );
      if (verified.rowCount !== 1) throw new Error("Best Dressed voter import conflict");
    }
    for (const row of source.credentials) {
      const table = row.kind === "token" ? "best_dressed_tokens" : "best_dressed_codes";
      await client.query(
        `insert into ${table} (token_hash, expires_at, source_rdb_sha256)
         values ($1,$2,$3) on conflict (token_hash) do nothing`.replaceAll(
          "token_hash",
          row.kind === "token" ? "token_hash" : "code_hash",
        ),
        [row.hash, row.expiresAt, sourceHash],
      );
      const verified = await client.query(
        `select 1 from ${table} where token_hash = $1 and expires_at = $2
           and source_rdb_sha256 = $3`.replaceAll(
          "token_hash",
          row.kind === "token" ? "token_hash" : "code_hash",
        ),
        [row.hash, row.expiresAt, sourceHash],
      );
      if (verified.rowCount !== 1) throw new Error("Best Dressed credential import conflict");
    }
    if (source.legacyVotes) {
      await client.query(
        `insert into best_dressed_legacy_votes (singleton, source_rdb_sha256, original_value)
         values (true,$1,$2) on conflict (singleton) do nothing`,
        [sourceHash, source.legacyVotes],
      );
      const verified = await client.query(
        `select 1 from best_dressed_legacy_votes where singleton = true
           and source_rdb_sha256 = $1 and original_value = $2`,
        [sourceHash, source.legacyVotes],
      );
      if (verified.rowCount !== 1) throw new Error("Legacy Best Dressed tally import conflict");
    }
    await client.query("commit");
    console.log(
      `active_vote_candidates=${source.totals.length} legacy_votes_archived=${!!source.legacyVotes} voter_receipts=${source.voters.length} credentials=${source.credentials.length}`,
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
