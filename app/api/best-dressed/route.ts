import { NextRequest, NextResponse } from 'next/server';
import { getGuests } from '@/lib/kv-client';
import { getRedis } from '@/lib/redis';

const VOTES_KEY = 'best-dressed:votes';
const SESSION_KEY = 'best-dressed:session';
const TOKENS_KEY = 'best-dressed:tokens'; // Valid vote tokens (Redis set)
const USED_TOKENS_KEY = 'best-dressed:used-tokens'; // Used vote tokens (Redis set)

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
const memoryTokens = new Set<string>();
const memoryUsedTokens = new Set<string>();
let memorySession = 'initial';

type VotesRecord = Record<string, number>;

async function getSession(): Promise<string> {
  const redis = getRedis();
  if (redis) {
    const session = await redis.get<string>(SESSION_KEY);
    return session || 'initial';
  }
  return memorySession;
}

async function resetSession(): Promise<string> {
  const newSession = Date.now().toString(36);
  const redis = getRedis();
  if (redis) {
    await redis.set(SESSION_KEY, newSession);
    // Clear tokens when session resets
    await redis.del(TOKENS_KEY);
    await redis.del(USED_TOKENS_KEY);
  } else {
    memorySession = newSession;
    memoryTokens.clear();
    memoryUsedTokens.clear();
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
    // Token valid for 10 minutes
    await redis.sadd(TOKENS_KEY, token);
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
    // Check if token exists and hasn't been used
    const [isValid, isUsed] = await Promise.all([
      redis.sismember(TOKENS_KEY, token),
      redis.sismember(USED_TOKENS_KEY, token),
    ]);
    
    if (isValid !== 1 || isUsed === 1) {
      return false;
    }
    
    // Mark token as used (move from valid to used)
    await Promise.all([
      redis.srem(TOKENS_KEY, token),
      redis.sadd(USED_TOKENS_KEY, token),
    ]);
    return true;
  } else {
    // Memory fallback
    if (!memoryTokens.has(token) || memoryUsedTokens.has(token)) {
      return false;
    }
    memoryTokens.delete(token);
    memoryUsedTokens.add(token);
    return true;
  }
}

// GET - get current leaderboard, guest names, session, and a fresh vote token
export async function GET() {
  try {
    const [votes, guests, session, voteToken] = await Promise.all([
      getVotes(),
      getGuests(),
      getSession(),
      issueToken(),
    ]);
    
    // Get all guest names (primary + plus ones)
    const guestNames: string[] = [];
    guests.forEach(g => {
      guestNames.push(g.name);
      if (g.plusOnes) {
        g.plusOnes.forEach(p => guestNames.push(p.name));
      }
    });
    
    // Sort votes by count descending
    const leaderboard = Object.entries(votes)
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10); // Top 10
    
    return NextResponse.json({
      leaderboard,
      guestNames: guestNames.sort(),
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
      voteToken, // One-time use token for voting
    });
  } catch (error) {
    console.error('Error getting votes:', error);
    return NextResponse.json({ error: 'Failed to get votes' }, { status: 500 });
  }
}

// POST - submit a vote (requires valid token)
export async function POST(request: NextRequest) {
  try {
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
    const guestNamesSet = new Set<string>();
    guests.forEach(g => {
      guestNamesSet.add(g.name);
      g.plusOnes?.forEach(p => guestNamesSet.add(p.name));
    });
    if (!guestNamesSet.has(trimmedName)) {
      const [votes, session] = await Promise.all([getVotes(), getSession()]);
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
      const [votes, session] = await Promise.all([getVotes(), getSession()]);
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
    const [votes, session] = await Promise.all([
      addVote(trimmedName),
      getSession(),
    ]);
    
    // Return updated leaderboard
    const leaderboard = Object.entries(votes)
      .map(([n, count]) => ({ name: n, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return NextResponse.json({
      success: true,
      leaderboard,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
      session,
    });
  } catch (error) {
    console.error('Error submitting vote:', error);
    return NextResponse.json({ error: 'Failed to submit vote' }, { status: 500 });
  }
}

// Server-side admin secret (optional override; default matches client MANAGEMENT_PASSWORD)
const RESET_SECRET = process.env.MANAGEMENT_PASSWORD ?? 'party2020';

// DELETE - wipe all votes and reset session (admin only; requires management password)
export async function DELETE(request: NextRequest) {
  try {
    let password: string | null = request.headers.get('X-Management-Password');
    if (password == null) {
      try {
        const body = await request.json();
        password = (body && typeof body === 'object' && 'password' in body) ? String(body.password) : null;
      } catch {
        password = null;
      }
    }
    if (password !== RESET_SECRET) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

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
    console.error('Error clearing votes:', error);
    return NextResponse.json({ error: 'Failed to clear votes' }, { status: 500 });
  }
}
