import { createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";

import { query, queryOne, transaction } from "@/lib/platform/postgres.server";
import type {
  OfficialGameKind,
  OfficialGameResultEnvelope,
  OfficialGameResultScope,
  OfficialResultPlayer,
} from "@/features/things/shared/official-game-results";
import { activityCanAccept, convertRulePoints, type ActivityStatus, type ScoreRule } from "./types";
import { recordScoreInTransaction, reverseScoreInTransaction } from "./store.server";

type BindingStatus = "provisioning" | "active" | "paused" | "closed";
type ResultStatus = "pending" | "processed" | "ignored" | "held";

type ResultRow = {
  id: string;
  channel_id: string;
  game_kind: OfficialGameKind;
  game_instance_id: string;
  result_id: string;
  revision: number;
  operation: "record" | "cancel";
  scope: OfficialGameResultScope;
  players: unknown;
  payload_hash: string;
  status: ResultStatus;
};

type ProcessRow = ResultRow & {
  event_id: string;
  event_slug: string;
  activity_id: string;
  binding_game_kind: OfficialGameKind;
  binding_game_instance_id: string | null;
  accepted_scope: OfficialGameResultScope;
  binding_status: BindingStatus;
};

export type OfficialResultProcessingOutcome =
  | { state: "processed" | "corrected" | "cancelled" | "ignored"; resultId: string }
  | { state: "held"; resultId: string; reason: string };

function opaqueId(prefix: "gsc" | "ogr" | "sgr") {
  return `${prefix}_${randomBytes(18).toString("base64url")}`;
}

function canonicalPayload(input: Omit<OfficialGameResultEnvelope, "payloadHash">): string {
  return JSON.stringify({
    schemaVersion: input.schemaVersion,
    channelId: input.channelId,
    gameKind: input.gameKind,
    gameInstanceId: input.gameInstanceId,
    resultId: input.resultId,
    revision: input.revision,
    operation: input.operation,
    scope: input.scope,
    players: input.players,
    committedAt: input.committedAt,
  });
}

export function officialResultPayloadHash(
  input: Omit<OfficialGameResultEnvelope, "payloadHash">,
): string {
  return createHash("sha256").update(canonicalPayload(input)).digest("hex");
}

export async function createGameScoreBinding(input: {
  eventSlug: string;
  activityId: string;
  gameKind: OfficialGameKind;
  acceptedScope: OfficialGameResultScope;
}): Promise<
  { ok: true; value: { channelId: string } } | { ok: false; status: number; error: string }
> {
  const channelId = opaqueId("gsc");
  const row = await queryOne<{ channel_id: string }>(
    `insert into event_game_score_bindings
       (channel_id, event_id, activity_id, game_kind, accepted_scope)
     select $1, events.event_id, activities.id, $4, $5
       from events
       join score_activities activities on activities.event_slug = events.slug
      where events.slug = $2 and activities.id = $3
     returning channel_id`,
    [channelId, input.eventSlug, input.activityId, input.gameKind, input.acceptedScope],
  );
  return row
    ? { ok: true, value: { channelId: row.channel_id } }
    : { ok: false, status: 404, error: "Event scoring activity not found" };
}

export async function activateGameScoreBinding(input: {
  channelId: string;
  gameInstanceId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const row = await queryOne<{ channel_id: string }>(
    `update event_game_score_bindings
        set game_instance_id = $2, status = 'active', updated_at = now()
      where channel_id = $1 and status = 'provisioning' and game_instance_id is null
      returning channel_id`,
    [input.channelId, input.gameInstanceId],
  );
  return row
    ? { ok: true }
    : { ok: false, status: 409, error: "Game score binding cannot be activated" };
}

export async function linkGamePlayer(input: {
  channelId: string;
  gamePlayerId: string;
  participantId: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const row = await queryOne<{ channel_id: string }>(
    `insert into event_game_player_links (channel_id, game_player_id, participant_id)
     select bindings.channel_id, $2, participants.id
       from event_game_score_bindings bindings
       join events on events.event_id = bindings.event_id
       join event_participants participants on participants.event_slug = events.slug
      where bindings.channel_id = $1
        and participants.id = $3
        and participants.status = 'active'
     on conflict (channel_id, game_player_id) do update set
       participant_id = excluded.participant_id
     returning channel_id`,
    [input.channelId, input.gamePlayerId, input.participantId],
  );
  return row
    ? { ok: true }
    : { ok: false, status: 404, error: "Game player or event participant not found" };
}

export async function ingestOfficialGameResult(
  envelope: OfficialGameResultEnvelope,
): Promise<
  | { ok: true; value: { id: string; duplicate: boolean } }
  | { ok: false; status: number; error: string }
> {
  if (
    envelope.schemaVersion !== 1 ||
    envelope.revision < 1 ||
    envelope.payloadHash !== officialResultPayloadHash(envelope)
  ) {
    return { ok: false, status: 400, error: "Official game result envelope is invalid" };
  }
  return transaction(async (client) => {
    const binding = await client.query<{ channel_id: string }>(
      `select channel_id from event_game_score_bindings
        where channel_id = $1 and game_kind = $2 and game_instance_id = $3
        for update`,
      [envelope.channelId, envelope.gameKind, envelope.gameInstanceId],
    );
    if (!binding.rows[0]) {
      return { ok: false, status: 404, error: "Active game score binding not found" };
    }
    const existing = await client.query<{ id: string; payload_hash: string }>(
      `select id, payload_hash from official_game_results
        where channel_id = $1 and result_id = $2 and revision = $3`,
      [envelope.channelId, envelope.resultId, envelope.revision],
    );
    if (existing.rows[0]) {
      if (existing.rows[0].payload_hash !== envelope.payloadHash) {
        await client.query(
          `update official_game_results
              set status = 'held', held_reason = 'Conflicting payload for one result revision'
            where id = $1`,
          [existing.rows[0].id],
        );
        return { ok: false, status: 409, error: "Official result revision conflicts" };
      }
      return { ok: true, value: { id: existing.rows[0].id, duplicate: true } };
    }
    const latest = await client.query<{ revision: number }>(
      `select revision from official_game_results
        where channel_id = $1 and result_id = $2
        order by revision desc limit 1`,
      [envelope.channelId, envelope.resultId],
    );
    const expectedRevision = (latest.rows[0]?.revision ?? 0) + 1;
    if (envelope.revision !== expectedRevision) {
      return {
        ok: false,
        status: 409,
        error: `Official result revision must be ${expectedRevision}`,
      };
    }
    const id = opaqueId("ogr");
    await client.query(
      `insert into official_game_results
         (id, channel_id, game_kind, game_instance_id, result_id, revision, operation,
          scope, players, payload_hash, committed_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11::timestamptz)`,
      [
        id,
        envelope.channelId,
        envelope.gameKind,
        envelope.gameInstanceId,
        envelope.resultId,
        envelope.revision,
        envelope.operation,
        envelope.scope,
        JSON.stringify(envelope.players),
        envelope.payloadHash,
        envelope.committedAt,
      ],
    );
    return { ok: true, value: { id, duplicate: false } };
  });
}

function resultPlayers(value: unknown): OfficialResultPlayer[] | null {
  if (!Array.isArray(value)) return null;
  const players: OfficialResultPlayer[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== "object") return null;
    const player = entry as Record<string, unknown>;
    if (typeof player.playerId !== "string" || typeof player.outcome !== "string") return null;
    players.push(player as OfficialResultPlayer);
  }
  return players;
}

async function holdResult(client: PoolClient, result: ResultRow, reason: string) {
  await client.query(
    `update official_game_results set status = 'held', held_reason = $2 where id = $1`,
    [result.id, reason],
  );
  return { state: "held", resultId: result.id, reason } as const;
}

async function processResult(
  client: PoolClient,
  resultId: string,
): Promise<OfficialResultProcessingOutcome> {
  const selected = await client.query<ProcessRow>(
    `select results.*,
            bindings.event_id,
            events.slug as event_slug,
            bindings.activity_id,
            bindings.game_kind as binding_game_kind,
            bindings.game_instance_id as binding_game_instance_id,
            bindings.accepted_scope,
            bindings.status as binding_status
       from official_game_results results
       join event_game_score_bindings bindings on bindings.channel_id = results.channel_id
       join events on events.event_id = bindings.event_id
      where results.id = $1 and results.status = 'pending'
      for update of results, bindings`,
    [resultId],
  );
  const row = selected.rows[0];
  if (!row) return { state: "ignored", resultId };
  if (
    row.binding_status !== "active" ||
    row.binding_game_kind !== row.game_kind ||
    row.binding_game_instance_id !== row.game_instance_id ||
    row.accepted_scope !== row.scope
  ) {
    return holdResult(client, row, "The game result does not match an active score binding");
  }
  const settings = await client.query<{ state: string }>(
    `select state from event_scoring_settings where event_slug = $1 for update`,
    [row.event_slug],
  );
  const scoringState = settings.rows[0]?.state ?? "off";
  if (scoringState === "off") {
    await client.query(
      `update official_game_results set status = 'ignored', processed_at = now() where id = $1`,
      [row.id],
    );
    return { state: "ignored", resultId: row.id };
  }
  if (scoringState !== "live") {
    return holdResult(client, row, `Scoring is ${scoringState}`);
  }
  const activities = await client.query<{
    status: ActivityStatus;
    rule: unknown;
    rule_revision: number;
    starts_at: Date | null;
    ends_at: Date | null;
  }>(
    `select status, rule, rule_revision, starts_at, ends_at
       from score_activities
      where id = $1 and event_slug = $2
      for update`,
    [row.activity_id, row.event_slug],
  );
  const activity = activities.rows[0];
  if (!activity) return holdResult(client, row, "The score activity no longer exists");
  if (
    !activityCanAccept({
      status: activity.status,
      startsAt: activity.starts_at?.toISOString(),
      endsAt: activity.ends_at?.toISOString(),
    })
  ) {
    return holdResult(client, row, "The score activity is not accepting results");
  }
  const players = resultPlayers(row.players);
  if (!players) return holdResult(client, row, "The official player result is invalid");
  const links = await client.query<{ game_player_id: string; participant_id: string }>(
    `select links.game_player_id, links.participant_id
       from event_game_player_links links
       join event_participants participants on participants.id = links.participant_id
      where links.channel_id = $1 and participants.status = 'active'
      for update of participants`,
    [row.channel_id],
  );
  const participantByPlayer = new Map(
    links.rows.map((link) => [link.game_player_id, link.participant_id]),
  );
  if (players.some((player) => !participantByPlayer.has(player.playerId))) {
    return holdResult(client, row, "A game player still needs an event participant");
  }

  const postings =
    row.operation === "record"
      ? players.flatMap((player) => {
          if (player.outcome === "withdrawn" || player.outcome === "disqualified") return [];
          const points = convertRulePoints(activity.rule as ScoreRule, player);
          const participantId = participantByPlayer.get(player.playerId);
          return points > 0 && participantId ? [{ participantId, points }] : [];
        })
      : [];
  if (row.operation === "record" && postings.length === 0) {
    return holdResult(client, row, "The configured rule awarded no points");
  }

  const prior = await client.query<{ transaction_id: string | null }>(
    `select receipts.transaction_id
       from score_game_receipts receipts
       join official_game_results prior on prior.id = receipts.official_result_id
      where prior.channel_id = $1 and prior.result_id = $2 and prior.revision < $3
        and receipts.status in ('processed', 'corrected')
      order by prior.revision desc
      limit 1
      for update of receipts`,
    [row.channel_id, row.result_id, row.revision],
  );
  let reversalTransactionId: string | null = null;
  if (prior.rows[0]?.transaction_id) {
    const reversed = await reverseScoreInTransaction(
      client,
      row.event_slug,
      prior.rows[0].transaction_id,
      {
        idempotencyKey: `game-result-reversal:${row.id}`,
        reasonCode: row.operation === "cancel" ? "reversal" : "correction",
        note:
          row.operation === "cancel"
            ? "Official game result cancelled"
            : "Official game result corrected",
        actorType: "system",
      },
    );
    if (!reversed.ok) throw new Error(reversed.error);
    reversalTransactionId = reversed.value.id;
  }

  let transactionId: string | null = null;
  if (row.operation === "record") {
    const scored = await recordScoreInTransaction(client, {
      eventSlug: row.event_slug,
      activityId: row.activity_id,
      sourceType: "game",
      sourceId: row.id,
      idempotencyKey: `game-result:${row.id}`,
      reasonCode: "completion",
      ruleRevision: activity.rule_revision,
      actorType: "system",
      metadata: {
        gameKind: row.game_kind,
        gameInstanceId: row.game_instance_id,
        resultId: row.result_id,
        revision: row.revision,
      },
      postings,
    });
    if (!scored.ok) throw new Error(scored.error);
    transactionId = scored.value.id;
  }

  const receiptStatus =
    row.operation === "cancel" ? "cancelled" : row.revision > 1 ? "corrected" : "processed";
  await client.query(
    `insert into score_game_receipts
       (id, official_result_id, event_id, activity_id, transaction_id,
        reversal_transaction_id, status)
     values ($1,$2,$3,$4,$5,$6,$7)`,
    [
      opaqueId("sgr"),
      row.id,
      row.event_id,
      row.activity_id,
      transactionId,
      reversalTransactionId,
      receiptStatus,
    ],
  );
  await client.query(
    `update official_game_results
        set status = 'processed', held_reason = null, processed_at = now()
      where id = $1`,
    [row.id],
  );
  return { state: receiptStatus, resultId: row.id };
}

export async function processOfficialGameResult(
  resultId: string,
): Promise<OfficialResultProcessingOutcome> {
  return transaction((client) => processResult(client, resultId));
}

export async function processPendingOfficialGameResults(limit = 50): Promise<{
  selected: number;
  processed: number;
  held: number;
  ignored: number;
}> {
  const ids = await query<{ id: string }>(
    `select id from official_game_results
      where status = 'pending'
      order by ingested_at, id
      limit $1`,
    [Math.max(1, Math.min(200, Math.trunc(limit)))],
  );
  const outcomes: OfficialResultProcessingOutcome[] = [];
  for (const row of ids) outcomes.push(await processOfficialGameResult(row.id));
  return {
    selected: ids.length,
    processed: outcomes.filter((outcome) =>
      ["processed", "corrected", "cancelled"].includes(outcome.state),
    ).length,
    held: outcomes.filter((outcome) => outcome.state === "held").length,
    ignored: outcomes.filter((outcome) => outcome.state === "ignored").length,
  };
}

export async function retryHeldOfficialGameResult(
  resultId: string,
): Promise<OfficialResultProcessingOutcome> {
  await query(
    `update official_game_results set status = 'pending', held_reason = null where id = $1 and status = 'held'`,
    [resultId],
  );
  return processOfficialGameResult(resultId);
}
