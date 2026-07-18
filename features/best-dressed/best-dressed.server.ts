import { createHash, randomBytes } from "crypto";
import { getCookie, getRequestIP, setCookie } from "@tanstack/react-start/server";
import { getRedis } from "@/lib/platform/redis.server";
import { getGuests } from "@/features/guests/store";
import { getAllGuestNames } from "@/features/guests/utils";

const VOTES_HASH_KEY = "best-dressed:votes:v2";
const SESSION_KEY = "best-dressed:session";
const OPEN_UNTIL_KEY = "best-dressed:open-until"; // unix seconds; when voting can proceed without a code
const TOKEN_KEY_PREFIX = "best-dressed:token:"; // One-time vote token keys (Redis string with TTL)
const VOTED_KEY_PREFIX = "best-dressed:voted:"; // Per-session "already voted" record (Redis hash)
const CODE_KEY_PREFIX = "best-dressed:code:"; // one-time vote codes minted by staff
const CODE_INDEX_KEY = "best-dressed:code-index";

const VOTE_COOKIE = "mah-bd-voter";
const VOTE_TOKEN_TTL_SECONDS = 10 * 60;
const VOTED_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days (safety net if session never resets)

const VOTE_RATELIMIT_WINDOW_SECONDS = 10 * 60;
const VOTE_RATELIMIT_MAX_PER_IP = 200;
const memoryRateLimit = new Map<string, { count: number; resetAtMs: number }>();

// In-memory fallback for local dev
const memoryVotes = new Map<string, number>();
const memoryTokens = new Set<string>(); // stores issued tokens until consumed/expired (no TTL in memory mode)
let memorySession = "initial";
const memoryVotedBySession = new Map<string, Map<string, string>>(); // session -> (voterId -> votedFor)

export type LeaderboardEntry = { name: string; count: number };

export type BestDressedSnapshot = {
  leaderboard: LeaderboardEntry[];
  totalVotes: number;
  session: string;
  voteToken: string;
  votedFor: string | null;
  codeRequired: boolean;
  openUntil: number | null;
};

export type BestDressedLeaderboardSnapshot = {
  leaderboard: LeaderboardEntry[];
  totalVotes: number;
  session: string;
  codeRequired: boolean;
  openUntil: number | null;
};

type VotesRecord = Record<string, number>;

function getClientIpFromHeaders(): string {
  return getRequestIP() || "unknown";
}

async function rateLimitVote(ip: string): Promise<{ allowed: boolean; remaining: number }> {
  const cleanIp = ip || "unknown";
  const redis = getRedis();
  const key = `best-dressed:ratelimit:vote:${cleanIp}`;

  if (!redis) {
    const now = Date.now();
    const entry = memoryRateLimit.get(key);
    const fresh =
      !entry || entry.resetAtMs <= now
        ? { count: 0, resetAtMs: now + VOTE_RATELIMIT_WINDOW_SECONDS * 1000 }
        : entry;
    fresh.count += 1;
    memoryRateLimit.set(key, fresh);
    const remaining = Math.max(0, VOTE_RATELIMIT_MAX_PER_IP - fresh.count);
    return { allowed: fresh.count <= VOTE_RATELIMIT_MAX_PER_IP, remaining };
  }

  try {
    const next = await redis.incr(key);
    if (next === 1) {
      await redis.expire(key, VOTE_RATELIMIT_WINDOW_SECONDS);
    }
    const remaining = Math.max(0, VOTE_RATELIMIT_MAX_PER_IP - next);
    return { allowed: next <= VOTE_RATELIMIT_MAX_PER_IP, remaining };
  } catch {
    return { allowed: true, remaining: VOTE_RATELIMIT_MAX_PER_IP };
  }
}

function votedKey(session: string): string {
  return `${VOTED_KEY_PREFIX}${session}`;
}

function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${token}`;
}

function codeKey(code: string): string {
  return `${CODE_KEY_PREFIX}${code}`;
}

function voteCodeVariants(code: string): string[] {
  const raw = code.trim();
  if (!raw) return [];
  return Array.from(new Set([raw, raw.toUpperCase(), raw.toLowerCase()]));
}

function sumPipelineDeletes(results: unknown): number {
  if (!Array.isArray(results)) return 0;
  let sum = 0;
  for (const r of results) {
    if (typeof r === "number") sum += r;
  }
  return sum;
}

function generateToken(): string {
  // 16 bytes -> 32 hex chars; prefix keeps tokens recognizable.
  const rand = randomBytes(16).toString("hex");
  return `vt_${Date.now().toString(36)}_${rand}`;
}

async function getOrCreateVoterId(): Promise<{ voterId: string; isNew: boolean }> {
  const existing = getCookie(VOTE_COOKIE) ?? "";
  if (existing && typeof existing === "string" && existing.length >= 16 && existing.length <= 80) {
    return { voterId: existing, isNew: false };
  }

  // No extra deps: stable-ish random id per device.
  const base = generateToken().replace(/^vt_/, "v_");
  const voterId = createHash("sha256").update(base).digest("hex").slice(0, 32);
  setCookie(VOTE_COOKIE, voterId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  return { voterId, isNew: true };
}

async function getExistingVoterId(): Promise<string | null> {
  const existing = getCookie(VOTE_COOKIE) ?? "";
  if (existing && typeof existing === "string" && existing.length >= 16 && existing.length <= 80) {
    return existing;
  }
  return null;
}

async function getSession(): Promise<string> {
  const redis = getRedis();
  if (redis) {
    const session = await redis.get<string>(SESSION_KEY);
    return session || "initial";
  }
  return memorySession;
}

async function getOpenUntilSeconds(): Promise<number> {
  const redis = getRedis();
  if (redis) {
    const value = await redis.get<number | string>(OPEN_UNTIL_KEY);
    const num =
      typeof value === "number"
        ? value
        : typeof value === "string"
          ? Number.parseInt(value, 10)
          : NaN;
    return Number.isFinite(num) ? Math.max(0, Math.floor(num)) : 0;
  }
  return 0;
}

export async function setOpenUntilSeconds(openUntil: number): Promise<void> {
  const redis = getRedis();
  const safe = Number.isFinite(openUntil) ? Math.max(0, Math.floor(openUntil)) : 0;
  if (redis) {
    await redis.set(OPEN_UNTIL_KEY, safe);
    return;
  }
}

async function resetSession(): Promise<string> {
  const oldSession = await getSession();
  const newSession = Date.now().toString(36);
  const redis = getRedis();
  if (redis) {
    await redis.set(SESSION_KEY, newSession);
    await redis.del(votedKey(oldSession));
  } else {
    memorySession = newSession;
    memoryTokens.clear();
    memoryVotedBySession.delete(oldSession);
  }
  return newSession;
}

async function getVotes(): Promise<VotesRecord> {
  const redis = getRedis();
  if (redis) {
    const atomicVotes = await redis.hgetall<Record<string, string | number>>(VOTES_HASH_KEY);
    const votes: VotesRecord = {};
    for (const [name, count] of Object.entries(atomicVotes || {})) {
      const parsed = typeof count === "number" ? count : Number.parseInt(count, 10);
      if (Number.isFinite(parsed)) votes[name] = (votes[name] || 0) + parsed;
    }
    return votes;
  }
  return Object.fromEntries(memoryVotes);
}

async function addVoteAtomically(
  session: string,
  voterId: string,
  name: string,
): Promise<{ added: boolean; votedFor: string | null; votes: VotesRecord }> {
  const redis = getRedis();
  if (redis) {
    const result = await redis.eval<string[], [number, string]>(
      "local existing = redis.call('hget', KEYS[1], ARGV[1]); if existing then return {0, existing}; end; redis.call('hset', KEYS[1], ARGV[1], ARGV[2]); redis.call('expire', KEYS[1], ARGV[3]); redis.call('hincrby', KEYS[2], ARGV[2], 1); return {1, ARGV[2]}",
      [votedKey(session), VOTES_HASH_KEY],
      [voterId, name, String(VOTED_TTL_SECONDS)],
    );
    const votes = await getVotes();
    return { added: result[0] === 1, votedFor: result[1] || null, votes };
  }

  const voted = memoryVotedBySession.get(session) ?? new Map<string, string>();
  const existing = voted.get(voterId);
  if (existing) return { added: false, votedFor: existing, votes: Object.fromEntries(memoryVotes) };
  voted.set(voterId, name);
  memoryVotedBySession.set(session, voted);
  memoryVotes.set(name, (memoryVotes.get(name) || 0) + 1);
  return { added: true, votedFor: name, votes: Object.fromEntries(memoryVotes) };
}

async function issueToken(): Promise<string> {
  const token = generateToken();
  const redis = getRedis();
  if (redis) {
    await redis.set(tokenKey(token), 1);
    await redis.expire(tokenKey(token), VOTE_TOKEN_TTL_SECONDS);
  } else {
    memoryTokens.add(token);
  }
  return token;
}

async function consumeToken(token: string): Promise<boolean> {
  if (!token || typeof token !== "string" || !token.startsWith("vt_")) {
    return false;
  }

  const redis = getRedis();
  if (redis) {
    const deleted = await redis.del(tokenKey(token));
    return deleted === 1;
  }

  if (!memoryTokens.has(token)) return false;
  memoryTokens.delete(token);
  return true;
}

async function tokenExists(token: string): Promise<boolean> {
  if (!token || typeof token !== "string" || !token.startsWith("vt_")) return false;
  const redis = getRedis();
  if (redis) return (await redis.exists(tokenKey(token))) === 1;
  return memoryTokens.has(token);
}

async function getVotedFor(session: string, voterId: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    const value = await redis.hget<string>(votedKey(session), voterId);
    return typeof value === "string" && value.trim() ? value : null;
  }
  const map = memoryVotedBySession.get(session);
  return map?.get(voterId) ?? null;
}

export async function getBestDressedSnapshot(): Promise<BestDressedSnapshot> {
  const [voterId, votes, session, voteToken, openUntil] = await Promise.all([
    getExistingVoterId(),
    getVotes(),
    getSession(),
    issueToken(),
    getOpenUntilSeconds(),
  ]);

  const votedFor = voterId ? await getVotedFor(session, voterId) : null;
  const now = Math.floor(Date.now() / 1000);
  const codeRequired = !(openUntil > now);

  const leaderboard = Object.entries(votes)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    leaderboard,
    totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
    session,
    voteToken,
    votedFor,
    codeRequired,
    openUntil: openUntil || null,
  };
}

export async function searchBestDressedGuests(input: {
  query: string;
  voteToken: string;
  code?: string;
}): Promise<{ names: string[] }> {
  const query = typeof input.query === "string" ? input.query.trim().toLocaleLowerCase() : "";
  if (query.length < 2 || !(await tokenExists(input.voteToken))) return { names: [] };
  const openUntil = await getOpenUntilSeconds();
  if (openUntil <= Math.floor(Date.now() / 1000)) {
    const redis = getRedis();
    const variants = voteCodeVariants(typeof input.code === "string" ? input.code : "");
    if (!redis || variants.length === 0) return { names: [] };
    const codeExists = await Promise.all(variants.map((variant) => redis.exists(codeKey(variant))));
    if (!codeExists.some((exists) => exists === 1)) return { names: [] };
  }
  const guests = await getGuests();
  return {
    names: getAllGuestNames(guests)
      .filter((name) => name.toLocaleLowerCase().includes(query))
      .slice(0, 8),
  };
}

export async function getBestDressedLeaderboardSnapshot(): Promise<BestDressedLeaderboardSnapshot> {
  const [votes, session, openUntil] = await Promise.all([
    getVotes(),
    getSession(),
    getOpenUntilSeconds(),
  ]);
  const now = Math.floor(Date.now() / 1000);
  const codeRequired = !(openUntil > now);
  const leaderboard = Object.entries(votes)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return {
    leaderboard,
    totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
    session,
    codeRequired,
    openUntil: openUntil || null,
  };
}

export type VoteInput = { name: string; voteToken: string; code?: string };
export type VoteResult =
  | {
      ok: true;
      votedFor: string;
      leaderboard: LeaderboardEntry[];
      totalVotes: number;
      session: string;
      codeRequired: boolean;
      openUntil: number | null;
    }
  | {
      ok: false;
      status: number;
      error: string;
      votedFor?: string;
      leaderboard?: LeaderboardEntry[];
      totalVotes?: number;
      session?: string;
    };

export async function voteBestDressed(input: VoteInput): Promise<VoteResult> {
  const ip = await getClientIpFromHeaders();
  const rl = await rateLimitVote(ip);
  if (!rl.allowed) {
    return {
      ok: false,
      status: 429,
      error: "Too many votes from this network. Please wait a bit and try again.",
    };
  }

  const [{ voterId }, session, openUntil] = await Promise.all([
    getOrCreateVoterId(),
    getSession(),
    getOpenUntilSeconds(),
  ]);
  const alreadyVotedFor = await getVotedFor(session, voterId);
  if (alreadyVotedFor) {
    const votes = await getVotes();
    const leaderboard = Object.entries(votes)
      .map(([n, count]) => ({ name: n, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return {
      ok: false,
      status: 409,
      error: "You can only vote once.",
      votedFor: alreadyVotedFor,
      leaderboard,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
    };
  }

  const trimmedName = typeof input.name === "string" ? input.name.trim() : "";
  if (!trimmedName) return { ok: false, status: 400, error: "Name is required" };

  const guests = await getGuests();
  const guestNamesSet = new Set(getAllGuestNames(guests));
  if (!guestNamesSet.has(trimmedName)) {
    const votes = await getVotes();
    const leaderboard = Object.entries(votes)
      .map(([n, count]) => ({ name: n, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return {
      ok: false,
      status: 400,
      error: "You can only vote for someone on the guest list.",
      leaderboard,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const codeRequired = !(openUntil > now);
  const variants = voteCodeVariants(typeof input.code === "string" ? input.code : "");
  if (codeRequired && variants.length === 0) {
    return {
      ok: false,
      status: 400,
      error: "A vote code is required. Ask staff for a code.",
      session,
    };
  }

  const tokenValid = await consumeToken(input.voteToken);
  if (!tokenValid) {
    const votes = await getVotes();
    const leaderboard = Object.entries(votes)
      .map(([n, count]) => ({ name: n, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    return {
      ok: false,
      status: 403,
      error: "Invalid or expired vote token. Please refresh and try again.",
      leaderboard,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
    };
  }

  if (codeRequired) {
    const redis = getRedis();
    if (!redis) {
      return {
        ok: false,
        status: 503,
        error: "Voting codes require Redis to be configured.",
        session,
      };
    }
    const pipe = redis.pipeline();
    for (const v of variants) pipe.del(codeKey(v));
    const consumed = sumPipelineDeletes(await pipe.exec());
    if (consumed < 1) {
      return { ok: false, status: 403, error: "Invalid or already-used vote code.", session };
    }
    await redis.srem(CODE_INDEX_KEY, ...variants);
  } else if (variants.length > 0) {
    const redis = getRedis();
    if (redis) {
      const pipe = redis.pipeline();
      for (const v of variants) {
        pipe.del(codeKey(v));
        pipe.srem(CODE_INDEX_KEY, v);
      }
      await pipe.exec();
    }
  }

  const recorded = await addVoteAtomically(session, voterId, trimmedName);
  const votes = recorded.votes;
  if (!recorded.added) {
    return {
      ok: false,
      status: 409,
      error: "You can only vote once.",
      votedFor: recorded.votedFor ?? undefined,
      leaderboard: Object.entries(votes)
        .map(([n, count]) => ({ name: n, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10),
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
    };
  }

  const leaderboard = Object.entries(votes)
    .map(([n, count]) => ({ name: n, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    ok: true,
    votedFor: trimmedName,
    leaderboard,
    totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
    session,
    codeRequired,
    openUntil: openUntil || null,
  };
}

export async function clearBestDressedVotes(): Promise<{ ok: true; session: string }> {
  const redis = getRedis();
  if (redis) {
    await redis.del(VOTES_HASH_KEY);
  }
  memoryVotes.clear();
  const session = await resetSession();
  return { ok: true, session };
}
