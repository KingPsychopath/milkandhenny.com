import { NextRequest, NextResponse } from 'next/server';
import { Redis } from '@upstash/redis';
import { getGuests } from '@/lib/kv-client';

const VOTES_KEY = 'best-dressed:votes';

function getRedis(): Redis | null {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

// In-memory fallback for local dev
const memoryVotes = new Map<string, number>();

type VotesRecord = Record<string, number>;

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

// GET - get current leaderboard and guest names
export async function GET() {
  try {
    const [votes, guests] = await Promise.all([
      getVotes(),
      getGuests(),
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
    });
  } catch (error) {
    console.error('Error getting votes:', error);
    return NextResponse.json({ error: 'Failed to get votes' }, { status: 500 });
  }
}

// POST - submit a vote
export async function POST(request: NextRequest) {
  try {
    const { name } = await request.json();
    
    if (!name || typeof name !== 'string') {
      return NextResponse.json({ error: 'Name is required' }, { status: 400 });
    }
    
    const votes = await addVote(name.trim());
    
    // Return updated leaderboard
    const leaderboard = Object.entries(votes)
      .map(([n, count]) => ({ name: n, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
    
    return NextResponse.json({
      success: true,
      leaderboard,
      totalVotes: Object.values(votes).reduce((a, b) => a + b, 0),
    });
  } catch (error) {
    console.error('Error submitting vote:', error);
    return NextResponse.json({ error: 'Failed to submit vote' }, { status: 500 });
  }
}

