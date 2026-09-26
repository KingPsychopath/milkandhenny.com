import { createHmac, randomBytes } from "node:crypto";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import { generateHumanCode } from "@/lib/server/human-code";
import type { VoteResult } from "./best-dressed.server";

const MAX_CODE_BATCH = 200;
const MAX_ONE_WORD_BATCH = 50;
const MAX_VOTING_WINDOW_MINUTES = 120;

type StateRow = { session: string; open_until: Date | null };
type TotalRow = { candidate_name: string; vote_count: number };
class InsufficientCodesError extends Error {}

function identityHash(kind: "voter" | "token" | "code", value: string) {
  const secret = process.env.AUTH_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("AUTH_SECRET is required for voting");
  return createHmac("sha256", secret).update(`best-dressed:${kind}:v1:${value}`).digest("hex");
}

function normalizeCode(value: string) {
  return value.trim().toLowerCase();
}

function openSeconds(value: Date | null) {
  if (!value) return 0;
  const seconds = Math.floor(value.getTime() / 1000);
  return seconds > Math.floor(Date.now() / 1000) ? seconds : 0;
}

function entries(rows: TotalRow[]) {
  const leaderboard = rows
    .map(({ candidate_name, vote_count }) => ({ name: candidate_name, count: vote_count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return {
    leaderboard,
    totalVotes: rows.reduce((total, row) => total + row.vote_count, 0),
  };
}

export async function readPostgresVotingState() {
  const state = await queryOne<StateRow>(
    "select session, open_until from best_dressed_state where singleton = true",
  );
  if (!state) throw new Error("Best Dressed state is missing");
  const totals = await query<TotalRow>(
    "select candidate_name, vote_count from best_dressed_totals where session = $1",
    [state.session],
  );
  return { session: state.session, openUntil: openSeconds(state.open_until), ...entries(totals) };
}

export async function setPostgresOpenUntilSeconds(seconds: number) {
  const safe = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
  await query(
    "update best_dressed_state set open_until = case when $1::bigint > 0 then to_timestamp($1::bigint) else null end, runtime_revision = runtime_revision + 1 where singleton = true",
    [safe],
  );
}

export async function issuePostgresVoteToken() {
  const token = `vt_${Date.now().toString(36)}_${randomBytes(16).toString("hex")}`;
  await transaction(async (client) => {
    await client.query(
      "update best_dressed_state set runtime_revision = runtime_revision + 1 where singleton = true",
    );
    await client.query(
      "insert into best_dressed_tokens (token_hash, expires_at) values ($1, now() + interval '10 minutes')",
      [identityHash("token", token)],
    );
  });
  return token;
}

export async function postgresVoteTokenExists(token: string) {
  if (!token.startsWith("vt_")) return false;
  const row = await queryOne<{ exists: boolean }>(
    "select exists(select 1 from best_dressed_tokens where token_hash = $1 and expires_at > now()) as exists",
    [identityHash("token", token)],
  );
  return row?.exists === true;
}

export async function postgresVoteCodeExists(code: string) {
  if (!normalizeCode(code)) return false;
  const row = await queryOne<{ exists: boolean }>(
    "select exists(select 1 from best_dressed_codes where code_hash = $1 and expires_at > now()) as exists",
    [identityHash("code", normalizeCode(code))],
  );
  return row?.exists === true;
}

export async function postgresVotedFor(session: string, voterId: string) {
  const row = await queryOne<{ candidate_name: string }>(
    `select candidate_name from best_dressed_voters
      where session = $1 and voter_hash = $2 and expires_at > now()`,
    [session, identityHash("voter", voterId)],
  );
  return row?.candidate_name ?? null;
}

function votingFailure(
  status: number,
  error: string,
  session: string,
  totals?: TotalRow[],
  votedFor?: string,
): VoteResult {
  return {
    ok: false,
    status,
    error,
    session,
    ...(totals ? entries(totals) : {}),
    ...(votedFor ? { votedFor } : {}),
  };
}

export async function votePostgresBestDressed(
  input: { name: string; voteToken: string; code?: string },
  voterId: string,
  eligibleNames: ReadonlySet<string>,
): Promise<VoteResult> {
  const voterHash = identityHash("voter", voterId);
  const tokenHash = input.voteToken?.startsWith("vt_")
    ? identityHash("token", input.voteToken)
    : null;
  const candidate = typeof input.name === "string" ? input.name.trim() : "";
  const code = typeof input.code === "string" ? normalizeCode(input.code) : "";
  const codeHash = code ? identityHash("code", code) : null;
  return transaction(async (client) => {
    // The singleton lock serializes vote, clear and voting-window decisions.
    const stateResult = await client.query<StateRow>(
      "select session, open_until from best_dressed_state where singleton = true for update",
    );
    const state = stateResult.rows[0];
    if (!state) throw new Error("Best Dressed state is missing");
    const totalsResult = await client.query<TotalRow>(
      "select candidate_name, vote_count from best_dressed_totals where session = $1",
      [state.session],
    );
    const totals = totalsResult.rows;
    const voted = await client.query<{ candidate_name: string }>(
      `select candidate_name from best_dressed_voters
        where session = $1 and voter_hash = $2 and expires_at > now()`,
      [state.session, voterHash],
    );
    if (voted.rows[0])
      return votingFailure(
        409,
        "You can only vote once.",
        state.session,
        totals,
        voted.rows[0].candidate_name,
      );
    if (!candidate) return votingFailure(400, "Name is required", state.session);
    if (!eligibleNames.has(candidate))
      return votingFailure(
        400,
        "You can only vote for someone holding a ticket.",
        state.session,
        totals,
      );
    const openUntil = openSeconds(state.open_until);
    const codeRequired = openUntil === 0;
    if (codeRequired && !code)
      return votingFailure(400, "A vote code is required. Ask staff for a code.", state.session);
    if (!tokenHash)
      return votingFailure(
        403,
        "Invalid or expired vote token. Please refresh and try again.",
        state.session,
        totals,
      );
    const token = await client.query(
      "select 1 from best_dressed_tokens where token_hash = $1 and expires_at > now()",
      [tokenHash],
    );
    if (!token.rowCount)
      return votingFailure(
        403,
        "Invalid or expired vote token. Please refresh and try again.",
        state.session,
        totals,
      );
    if (codeRequired) {
      const validCode = await client.query(
        "select 1 from best_dressed_codes where code_hash = $1 and expires_at > now()",
        [codeHash],
      );
      if (!validCode.rowCount)
        return votingFailure(403, "Invalid or already-used vote code.", state.session);
    }
    await client.query(
      `insert into best_dressed_voters (session, voter_hash, candidate_name, expires_at)
       values ($1,$2,$3,now() + interval '14 days')`,
      [state.session, voterHash, candidate],
    );
    await client.query(
      `insert into best_dressed_totals (session, candidate_name, vote_count)
       values ($1,$2,1)
       on conflict (session, candidate_name) do update
         set vote_count = best_dressed_totals.vote_count + 1,
             source_rdb_sha256 = null`,
      [state.session, candidate],
    );
    await client.query("delete from best_dressed_tokens where token_hash = $1", [tokenHash]);
    if (codeHash)
      await client.query("delete from best_dressed_codes where code_hash = $1", [codeHash]);
    await client.query(
      "update best_dressed_state set runtime_revision = runtime_revision + 1 where singleton = true",
    );
    const updatedTotals = await client.query<TotalRow>(
      "select candidate_name, vote_count from best_dressed_totals where session = $1",
      [state.session],
    );
    return {
      ok: true as const,
      votedFor: candidate,
      ...entries(updatedTotals.rows),
      session: state.session,
      codeRequired,
      openUntil: openUntil || null,
    };
  });
}

export async function clearPostgresBestDressed() {
  return transaction(async (client) => {
    await client.query("select 1 from best_dressed_state where singleton = true for update");
    const session = `${Date.now().toString(36)}_${randomBytes(4).toString("hex")}`;
    await client.query("delete from best_dressed_voters");
    await client.query("delete from best_dressed_totals");
    await client.query(
      "update best_dressed_state set session = $1, source_rdb_sha256 = null, runtime_revision = runtime_revision + 1 where singleton = true",
      [session],
    );
    return { ok: true as const, session };
  });
}

function wordCount(raw: unknown): 1 | 2 {
  if (raw === 1 || raw === 2) return raw;
  if (typeof raw === "string") {
    const parsed = Number.parseInt(raw, 10);
    if (parsed === 1 || parsed === 2) return parsed;
  }
  return 2;
}

export async function mintPostgresBestDressedCodes(input: {
  count?: number;
  ttlMinutes?: number;
  words?: number | string;
}) {
  const count =
    typeof input.count === "number" && Number.isFinite(input.count)
      ? Math.max(1, Math.min(MAX_CODE_BATCH, Math.floor(input.count)))
      : 20;
  const ttlMinutes =
    typeof input.ttlMinutes === "number" && Number.isFinite(input.ttlMinutes)
      ? Math.max(15, Math.min(12 * 60, Math.floor(input.ttlMinutes)))
      : 6 * 60;
  const words = wordCount(input.words);
  if (words === 1 && count > MAX_ONE_WORD_BATCH)
    return {
      ok: false as const,
      status: 400,
      error: `1-word codes collide quickly in large batches. Use 2 words for sheets > ${MAX_ONE_WORD_BATCH}.`,
    };
  const ttlSeconds = ttlMinutes * 60;
  const maxAttempts = words === 1 ? count * 200 : count * 10;
  const codes = await transaction(async (client) => {
    await client.query("select 1 from best_dressed_state where singleton = true for update");
    const minted: string[] = [];
    for (let attempts = 0; minted.length < count && attempts < maxAttempts; attempts += 1) {
      const code = normalizeCode(generateHumanCode(words));
      const inserted = await client.query(
        `insert into best_dressed_codes (code_hash, expires_at)
         values ($1, now() + $2::integer * interval '1 second')
         on conflict (code_hash) do update set expires_at = excluded.expires_at
           where best_dressed_codes.expires_at <= now()
         returning 1`,
        [identityHash("code", code), ttlSeconds],
      );
      if (inserted.rowCount) minted.push(code);
    }
    if (minted.length < count) throw new InsufficientCodesError();
    await client.query(
      "update best_dressed_state set runtime_revision = runtime_revision + 1 where singleton = true",
    );
    return minted;
  }).catch((error: unknown) => {
    if (error instanceof InsufficientCodesError) return null;
    throw error;
  });
  if (!codes)
    return {
      ok: false as const,
      status: 503,
      error: "Failed to mint enough codes. Try again.",
      minted: 0,
    };
  return {
    ok: true as const,
    codes,
    ttlSeconds,
    expiresAt: new Date(Date.now() + ttlSeconds * 1_000).toISOString(),
  };
}

export async function revokePostgresBestDressedCodes() {
  return transaction(async (client) => {
    await client.query("select 1 from best_dressed_state where singleton = true for update");
    const removed = await client.query<{ code_hash: string }>(
      "delete from best_dressed_codes returning code_hash",
    );
    await client.query(
      "update best_dressed_state set runtime_revision = runtime_revision + 1 where singleton = true",
    );
    return {
      ok: true as const,
      deleted: removed.rowCount ?? 0,
      indexed: removed.rowCount ?? 0,
      scanned: 0,
    };
  });
}

export async function getPostgresVotingWindow() {
  const state = await readPostgresVotingState();
  const now = Math.floor(Date.now() / 1_000);
  return {
    ok: true as const,
    isOpen: state.openUntil > now,
    openUntil: state.openUntil || null,
    secondsRemaining: state.openUntil > now ? state.openUntil - now : 0,
  };
}

export async function setPostgresVotingWindow(minutesInput: unknown) {
  const minutes =
    typeof minutesInput === "number" && Number.isFinite(minutesInput)
      ? Math.max(0, Math.min(MAX_VOTING_WINDOW_MINUTES, Math.floor(minutesInput)))
      : 0;
  const now = Math.floor(Date.now() / 1_000);
  const openUntil = minutes > 0 ? now + minutes * 60 : 0;
  await setPostgresOpenUntilSeconds(openUntil);
  return {
    ok: true as const,
    isOpen: openUntil > 0,
    openUntil: openUntil || null,
    minutes,
    secondsRemaining: openUntil > 0 ? openUntil - now : 0,
  };
}

export async function cleanupPostgresBestDressed(batchSize = 1_000) {
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 1_000)
    throw new Error("Invalid voting cleanup batch size");
  return transaction(async (client) => {
    await client.query("select 1 from best_dressed_state where singleton = true for update");
    const result = { voters: 0, tokens: 0, codes: 0 };
    for (const [table, key] of [
      ["best_dressed_voters", "voters"],
      ["best_dressed_tokens", "tokens"],
      ["best_dressed_codes", "codes"],
    ] as const) {
      const removed = await client.query(
        `with expired as (
           select ctid from ${table} where expires_at <= clock_timestamp()
            order by expires_at limit $1 for update skip locked
         )
         delete from ${table} as target using expired
          where target.ctid = expired.ctid returning 1`,
        [batchSize],
      );
      result[key] = removed.rowCount ?? 0;
    }
    if (result.voters + result.tokens + result.codes > 0)
      await client.query(
        "update best_dressed_state set runtime_revision = runtime_revision + 1 where singleton = true",
      );
    return result;
  });
}
