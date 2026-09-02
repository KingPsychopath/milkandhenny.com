import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";

import { query, transaction } from "@/lib/platform/postgres.server";
import { recordScoreInTransaction } from "@/features/event-scoring/store.server";
import { pitchSlideContentCount } from "@/features/things/pitches/document-content";
import { parsePitchDocument } from "@/features/things/pitches/validation";
import { ACHIEVEMENTS, achievementDefinition } from "./catalog";
import type {
  AchievementKey,
  AchievementNotification,
  AchievementProgress,
  AchievementView,
} from "./types";

type ParticipantIdentity = {
  id: string;
  event_slug: string;
  person_id: string | null;
  ticket_id: string | null;
  checked_in_at: Date | null;
};

type ProgressFact = {
  key: AchievementKey;
  current: number;
  target: number;
  sourceType: string;
  sourceId: string;
  sourceTransactionId?: string;
};

type ProgressRow = {
  achievement_key: string;
  current_value: number;
  target_value: number;
  event_slug: string | null;
  unlocked_at: Date | null;
};

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

async function upsertParticipantFact(
  client: PoolClient,
  participant: ParticipantIdentity,
  fact: ProgressFact,
) {
  await client.query(
    `insert into achievement_progress
       (id,achievement_key,participant_id,person_id,ticket_id,event_slug,current_value,target_value,source_key)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (achievement_key,participant_id) where participant_id is not null do update set
       person_id = coalesce(achievement_progress.person_id, excluded.person_id),
       ticket_id = excluded.ticket_id,
       event_slug = excluded.event_slug,
       current_value = excluded.current_value,
       target_value = excluded.target_value,
       source_key = excluded.source_key,
       updated_at = now()
     where (achievement_progress.person_id,achievement_progress.ticket_id,
            achievement_progress.event_slug,achievement_progress.current_value,
            achievement_progress.target_value,achievement_progress.source_key)
       is distinct from
           (excluded.person_id,excluded.ticket_id,excluded.event_slug,excluded.current_value,
            excluded.target_value,excluded.source_key)`,
    [
      id("ap"),
      fact.key,
      participant.id,
      participant.person_id,
      participant.ticket_id,
      participant.event_slug,
      Math.min(fact.current, fact.target),
      fact.target,
      fact.sourceId,
    ],
  );
  if (fact.current < fact.target) return;
  await client.query(
    `insert into achievement_unlocks
       (id,achievement_key,participant_id,person_id,ticket_id,event_slug,source_type,source_id,
        source_transaction_id)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     on conflict (achievement_key,participant_id) where participant_id is not null do nothing`,
    [
      id("au"),
      fact.key,
      participant.id,
      participant.person_id,
      participant.ticket_id,
      participant.event_slug,
      fact.sourceType,
      fact.sourceId,
      fact.sourceTransactionId ?? null,
    ],
  );
}

async function upsertPersonFact(client: PoolClient, personId: string, fact: ProgressFact) {
  await client.query(
    `insert into achievement_progress
       (id,achievement_key,person_id,current_value,target_value,source_key)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (achievement_key,person_id)
       where participant_id is null and person_id is not null do update set
       current_value = excluded.current_value,
       target_value = excluded.target_value,
       source_key = excluded.source_key,
       updated_at = now()
     where (achievement_progress.current_value,achievement_progress.target_value,
            achievement_progress.source_key)
       is distinct from
           (excluded.current_value,excluded.target_value,excluded.source_key)`,
    [id("ap"), fact.key, personId, Math.min(fact.current, fact.target), fact.target, fact.sourceId],
  );
  if (fact.current < fact.target) return;
  await client.query(
    `insert into achievement_unlocks
       (id,achievement_key,person_id,source_type,source_id,source_transaction_id)
     values ($1,$2,$3,$4,$5,$6)
     on conflict (achievement_key,person_id)
       where participant_id is null and person_id is not null do nothing`,
    [
      id("au"),
      fact.key,
      personId,
      fact.sourceType,
      fact.sourceId,
      fact.sourceTransactionId ?? null,
    ],
  );
}

async function participantFacts(client: PoolClient, participant: ParticipantIdentity) {
  const discoveries = await client.query<{
    claimed: number;
    total: number;
  }>(
    `select
         (select count(distinct claim.discovery_id)::integer
            from score_discovery_claims claim
           where claim.participant_id = $1 and claim.state = 'accepted') as claimed,
         (select count(*)::integer
            from score_discoveries discovery
           where discovery.event_slug = $2
             and discovery.status in ('scheduled','live','paused','exhausted','ended')) as total`,
    [participant.id, participant.event_slug],
  );
  const scoredActivities = await client.query<{
    count: number;
    event_activities: number;
    completed_bingo: boolean;
    completed_spelling: boolean;
    has_bingo: boolean;
    has_spelling: boolean;
    latest_transaction_id: string | null;
  }>(
    `select count(distinct transaction.activity_id)::integer as count,
              (select count(*)::integer from score_activities configured
                where configured.event_slug = $2
                  and configured.status not in ('draft','cancelled')) as event_activities,
              coalesce(bool_or(lower(activity.name) like '%bingo%'),false) as completed_bingo,
              coalesce(bool_or(lower(activity.name) like '%spell%'),false) as completed_spelling,
              exists(select 1 from score_activities configured
                where configured.event_slug = $2 and lower(configured.name) like '%bingo%'
                  and configured.status <> 'cancelled') as has_bingo,
              exists(select 1 from score_activities configured
                where configured.event_slug = $2 and lower(configured.name) like '%spell%'
                  and configured.status <> 'cancelled') as has_spelling,
              (array_agg(transaction.id order by transaction.created_at desc))[1]
                as latest_transaction_id
         from score_postings posting
         join score_transactions transaction on transaction.id = posting.transaction_id
         left join score_activities activity on activity.id = transaction.activity_id
        where posting.participant_id = $1 and transaction.status = 'accepted'`,
    [participant.id, participant.event_slug],
  );
  const games = await client.query<{
    game_kind: string;
    transaction_id: string;
  }>(
    `select distinct result.game_kind, transaction.id as transaction_id
         from score_postings posting
         join score_transactions transaction on transaction.id = posting.transaction_id
         join score_game_receipts receipt on receipt.transaction_id = transaction.id
         join official_game_results result on result.id = receipt.official_result_id
        where posting.participant_id = $1 and transaction.status = 'accepted'`,
    [participant.id],
  );
  const eventGames = await client.query<{ game_kind: string }>(
    `select distinct binding.game_kind
         from event_game_score_bindings binding
         join events event on event.event_id = binding.event_id
        where event.slug = $1 and binding.status = 'active'
          and binding.game_kind in ('centre','hot-and-cold','same-brain','draw-country')`,
    [participant.event_slug],
  );
  const hunt = discoveries.rows[0] ?? { claimed: 0, total: 0 };
  const activity = scoredActivities.rows[0] ?? {
    count: 0,
    event_activities: 0,
    completed_bingo: false,
    completed_spelling: false,
    has_bingo: false,
    has_spelling: false,
    latest_transaction_id: null,
  };
  const playedGames = new Set(games.rows.map((row) => row.game_kind));
  const configuredGames = new Set(eventGames.rows.map((row) => row.game_kind));
  const latestGameTransaction = games.rows[0]?.transaction_id;
  const facts: ProgressFact[] = [
    {
      key: "present",
      current: participant.checked_in_at ? 1 : 0,
      target: 1,
      sourceType: "check-in",
      sourceId: participant.ticket_id ?? participant.id,
    },
  ];
  if (hunt.total > 0) {
    facts.push(
      {
        key: "found-something",
        current: hunt.claimed,
        target: 1,
        sourceType: "discovery",
        sourceId: participant.event_slug,
      },
      {
        key: "leave-no-trace",
        current: hunt.claimed,
        target: hunt.total,
        sourceType: "discovery",
        sourceId: participant.event_slug,
      },
    );
  }
  if (activity.event_activities > 0) {
    facts.push({
      key: "game-night-graduate",
      current: activity.count,
      target: 3,
      sourceType: "score",
      sourceId: participant.event_slug,
      sourceTransactionId: activity.latest_transaction_id ?? undefined,
    });
  }
  if (configuredGames.size > 0) {
    facts.push({
      key: "four-corners",
      current: [...configuredGames].filter((game) => playedGames.has(game)).length,
      target: configuredGames.size,
      sourceType: "game",
      sourceId: participant.event_slug,
      sourceTransactionId: latestGameTransaction,
    });
  }
  if (activity.has_bingo) {
    facts.push({
      key: "full-house",
      current: activity.completed_bingo ? 1 : 0,
      target: 1,
      sourceType: "score",
      sourceId: "bingo",
      sourceTransactionId: activity.latest_transaction_id ?? undefined,
    });
  }
  if (activity.has_spelling || playedGames.has("spelling-bee")) {
    facts.push({
      key: "spellbound",
      current: activity.completed_spelling || playedGames.has("spelling-bee") ? 1 : 0,
      target: 1,
      sourceType: "game",
      sourceId: "spelling-bee",
      sourceTransactionId: activity.latest_transaction_id ?? latestGameTransaction,
    });
  }
  return facts;
}

async function personFacts(client: PoolClient, personId: string): Promise<ProgressFact[]> {
  const attendance = await client.query<{ count: number }>(
    `select count(distinct event_slug)::integer as count from event_participants
      where person_id = $1 and checked_in_at is not null and status = 'active'`,
    [personId],
  );
  const pitches = await client.query<{ id: string; draft_document: unknown }>(
    `select id,draft_document from pitch_decks
      where owner_person_id = $1 and lifecycle = 'active'`,
    [personId],
  );
  const qualifyingPitch = pitches.rows.find((row) => {
    const parsed = parsePitchDocument(row.draft_document, 6);
    const slides = parsed.ok ? parsed.document.slides.filter((slide) => !slide.deletedAt) : [];
    return slides.length === 6 && slides.every((slide) => pitchSlideContentCount(slide) > 0);
  });
  return [
    {
      key: "six-appeal",
      current: qualifyingPitch ? 1 : 0,
      target: 1,
      sourceType: "pitch",
      sourceId: qualifyingPitch?.id ?? "saved-pitch",
    },
    {
      key: "regular-behaviour",
      current: attendance.rows[0]?.count ?? 0,
      target: 3,
      sourceType: "attendance",
      sourceId: personId,
    },
  ];
}

async function rewardSixAppeal(
  client: PoolClient,
  personId: string,
  participantIds: readonly string[],
) {
  const uniqueParticipantIds = [...new Set(participantIds)].slice(0, 20);
  if (uniqueParticipantIds.length === 0) return;
  const unlock = await client.query<{ id: string; source_transaction_id: string | null }>(
    `select id,source_transaction_id from achievement_unlocks
      where achievement_key = 'six-appeal' and person_id = $1 and participant_id is null
      for update`,
    [personId],
  );
  if (!unlock.rows[0] || unlock.rows[0].source_transaction_id) return;
  const participants = await client.query<{ id: string; event_slug: string }>(
    `select participant.id,participant.event_slug
       from event_participants participant
       join event_scoring_settings settings on settings.event_slug = participant.event_slug
      where participant.id = any($1::text[])
        and participant.person_id = $2
        and participant.status = 'active'
        and settings.state = 'live'
      order by participant.created_at,participant.id`,
    [uniqueParticipantIds, personId],
  );
  // More than one live event is deliberately ambiguous. The reward waits until
  // the attendee has one active event ticket rather than guessing incorrectly.
  if (participants.rows.length !== 1) return;
  const participant = participants.rows[0];
  const points = achievementDefinition("six-appeal")?.rewardPoints ?? 5;
  const scored = await recordScoreInTransaction(client, {
    eventSlug: participant.event_slug,
    sourceType: "manual",
    sourceId: `achievement:${unlock.rows[0].id}`,
    idempotencyKey: `achievement:six-appeal:${unlock.rows[0].id}`,
    reasonCode: "completion",
    note: "Six Appeal achievement",
    actorType: "system",
    actorId: "achievements",
    metadata: { achievementKey: "six-appeal", displayLabel: "Six Appeal" },
    postings: [{ participantId: participant.id, points }],
  });
  if (!scored.ok) return;
  await client.query(`update achievement_unlocks set source_transaction_id = $2 where id = $1`, [
    unlock.rows[0].id,
    scored.value.id,
  ]);
}

async function refreshParticipant(client: PoolClient, participantId: string) {
  const result = await client.query<ParticipantIdentity>(
    `select id,event_slug,person_id,ticket_id,checked_in_at
       from event_participants where id = $1 and status = 'active' for update`,
    [participantId],
  );
  const participant = result.rows[0];
  if (!participant) return null;
  if (participant.person_id) {
    await client.query(
      `update achievement_progress set person_id = $2, updated_at = now()
        where participant_id = $1 and person_id is null`,
      [participant.id, participant.person_id],
    );
    await client.query(
      `update achievement_unlocks set person_id = $2
        where participant_id = $1 and person_id is null`,
      [participant.id, participant.person_id],
    );
  }
  for (const fact of await participantFacts(client, participant)) {
    await upsertParticipantFact(client, participant, fact);
  }
  if (participant.person_id) {
    for (const fact of await personFacts(client, participant.person_id)) {
      await upsertPersonFact(client, participant.person_id, fact);
    }
  }
  return participant;
}

function toProgress(row: ProgressRow): AchievementProgress | null {
  const definition = achievementDefinition(row.achievement_key);
  if (!definition) return null;
  return {
    ...definition,
    current: row.current_value,
    target: row.target_value,
    unlockedAt: row.unlocked_at?.toISOString(),
    eventSlug: row.event_slug ?? undefined,
  };
}

export async function achievementViewForParticipant(
  participantId: string,
): Promise<AchievementView> {
  return transaction(async (client) => {
    const participant = await refreshParticipant(client, participantId);
    if (!participant) return { event: [], permanent: [], unlockedCount: 0, totalCount: 0 };
    const rows = await client.query<ProgressRow>(
      `select progress.achievement_key,progress.current_value,progress.target_value,
              progress.event_slug,unlock.unlocked_at
         from achievement_progress progress
         left join achievement_unlocks unlock
           on unlock.achievement_key = progress.achievement_key
          and (
            (progress.participant_id is not null and unlock.participant_id = progress.participant_id)
            or (progress.participant_id is null and unlock.participant_id is null
                and unlock.person_id = progress.person_id)
          )
        where progress.participant_id = $1
           or (progress.participant_id is null and progress.person_id = $2)
        order by progress.created_at,progress.achievement_key`,
      [participant.id, participant.person_id],
    );
    const progress = rows.rows
      .map(toProgress)
      .filter((item): item is AchievementProgress => !!item);
    const event = progress.filter((item) => item.scope === "event");
    const permanent = progress.filter((item) => item.scope !== "event");
    return {
      event,
      permanent,
      unlockedCount: progress.filter((item) => item.unlockedAt).length,
      totalCount: progress.length,
    };
  });
}

export async function achievementCabinetForPerson(
  personId: string,
): Promise<AchievementProgress[]> {
  return transaction(async (client) => {
    for (const participant of await client
      .query<{ id: string }>(
        `select id from event_participants where person_id = $1 and status = 'active'`,
        [personId],
      )
      .then((result) => result.rows)) {
      await refreshParticipant(client, participant.id);
    }
    for (const fact of await personFacts(client, personId))
      await upsertPersonFact(client, personId, fact);
    const rows = await client.query<ProgressRow>(
      `select progress.achievement_key,max(progress.current_value)::integer as current_value,
              max(progress.target_value)::integer as target_value,progress.event_slug,
              (select max(unlock.unlocked_at) from achievement_unlocks unlock
                where unlock.person_id = $1
                  and unlock.achievement_key = progress.achievement_key
                  and unlock.event_slug is not distinct from progress.event_slug) as unlocked_at
         from achievement_progress progress
        where progress.person_id = $1
        group by progress.achievement_key,progress.event_slug
        order by min(progress.created_at),progress.achievement_key`,
      [personId],
    );
    return rows.rows.map(toProgress).filter((item): item is AchievementProgress => !!item);
  });
}

export async function refreshPersonAchievements(
  personId: string,
  options: { sixAppealParticipantIds?: readonly string[] } = {},
): Promise<void> {
  await transaction(async (client) => {
    for (const fact of await personFacts(client, personId)) {
      await upsertPersonFact(client, personId, fact);
    }
    await rewardSixAppeal(client, personId, options.sixAppealParticipantIds ?? []);
  });
}

export async function listAchievementNotifications(
  participantId: string,
): Promise<AchievementNotification[]> {
  return transaction(async (client) => {
    const participant = await refreshParticipant(client, participantId);
    if (!participant) return [];
    const rows = await client.query<{
      id: string;
      achievement_key: string;
      event_slug: string | null;
      source_transaction_id: string | null;
      unlocked_at: Date;
    }>(
      `select id,achievement_key,event_slug,source_transaction_id,unlocked_at
         from achievement_unlocks
        where delivered_at is null
          and (participant_id = $1 or (participant_id is null and person_id = $2))
        order by unlocked_at,id limit 20`,
      [participant.id, participant.person_id],
    );
    return rows.rows.flatMap((row) => {
      const definition = achievementDefinition(row.achievement_key);
      return definition
        ? [
            {
              ...definition,
              id: row.id,
              eventSlug: row.event_slug ?? undefined,
              sourceTransactionId: row.source_transaction_id ?? undefined,
              unlockedAt: row.unlocked_at.toISOString(),
            },
          ]
        : [];
    });
  });
}

export async function markAchievementNotificationsDelivered(
  participantId: string,
  notificationIds: string[],
): Promise<number> {
  if (notificationIds.length === 0) return 0;
  const rows = await query<{ id: string }>(
    `update achievement_unlocks unlock set delivered_at = coalesce(delivered_at,now())
      where unlock.id = any($2::text[])
        and exists (
          select 1 from event_participants participant
           where participant.id = $1
             and (unlock.participant_id = participant.id
               or (unlock.participant_id is null and unlock.person_id = participant.person_id))
        )
      returning unlock.id`,
    [participantId, notificationIds.slice(0, 50)],
  );
  return rows.length;
}

export async function listPersonAchievementNotifications(
  personId: string,
): Promise<AchievementNotification[]> {
  const rows = await query<{
    id: string;
    achievement_key: string;
    source_transaction_id: string | null;
    unlocked_at: Date;
  }>(
    `select id,achievement_key,source_transaction_id,unlocked_at
       from achievement_unlocks
      where person_id = $1 and participant_id is null and delivered_at is null
      order by unlocked_at,id limit 20`,
    [personId],
  );
  return rows.flatMap((row) => {
    const definition = achievementDefinition(row.achievement_key);
    return definition
      ? [
          {
            ...definition,
            id: row.id,
            sourceTransactionId: row.source_transaction_id ?? undefined,
            unlockedAt: row.unlocked_at.toISOString(),
          },
        ]
      : [];
  });
}

export async function markPersonAchievementNotificationsDelivered(
  personId: string,
  notificationIds: string[],
): Promise<number> {
  if (notificationIds.length === 0) return 0;
  const rows = await query<{ id: string }>(
    `update achievement_unlocks set delivered_at = coalesce(delivered_at,now())
      where person_id = $1 and participant_id is null and id = any($2::text[])
      returning id`,
    [personId, notificationIds.slice(0, 50)],
  );
  return rows.length;
}

export function achievementCatalog() {
  return ACHIEVEMENTS;
}
