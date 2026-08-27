import { randomUUID } from "node:crypto";

import { query, transaction } from "@/lib/platform/postgres.server";
import type {
  PersonGameHistoryItem,
  PersonGameMetadata,
  PersonGameMode,
  PersonGameStats,
  PersonGameStatus,
} from "./types";

type JsonObject = Record<string, boolean | number | string | null>;

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export interface RecordPersonGameInput {
  personId: string;
  game: string;
  mode: PersonGameMode;
  externalRef: string;
  displayName?: string;
  status?: PersonGameStatus;
  outcome?: string;
  score?: number;
  summary?: JsonObject;
  event?: { key: string; kind: string; payload?: JsonObject };
}

export async function recordPersonGame(input: RecordPersonGameInput): Promise<void> {
  await transaction(async (client) => {
    const sessionId = id("pgs");
    const result = await client.query<{ id: string }>(
      `insert into person_game_sessions
         (id,person_id,game,mode,external_ref,display_name,status,outcome,score,summary,completed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,
               case when $7 = 'completed' then now() else null end)
       on conflict (person_id,game,mode,external_ref) do update set
         display_name = coalesce(excluded.display_name,person_game_sessions.display_name),
         status = case
           when person_game_sessions.status in ('completed','abandoned') then person_game_sessions.status
           else excluded.status
         end,
         outcome = case
           when person_game_sessions.status in ('completed','abandoned') then person_game_sessions.outcome
           else coalesce(excluded.outcome,person_game_sessions.outcome)
         end,
         score = case
           when person_game_sessions.status = 'completed' then person_game_sessions.score
           else coalesce(excluded.score,person_game_sessions.score)
         end,
         summary = person_game_sessions.summary || excluded.summary,
         last_played_at = now(),
         completed_at = case
           when excluded.status = 'completed' then coalesce(person_game_sessions.completed_at,now())
           else person_game_sessions.completed_at
         end
       returning id`,
      [
        sessionId,
        input.personId,
        input.game,
        input.mode,
        input.externalRef,
        input.displayName?.trim() || null,
        input.status ?? "active",
        input.outcome ?? null,
        input.score ?? null,
        JSON.stringify(input.summary ?? {}),
      ],
    );
    const storedSessionId = result.rows[0]?.id;
    if (!storedSessionId || !input.event) return;
    await client.query(
      `insert into person_game_events (id,session_id,event_key,kind,payload)
       values ($1,$2,$3,$4,$5::jsonb)
       on conflict (session_id,event_key) do nothing`,
      [
        id("pge"),
        storedSessionId,
        input.event.key,
        input.event.kind,
        JSON.stringify(input.event.payload ?? {}),
      ],
    );
  });
}

export async function personGameHistory(
  personId: string,
  limit = 50,
): Promise<PersonGameHistoryItem[]> {
  const rows = await query<{
    id: string;
    game: string;
    mode: PersonGameMode;
    external_ref: string;
    display_name: string | null;
    status: PersonGameStatus;
    outcome: string | null;
    score: number | null;
    started_at: Date;
    last_played_at: Date;
    completed_at: Date | null;
    event_count: string;
    summary: PersonGameMetadata;
  }>(
    `select session.id,session.game,session.mode,session.external_ref,session.display_name,session.status,
            session.outcome,session.score,session.started_at,session.last_played_at,
            session.completed_at,session.summary,count(event.id)::text as event_count
       from person_game_sessions session
       left join person_game_events event on event.session_id = session.id
      where session.person_id = $1
      group by session.id
      order by session.last_played_at desc
      limit $2`,
    [personId, Math.min(100, Math.max(1, limit))],
  );
  return rows.map((row) => ({
    id: row.id,
    game: row.game,
    mode: row.mode,
    reference: row.external_ref,
    displayName: row.display_name ?? undefined,
    status: row.status,
    outcome: row.outcome ?? undefined,
    score: row.score ?? undefined,
    startedAt: row.started_at.toISOString(),
    lastPlayedAt: row.last_played_at.toISOString(),
    completedAt: row.completed_at?.toISOString(),
    eventCount: Number(row.event_count),
    summary: row.summary,
  }));
}

export async function personGameStats(personId: string): Promise<PersonGameStats[]> {
  const rows = await query<{
    game: string;
    plays: string;
    completed: string;
    wins: string;
    actions: string;
    last_played_at: Date;
    guesses: string;
    hints: string;
    hot_guesses: string;
    cold_guesses: string;
    best_rank: number | null;
  }>(
    `select session.game,
            count(distinct session.id)::text as plays,
            count(distinct session.id) filter (where session.status = 'completed')::text as completed,
            count(distinct session.id) filter (
              where session.outcome in ('won','found')
            )::text as wins,
            count(event.id)::text as actions,
            max(session.last_played_at) as last_played_at,
            count(event.id) filter (where event.kind = 'guess')::text as guesses,
            count(event.id) filter (where event.kind = 'hint')::text as hints,
            count(event.id) filter (
              where event.kind = 'guess'
                and event.payload->>'band' in ('burning','hot','warm')
            )::text as hot_guesses,
            count(event.id) filter (
              where event.kind = 'guess'
                and event.payload->>'band' in ('cold','frozen')
            )::text as cold_guesses,
            min(
              case when event.kind = 'guess' and event.payload->>'rank' ~ '^[0-9]+$'
                then (event.payload->>'rank')::integer end
            ) as best_rank
       from person_game_sessions session
       left join person_game_events event on event.session_id = session.id
      where session.person_id = $1
      group by session.game
      order by max(session.last_played_at) desc`,
    [personId],
  );
  return rows.map((row) => ({
    game: row.game,
    plays: Number(row.plays),
    completed: Number(row.completed),
    wins: Number(row.wins),
    actions: Number(row.actions),
    lastPlayedAt: row.last_played_at.toISOString(),
    ...(row.game === "hot-and-cold"
      ? {
          guesses: Number(row.guesses),
          hints: Number(row.hints),
          hotGuesses: Number(row.hot_guesses),
          coldGuesses: Number(row.cold_guesses),
          bestRank: row.best_rank ?? undefined,
        }
      : {}),
  }));
}
