import { randomUUID } from "node:crypto";

import { query, queryOne } from "@/lib/platform/postgres.server";
import {
  activityCanAccept,
  canAcceptScore,
  convertRulePoints,
  type ScoreTransaction,
} from "./types";
import {
  acceptHeldScore,
  getActivity,
  getOrCreateSettings,
  getParticipant,
  getScoreTransaction,
  recordScore,
  reverseScore,
} from "./store.server";

export type GamePlayerResult = {
  participantId: string;
  rawScore?: number;
  placement?: number;
};

export type GameResultOutcome =
  | { state: "processed"; receiptId: string; transaction: ScoreTransaction }
  | { state: "held"; receiptId: string; reason: string }
  | { state: "rejected"; receiptId: string; reason: string }
  | { state: "duplicate"; receiptId: string; transaction?: ScoreTransaction };

type ReceiptRow = {
  id: string;
  event_slug: string;
  activity_id: string;
  game_kind: string;
  game_instance_id: string;
  round_id: string | null;
  status: string;
  participants: unknown;
  result: unknown;
  source_key: string;
  current_transaction_id: string | null;
};

function id(prefix: string): string {
  return `${prefix}_${randomUUID().replaceAll("-", "").slice(0, 24)}`;
}

export async function recordOfficialGameResult(input: {
  eventSlug: string;
  activityId: string;
  gameKind: string;
  gameInstanceId: string;
  roundId?: string;
  sourceKey: string;
  players: GamePlayerResult[];
}): Promise<{ ok: true; value: GameResultOutcome } | { ok: false; status: number; error: string }> {
  const activity = await getActivity(input.activityId);
  if (!activity || activity.eventSlug !== input.eventSlug)
    return { ok: false, status: 404, error: "Activity not found" };
  let receipt = await queryOne<ReceiptRow>(
    `insert into score_game_receipts
       (id, event_slug, activity_id, game_kind, game_instance_id, round_id, participants, result, source_key)
     values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8::jsonb,$9)
     on conflict (event_slug, source_key) do nothing
     returning id, event_slug, activity_id, game_kind, game_instance_id, round_id, status, participants, result, source_key, current_transaction_id`,
    [
      id("game"),
      input.eventSlug,
      input.activityId,
      input.gameKind,
      input.gameInstanceId,
      input.roundId ?? null,
      JSON.stringify(input.players.map((player) => player.participantId)),
      JSON.stringify(input.players),
      input.sourceKey,
    ],
  );

  if (!receipt) {
    const existing = await queryOne<ReceiptRow>(
      `select id, event_slug, activity_id, game_kind, game_instance_id, round_id, status, participants, result, source_key, current_transaction_id
         from score_game_receipts where event_slug = $1 and source_key = $2`,
      [input.eventSlug, input.sourceKey],
    );
    if (!existing)
      return { ok: false, status: 409, error: "This game result is already being processed" };
    if (
      existing.status === "processed" ||
      existing.status === "cancelled" ||
      existing.status === "corrected"
    ) {
      const transaction = existing.current_transaction_id
        ? { id: existing.current_transaction_id }
        : await queryOne<{ id: string }>(
            `select id from score_transactions where event_slug = $1 and source_type = 'game' and source_id = $2`,
            [input.eventSlug, existing.id],
          );
      return {
        ok: true,
        value: {
          state: "duplicate",
          receiptId: existing.id,
          transaction: transaction ? await readTransaction(transaction.id) : undefined,
        },
      };
    }
    receipt = existing;
  }

  if (!receipt)
    return { ok: false, status: 409, error: "This game result is already being processed" };
  const players = Array.isArray(receipt.result)
    ? (receipt.result as GamePlayerResult[])
    : input.players;

  const settings = await getOrCreateSettings(input.eventSlug);
  if (settings.state === "closed") {
    await markReceipt(receipt.id, "held");
    return {
      ok: true,
      value: {
        state: "held",
        receiptId: receipt.id,
        reason: "Scoring is closed; an admin must review this result",
      },
    };
  }
  if (settings.state === "frozen") {
    await markReceipt(receipt.id, "held");
    return {
      ok: true,
      value: { state: "held", receiptId: receipt.id, reason: "Scoring is frozen" },
    };
  }
  if (!canAcceptScore(settings, "normal") || !activityCanAccept(activity)) {
    await markReceipt(receipt.id, "rejected");
    return {
      ok: true,
      value: {
        state: "rejected",
        receiptId: receipt.id,
        reason: "The event or activity is not accepting results",
      },
    };
  }

  const postings = [];
  for (const player of players) {
    const participant = await getParticipant(player.participantId);
    if (!participant || participant.eventSlug !== input.eventSlug) {
      await markReceipt(receipt.id, "held");
      return {
        ok: true,
        value: {
          state: "held",
          receiptId: receipt.id,
          reason: "A player still needs an event participant",
        },
      };
    }
    const points = convertRulePoints(activity.rule, player);
    if (points > 0) postings.push({ participantId: player.participantId, points });
  }
  if (postings.length === 0) {
    await markReceipt(receipt.id, "rejected");
    return {
      ok: true,
      value: {
        state: "rejected",
        receiptId: receipt.id,
        reason: "The configured rule awarded no points",
      },
    };
  }
  const scored = await recordScore({
    eventSlug: input.eventSlug,
    activityId: input.activityId,
    sourceType: "game",
    sourceId: receipt.id,
    idempotencyKey: `game:${receipt.id}`,
    reasonCode: "completion",
    actorType: "system",
    metadata: {
      gameKind: input.gameKind,
      gameInstanceId: input.gameInstanceId,
      roundId: input.roundId ?? null,
    },
    postings,
  });
  if (!scored.ok) {
    await markReceipt(receipt.id, scored.status >= 500 ? "held" : "rejected");
    return {
      ok: true,
      value: {
        state: scored.status >= 500 ? "held" : "rejected",
        receiptId: receipt.id,
        reason: scored.error,
      },
    };
  }
  if (scored.value.status === "held") {
    await markReceipt(receipt.id, "held", scored.value.id);
    return {
      ok: true,
      value: { state: "held", receiptId: receipt.id, reason: "Scoring is frozen" },
    };
  }
  await markReceipt(receipt.id, "processed", scored.value.id);
  return {
    ok: true,
    value: { state: "processed", receiptId: receipt.id, transaction: scored.value },
  };
}

async function markReceipt(
  receiptId: string,
  status: "processed" | "held" | "rejected" | "cancelled" | "corrected",
  transactionId?: string,
): Promise<void> {
  await query(
    `update score_game_receipts
        set status = $2,
            current_transaction_id = coalesce($3, current_transaction_id),
            processed_at = case when $2 = 'processed' then now() else processed_at end
      where id = $1`,
    [receiptId, status, transactionId ?? null],
  );
}

async function readTransaction(transactionId: string): Promise<ScoreTransaction | undefined> {
  return (await getScoreTransaction(transactionId)) ?? undefined;
}

export async function processHeldGameResult(input: {
  receiptId: string;
  actorId: string;
}): Promise<GameResultOutcome | { state: "rejected"; receiptId: string; reason: string }> {
  const receipt = await queryOne<ReceiptRow>(
    `select id, event_slug, activity_id, game_kind, game_instance_id, round_id, status, participants, result, source_key, current_transaction_id
       from score_game_receipts
      where id = $1 and status = 'held'`,
    [input.receiptId],
  );
  if (!receipt)
    return { state: "rejected", receiptId: input.receiptId, reason: "Held game receipt not found" };
  const transaction = receipt.current_transaction_id
    ? { id: receipt.current_transaction_id }
    : await queryOne<{ id: string }>(
        `select id from score_transactions
          where event_slug = $1 and source_type = 'game' and source_id = $2 and status = 'held'`,
        [receipt.event_slug, receipt.id],
      );
  if (!transaction) {
    const players = Array.isArray(receipt.result) ? (receipt.result as GamePlayerResult[]) : [];
    const retried = await recordOfficialGameResult({
      eventSlug: receipt.event_slug,
      activityId: receipt.activity_id,
      gameKind: receipt.game_kind,
      gameInstanceId: receipt.game_instance_id,
      roundId: receipt.round_id ?? undefined,
      sourceKey: receipt.source_key,
      players,
    });
    if (!retried.ok) return { state: "rejected", receiptId: receipt.id, reason: retried.error };
    return retried.value;
  }
  const accepted = await acceptHeldScore(receipt.event_slug, transaction.id, {
    actorType: "admin",
    actorId: input.actorId,
  });
  if (!accepted.ok) return { state: "held", receiptId: receipt.id, reason: accepted.error };
  await markReceipt(receipt.id, "processed", accepted.value.id);
  return { state: "processed", receiptId: receipt.id, transaction: accepted.value };
}

export async function cancelOfficialGameResult(input: {
  receiptId: string;
  actorId: string;
  reason: string;
}): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  if (!input.reason.trim())
    return { ok: false, status: 400, error: "A cancellation needs a reason" };
  const row = await queryOne<{ event_slug: string; status: string }>(
    `update score_game_receipts set status = 'cancelled' where id = $1 and status in ('pending', 'held') returning event_slug, status`,
    [input.receiptId],
  );
  if (!row) return { ok: false, status: 404, error: "Game receipt not found or already settled" };
  await query(
    `insert into score_audit_events (event_slug, action, actor_type, actor_id, entity_type, entity_id, metadata)
     values ($1,'game.result.cancelled','admin',$2,'game_receipt',$3,$4::jsonb)`,
    [row.event_slug, input.actorId, input.receiptId, JSON.stringify({ reason: input.reason })],
  );
  return { ok: true };
}

export async function correctOfficialGameResult(input: {
  receiptId: string;
  actorId: string;
  reason: string;
  players: GamePlayerResult[];
  idempotencyKey: string;
}): Promise<{ ok: true; value: GameResultOutcome } | { ok: false; status: number; error: string }> {
  if (!input.reason.trim()) return { ok: false, status: 400, error: "A correction needs a reason" };
  const receipt = await queryOne<ReceiptRow>(`select * from score_game_receipts where id = $1`, [
    input.receiptId,
  ]);
  if (!receipt) return { ok: false, status: 404, error: "Game receipt not found" };
  const original = receipt.current_transaction_id
    ? { id: receipt.current_transaction_id }
    : await queryOne<{ id: string }>(
        `select id from score_transactions where event_slug = $1 and source_type = 'game' and source_id = $2`,
        [receipt.event_slug, receipt.id],
      );
  if (original) {
    const reversed = await reverseScore(receipt.event_slug, original.id, {
      idempotencyKey: `game-correction-reversal:${input.idempotencyKey}`,
      reasonCode: "correction",
      note: input.reason,
      actorType: "admin",
      actorId: input.actorId,
    });
    if (!reversed.ok) return reversed;
  }
  const corrected = await recordOfficialGameResult({
    eventSlug: receipt.event_slug,
    activityId: receipt.activity_id,
    gameKind: "corrected",
    gameInstanceId: receipt.id,
    sourceKey: `correction:${input.idempotencyKey}`,
    players: input.players,
  });
  if (corrected.ok && corrected.value.state === "processed") {
    await query(
      `update score_game_receipts
          set status = 'corrected', result = $2::jsonb, current_transaction_id = $3
        where id = $1`,
      [input.receiptId, JSON.stringify(input.players), corrected.value.transaction.id],
    );
  }
  return corrected;
}
