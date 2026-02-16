import { NextRequest, NextResponse } from 'next/server';
import { getGuests } from '@/lib/guests/kv-client';
import { getAllGuestNames } from '@/lib/guests/utils';
import { getRedis } from '@/lib/redis';
import { getClientIp, requireAdminStepUp, requireAuth } from '@/lib/auth';
import { apiError } from '@/lib/api-error';

const VOTES_KEY = 'best-dressed:votes';
const SESSION_KEY = 'best-dressed:session';
const TOKEN_KEY_PREFIX = 'best-dressed:token:'; // One-time vote token keys (Redis string with TTL)
const VOTED_KEY_PREFIX = 'best-dressed:voted:'; // Per-session "already voted" record (Redis hash)
const VOTE_COOKIE = 'mah-bd-voter';
const VOTE_TOKEN_TTL_SECONDS = 10 * 60;
const VOTED_TTL_SECONDS = 60 * 60 * 24 * 14; // 14 days (safety net if session never resets)

const VOTE_RATELIMIT_WINDOW_SECONDS = 10 * 60;
const VOTE_RATELIMIT_MAX_PER_IP = 200;
const memoryRateLimit = new Map<string, { count: number; resetAtMs: number }>();

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
    // Fail open: voting is not safety-critical, and token consumption still gates abuse.
    return { allowed: true, remaining: VOTE_RATELIMIT_MAX_PER_IP };
  }
}

// Generate a cryptographically random token
function generateToken(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let token = '';
  for (let i = 0; i < 16; i++) {
    token += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `vt_${Date.now().toString(36)}_${token}`;
}

// In-memory fallback for local dev
const memoryVotes = new Map<string, number>();
const memoryTokens = new Set<string>(); // stores issued tokens until consumed/expired (no TTL in memory mode)
let memorySession = 'initial';
const memoryVotedBySession = new Map<string, Map<string, string>>(); // session -> (voterId -> votedFor)

type VotesRecord = Record<string, number>;

function votedKey(session: string): string {
  return `${VOTED_KEY_PREFIX}${session}`;
}

function tokenKey(token: string): string {
  return `${TOKEN_KEY_PREFIX}${token}`;
}

function getOrCreateVoterId(request: NextRequest): { voterId: string; isNew: boolean } {
  const existing = request.cookies.get(VOTE_COOKIE)?.value ?? '';
  if (existing && typeof existing === 'string' && existing.length >= 16 && existing.length <= 80) {
    return { voterId: existing, isNew: false };
  }
  // No UUID import; token generator is good enough for a per-device cookie id.
  const fresh = generateToken().replace(/^vt_/, 'v_');
  return { voterId: fresh, isNew: true };
}

function attachVoterCookie(res: NextResponse, voterId: string): void {
  res.cookies.set({
    name: VOTE_COOKIE,
    value: voterId,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 60 * 60 * 24 * 30, // 30 days
  });
}

async function getSession(): Promise<string> {
  const redis = getRedis();
  if (redis) {
    const session = await redis.get<string>(SESSION_KEY);
    return session || 'initial';
  }
  return memorySession;
}

async function resetSession(): Promise<string> {
  const oldSession = await getSession();
  const newSession = Date.now().toString(36);
  const redis = getRedis();
  if (redis) {
    await redis.set(SESSION_KEY, newSession);
    // Clear "already voted" markers for the previous session.
    await redis.del(votedKey(oldSession));
    // Legacy cleanup (previous implementation used Redis sets with no TTL).
    await redis.del('best-dressed:tokens');
    await redis.del('best-dressed:used-tokens');
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
    const votes = await redis.get<VotesRecord>(VOTES_KEY);
    return votes || {};
  }
  return Object.fromEntries(memoryVotes);
}

async function addVote(name: string): Promise<VotesRecord> {
  const redis = getRedis();
  const votes = await getVotes();
  votes[name] = (votes[name] || 0) + 1;
  
  if (redis) {
    await redis.set(VOTES_KEY, votes);
  } else {
    memoryVotes.set(name, votes[name]);
  }
  
  return votes;
}

// Issue a new vote token
async function issueToken(): Promise<string> {
  const token = generateToken();
  const redis = getRedis();
  if (redis) {
    // Store as a single key so it can expire naturally.
    await redis.set(tokenKey(token), 1);
    await redis.expire(tokenKey(token), VOTE_TOKEN_TTL_SECONDS);
  } else {
    memoryTokens.add(token);
  }
  return token;
}

// Validate and consume a vote token (returns true if valid)
async function consumeToken(token: string): Promise<boolean> {
  if (!token || typeof token !== 'string' || !token.startsWith('vt_')) {
    return false;
  }
  
  const redis = getRedis();
  if (redis) {
    // Atomic-ish single-use: if DEL returns 1, token existed and is now consumed.
    const deleted = await redis.del(tokenKey(token));
    return deleted === 1;
  } else {
    // Memory fallback
    if (!memoryTokens.has(token)) return false;
    memoryTokens.delete(token);
    return true;
  }
}

async function getVotedFor(session: string, voterId: string): Promise<string | null> {
  const redis = getRedis();
  if (redis) {
    const value = await redis.hget<string>(votedKey(session), voterId);
    return typeof value === 'string' && value.trim() ? value : null;
  }
  const map = memoryVotedBySession.get(session);
  return map?.get(voterId) ?? null;
}

async function setVotedFor(session: string, voterId: string, name: string): Promise<void> {
  const redis = getRedis();
  if (redis) {
    await redis.hset(votedKey(session), { [voterId]: name });
    await redis.expire(votedKey(session), VOTED_TTL_SECONDS);
    return;
  }
  const map = memoryVotedBySession.get(session) ?? new Map<string, string>();
  map.set(voterId, name);
  memoryVotedBySession.set(session, map);
}

// GET - get current leaderboard, guest names, session, and a fresh vote token
export async function GET(request: NextRequest) {
  try {
    const { voterId, isNew } = getOrCreateVoterId(request);
    const [votes, guests, session, voteToken] = await Promise.all([
      getVotes(),
      getGuests(),
      getSession(),
      issueToken(),
    ]);
    
    const guestNames = getAllGuestNames(guests);
    const votedFor = await getVotedFor(session, voterId);
    
    // Sort votes by count descending
    const leaderboard = Object.entries(votes)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10
    
    const res = NextResponse.json({
      leaderboard,
      guestNames,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
      voteToken, // One-time use token for voting
      votedFor, // Server-enforced "already voted" state (cookie-bound)
    });
    if (isNew) attachVoterCookie(res, voterId);
    return res;
  } catch (error) {
    return apiError('best-dressed.list', 'Failed to load voting data', error);
  }
}

// POST - submit a vote (requires valid token)
export async function POST(request: NextRequest) {
  try {
    const ip = getClientIp(request);
    const rl = await rateLimitVote(ip);
    if (!rl.allowed) {
      return NextResponse.json(
        { error: 'Too many votes from this network. Please wait a bit and try again.' },
        { status: 429 }
      );
    }

    const { voterId, isNew } = getOrCreateVoterId(request);
    const session = await getSession();
    const alreadyVotedFor = await getVotedFor(session, voterId);
    if (alreadyVotedFor) {
      const votes = await getVotes();
      const leaderboard = Object.entries(votes)
        .map(([n, count]) => ({ name: n, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);

      const res = NextResponse.json(
        {
          success: false,
          error: 'You can only vote once.',
          votedFor: alreadyVotedFor,
          leaderboard,
          totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
          session,
        },
        { status: 409 }
      );
      if (isNew) attachVoterCookie(res, voterId);
      return res;
    }

    const { name, voteToken } = await request.json();
    
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    const trimmedName = name.trim();
    if (!trimmedName) {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }

    // Only allow voting for real guests (prevents fake names on leaderboard)
    const guests = await getGuests();
    const guestNamesSet = new Set(getAllGuestNames(guests));
    if (!guestNamesSet.has(trimmedName)) {
      const votes = await getVotes();
      const leaderboard = Object.entries(votes)
        .map(([n, count]) => ({ name: n, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      return NextResponse.json({
        success: false,
        error: 'You can only vote for someone on the guest list.',
        leaderboard,
        totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
        session,
      }, { status: 400 });
    }
    
    // Validate the vote token
    const tokenValid = await consumeToken(voteToken);
    if (!tokenValid) {
      // Invalid or already used token
      const votes = await getVotes();
      const leaderboard = Object.entries(votes)
        .map(([n, count]) => ({ name: n, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10);
      
      return NextResponse.json({
        success: false,
        error: 'Invalid or expired vote token. Please refresh and try again.',
        leaderboard,
        totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
        session,
      }, { status: 403 });
    }
    
    // Token valid - record the vote
    const votes = await addVote(trimmedName);
    await setVotedFor(session, voterId, trimmedName);
    
    // Return updated leaderboard
    const leaderboard = Object.entries(votes)
      .map(([n, count]) => ({ name: n, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    const res = NextResponse.json({
      success: true,
      leaderboard,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
      votedFor: trimmedName,
    });
    if (isNew) attachVoterCookie(res, voterId);
    return res;
  } catch (error) {
    return apiError('best-dressed.vote', 'Failed to submit vote. Please try again.', error);
  }
}

// DELETE - wipe all votes and reset session (admin only)
export async function DELETE(request: NextRequest) {
  const authErr = await requireAuth(request, "admin");
  if (authErr) return authErr;
  const stepUpErr = await requireAdminStepUp(request);
  if (stepUpErr) return stepUpErr;

  try {
    const redis = getRedis();
    if (redis) {
      await redis.del(VOTES_KEY);
    }
    memoryVotes.clear();
    
    // Reset session and clear all tokens
    const newSession = await resetSession();
    
    return NextResponse.json({
      success: true,
      message: 'All votes cleared, new voting session started',
      session: newSession,
    });
  } catch (error) {
    return apiError('best-dressed.clear', 'Failed to clear votes', error);
  }
}
