import { createHmac, timingSafeEqual } from "node:crypto";

import { queryOne } from "@/lib/platform/postgres.server";
import { mergeParticipants } from "./scoring.server";

const CLAIM_LIFETIME_SECONDS = 60 * 60 * 24 * 30;

type GameClaimPayload = {
  version: 1;
  channelId: string;
  gamePlayerId: string;
  sourceParticipantId: string;
  expiresAt: number;
};

type GameClaimResult =
  | { ok: true; value: { participantId: string } }
  | { ok: false; status: number; error: string };

function signingKey(): string {
  const secret = process.env.AUTH_SECRET?.trim();
  if (secret) return secret;
  if (process.env.NODE_ENV === "production") {
    throw new Error("AUTH_SECRET must be set before game result claims can be issued");
  }
  return "local-event-game-result-claim-key";
}

function signature(encodedPayload: string): string {
  return createHmac("sha256", signingKey()).update(encodedPayload).digest("base64url");
}

function encodeClaim(payload: GameClaimPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `game_claim_${encoded}.${signature(encoded)}`;
}

function decodeClaim(token: string): GameClaimPayload | null {
  if (!token.startsWith("game_claim_") || token.length > 2_000) return null;
  const [encoded, suppliedSignature] = token.slice("game_claim_".length).split(".");
  if (!encoded || !suppliedSignature) return null;
  const expectedSignature = signature(encoded);
  const supplied = Buffer.from(suppliedSignature);
  const expected = Buffer.from(expectedSignature);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const value = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as Partial<GameClaimPayload>;
    if (
      value.version !== 1 ||
      typeof value.channelId !== "string" ||
      typeof value.gamePlayerId !== "string" ||
      typeof value.sourceParticipantId !== "string" ||
      typeof value.expiresAt !== "number" ||
      !Number.isSafeInteger(value.expiresAt)
    )
      return null;
    return value as GameClaimPayload;
  } catch {
    return null;
  }
}

export async function issueGamePlayerClaimToken(input: {
  channelId: string;
  gamePlayerId: string;
}): Promise<{ ok: true; value: { token: string } } | { ok: false; status: number; error: string }> {
  const row = await queryOne<{ participant_id: string }>(
    `select participants.id as participant_id
       from event_game_player_links links
       join event_participants participants on participants.id = links.participant_id
       join event_game_score_bindings bindings on bindings.channel_id = links.channel_id
      where links.channel_id = $1 and links.game_player_id = $2
        and bindings.status in ('active', 'closed')
        and participants.status = 'active'
        and participants.ticket_id is null
        and participants.person_id is null`,
    [input.channelId, input.gamePlayerId],
  );
  if (!row) return { ok: false, status: 404, error: "Unclaimed game player not found" };
  return {
    ok: true,
    value: {
      token: encodeClaim({
        version: 1,
        channelId: input.channelId,
        gamePlayerId: input.gamePlayerId,
        sourceParticipantId: row.participant_id,
        expiresAt: Math.floor(Date.now() / 1_000) + CLAIM_LIFETIME_SECONDS,
      }),
    },
  };
}

export async function claimGamePlayerResult(input: {
  token: string;
  targetParticipantId: string;
}): Promise<GameClaimResult> {
  const payload = decodeClaim(input.token);
  if (!payload || payload.expiresAt < Math.floor(Date.now() / 1_000)) {
    return { ok: false, status: 400, error: "Game result claim is invalid or expired" };
  }
  const claim = await queryOne<{
    event_slug: string;
    source_status: string;
    target_status: string;
    target_ticket_id: string | null;
    already_claimed: boolean;
  }>(
    `select events.slug as event_slug,
            source.status as source_status,
            target.status as target_status,
            target.ticket_id as target_ticket_id,
            exists (
              select 1 from event_participant_merges merges
               where merges.source_participant_id = source.id
                 and merges.target_participant_id = target.id
                 and merges.reversed_at is null
            ) as already_claimed
       from event_game_player_links links
       join event_game_score_bindings bindings on bindings.channel_id = links.channel_id
       join events on events.event_id = bindings.event_id
       join event_participants source on source.id = links.participant_id
       join event_participants target on target.id = $4 and target.event_slug = events.slug
      where links.channel_id = $1 and links.game_player_id = $2 and source.id = $3`,
    [
      payload.channelId,
      payload.gamePlayerId,
      payload.sourceParticipantId,
      input.targetParticipantId,
    ],
  );
  if (!claim || claim.target_status !== "active" || !claim.target_ticket_id) {
    return { ok: false, status: 404, error: "Claim target not found" };
  }
  if (claim.already_claimed) {
    return { ok: true, value: { participantId: input.targetParticipantId } };
  }
  if (claim.source_status !== "active") {
    return { ok: false, status: 409, error: "This game result has already been claimed" };
  }
  const merged = await mergeParticipants({
    eventSlug: claim.event_slug,
    sourceParticipantId: payload.sourceParticipantId,
    targetParticipantId: input.targetParticipantId,
    actorId: `attendee:${input.targetParticipantId}`,
    reason: "The attendee claimed an unclaimed official game result",
    evidence: [`signed-game-claim:${payload.channelId}:${payload.gamePlayerId}`],
  });
  return merged.ok
    ? { ok: true, value: { participantId: input.targetParticipantId } }
    : { ok: false, status: merged.status, error: merged.error };
}
