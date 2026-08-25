import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { query } from "@/lib/platform/postgres.server";
import {
  acceptHeldScore,
  createActivity,
  createPool,
  createTeam,
  findSettings,
  getOrCreateSettings,
  participantForTicket,
  recordScore,
  rebuildEventProjections,
  reverseScore,
  setTeamMembership,
} from "@/features/event-scoring/store.server";
import { renameEventSlug } from "@/features/events/store.server";
import { markTicketStatus } from "@/features/tickets/store.server";
import {
  activateGameScoreBinding,
  createGameScoreBinding,
  ingestOfficialGameResult,
  linkGamePlayer,
  processOfficialGameResult,
  retryHeldOfficialGameResult,
} from "@/features/event-scoring/games.server";
import {
  claimGamePlayerResult,
  issueGamePlayerClaimToken,
} from "@/features/event-scoring/game-claims.server";
import { officialResultPayloadHash } from "@/features/things/shared/official-game-results.server";
import type { OfficialGameResultEnvelope } from "@/features/things/shared/official-game-results";
import {
  mergeParticipants,
  reverseParticipantMerge,
} from "@/features/event-scoring/scoring.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

function centreEnvelope(input: {
  channelId: string;
  revision: number;
  operation?: "record" | "cancel";
  placement?: number;
  players?: Array<{ playerId: string; outcome: "completed"; placement: number }>;
}): OfficialGameResultEnvelope {
  const unsigned = {
    schemaVersion: 1,
    channelId: input.channelId,
    gameKind: "centre",
    gameInstanceId: "game-1",
    resultId: "final",
    revision: input.revision,
    operation: input.operation ?? "record",
    scope: "game",
    players:
      input.operation === "cancel"
        ? []
        : (input.players ?? [
            {
              playerId: "player-1",
              outcome: "completed" as const,
              placement: input.placement ?? 1,
            },
          ]),
    committedAt: new Date(1_700_000_000_000 + input.revision).toISOString(),
  } as const satisfies Omit<OfficialGameResultEnvelope, "payloadHash">;
  return {
    ...unsigned,
    players: [...unsigned.players],
    payloadHash: officialResultPayloadHash(unsigned),
  };
}

describeWithDatabase("event scoring postgres", () => {
  beforeAll(async () => {
    await applySchema();
  });

  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into events (slug, title, status, starts_at, timezone) values ('scoring-night', 'Scoring Night', 'published', now(), 'Europe/London')`,
    );
    await query(
      `insert into ticket_types (event_slug, id, name, quantity) values ('scoring-night', 'standard', 'Standard', 20)`,
    );
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id) values ('01ARZ3NDEKTSV4RR', 'scoring-night', 'standard', 'Guest', 'ord_test')`,
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("creates one participant from one ticket and keeps refund eligibility transactional", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    expect(participant).toMatchObject({
      eventSlug: "scoring-night",
      ticketId: "01ARZ3NDEKTSV4RR",
      status: "active",
      balance: 0,
    });
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from event_participants where ticket_id = '01ARZ3NDEKTSV4RR'`,
        )
      )[0]?.count,
    ).toBe("1");

    const refunded = await markTicketStatus("01ARZ3NDEKTSV4RR", "refunded", "re_test");
    expect(refunded?.status).toBe("refunded");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.status).toBe("refunded");
  });

  it("keeps disabled scoring as a read-only no-op", async () => {
    expect(await findSettings("scoring-night")).toBeNull();
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from event_scoring_settings where event_slug = 'scoring-night'`,
        )
      )[0]?.count,
    ).toBe("0");

    await getOrCreateSettings("scoring-night");
    expect((await findSettings("scoring-night"))?.state).toBe("off");
  });

  it("merges and splits projections without rewriting ledger postings", async () => {
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
       values ('01ARZ3NDEKTSV4RS', 'scoring-night', 'standard', 'Second Guest', 'ord_second')`,
    );
    const source = await participantForTicket("01ARZ3NDEKTSV4RR");
    const target = await participantForTicket("01ARZ3NDEKTSV4RS");
    expect(source && target).toBeTruthy();
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Identity merge",
      template: "free-form",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 1, repeat: "repeat", requiresCheckIn: false },
    });
    for (const [participantId, points] of [
      [source!.id, 3],
      [target!.id, 5],
    ] as const) {
      const result = await recordScore({
        eventSlug: "scoring-night",
        activityId: activity.id,
        sourceType: "manual",
        sourceId: `identity-${participantId}`,
        idempotencyKey: `identity-${participantId}`,
        reasonCode: "other",
        actorType: "admin",
        note: "Identity projection test",
        postings: [{ participantId, points }],
      });
      expect(result.ok).toBe(true);
    }

    const merged = await mergeParticipants({
      eventSlug: "scoring-night",
      sourceParticipantId: source!.id,
      targetParticipantId: target!.id,
      actorId: "admin-1",
      reason: "Verified duplicate",
      evidence: ["verified-email"],
    });
    expect(merged.ok).toBe(true);
    expect((await participantForTicket("01ARZ3NDEKTSV4RS"))?.balance).toBe(8);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.status).toBe("merged");
    await rebuildEventProjections("scoring-night");
    expect((await participantForTicket("01ARZ3NDEKTSV4RS"))?.balance).toBe(8);
    expect(
      (await query<{ count: string }>(`select count(*)::text as count from score_postings`))[0]
        ?.count,
    ).toBe("2");

    const merge = await query<{ id: string }>(
      `select id from event_participant_merges where source_participant_id = $1`,
      [source!.id],
    );
    const split = await reverseParticipantMerge({
      mergeId: merge[0]!.id,
      actorId: "admin-1",
      reason: "Merge was mistaken",
    });
    expect(split.ok).toBe(true);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(3);
    expect((await participantForTicket("01ARZ3NDEKTSV4RS"))?.balance).toBe(5);
    expect(
      (await query<{ count: string }>(`select count(*)::text as count from score_postings`))[0]
        ?.count,
    ).toBe("2");
  });

  it("accepts a concurrent duplicate award once and rebuilds the same projection", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    expect(participant).toBeTruthy();
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Winner",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 5, repeat: "once", requiresCheckIn: false },
    });

    const inputs = {
      eventSlug: "scoring-night",
      activityId: activity.id,
      sourceType: "manual" as const,
      sourceId: "award-1",
      idempotencyKey: "command-1",
      reasonCode: "winner" as const,
      actorType: "staff" as const,
      actorId: "staff-1",
      postings: [{ participantId: participant!.id, points: 5 }],
    };
    const outcomes = await Promise.all([recordScore(inputs), recordScore(inputs)]);
    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    expect(
      (await query<{ count: string }>(`select count(*)::text as count from score_postings`))[0]
        ?.count,
    ).toBe("1");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(5);

    const rebuilt = await rebuildEventProjections("scoring-night");
    expect(rebuilt.balances[participant!.id]).toBe(5);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(5);
  });

  it("reverses an accepted score with one exact linked opposite posting", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const awarded = await recordScore({
      eventSlug: "scoring-night",
      sourceType: "manual",
      sourceId: "award-to-reverse",
      idempotencyKey: "award-to-reverse",
      reasonCode: "other",
      note: "Award",
      actorType: "admin",
      postings: [{ participantId: participant!.id, points: 9 }],
    });
    expect(awarded.ok).toBe(true);

    const reversed = await reverseScore(
      "scoring-night",
      awarded.ok ? awarded.value.id : "missing",
      {
        idempotencyKey: "reverse-award",
        reasonCode: "correction",
        note: "Mistaken award",
        actorType: "admin",
        actorId: "admin-1",
      },
    );
    expect(reversed.ok && reversed.value.postings).toEqual([
      { participantId: participant!.id, points: -9 },
    ]);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(0);
    expect(
      await query<{ original_transaction_id: string }>(
        `select original_transaction_id from score_transactions where id = $1`,
        [reversed.ok ? reversed.value.id : "missing"],
      ),
    ).toEqual([{ original_transaction_id: awarded.ok ? awarded.value.id : "missing" }]);
  });

  it("moves a route slug atomically without changing immutable event identity", async () => {
    const before = await query<{ event_id: string }>(
      `select event_id from events where slug = 'scoring-night'`,
    );
    await renameEventSlug("scoring-night", "renamed-scoring-night");
    const after = await query<{ event_id: string }>(
      `select event_id from events where slug = 'renamed-scoring-night'`,
    );
    expect(after[0]?.event_id).toBe(before[0]?.event_id);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.eventSlug).toBe(
      "renamed-scoring-night",
    );
    expect(
      (
        await query<{ event_slug: string }>(
          `select event_slug from tickets where id = '01ARZ3NDEKTSV4RR'`,
        )
      )[0]?.event_slug,
    ).toBe("renamed-scoring-night");
  });

  it("holds frozen scores, accepts them after resume, and protects the ledger", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Held award",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 5, repeat: "once", requiresCheckIn: false },
    });
    await query(
      `insert into event_scoring_settings (event_slug, state) values ('scoring-night', 'frozen') on conflict (event_slug) do update set state = 'frozen'`,
    );
    const held = await recordScore({
      eventSlug: "scoring-night",
      activityId: activity.id,
      sourceType: "manual",
      sourceId: "held-award",
      idempotencyKey: "held-command",
      reasonCode: "winner",
      actorType: "staff",
      postings: [{ participantId: participant!.id, points: 5 }],
    });
    expect(held.ok && held.value.status).toBe("held");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(0);

    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const accepted = await acceptHeldScore("scoring-night", held.ok ? held.value.id : "missing", {
      actorType: "admin",
      actorId: "admin-1",
    });
    expect(accepted.ok && accepted.value.status).toBe("accepted");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(5);
    await expect(
      query(`update score_postings set points = 99 where transaction_id = $1`, [
        accepted.ok ? accepted.value.id : "missing",
      ]),
    ).rejects.toThrow(/immutable/);
  });

  it("serializes staff pool awards and captures team attribution", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const team = await createTeam({ eventSlug: "scoring-night", name: "Amber" });
    expect(team.ok).toBe(true);
    const membership = await setTeamMembership({
      eventSlug: "scoring-night",
      teamId: team.ok ? team.value.id : "missing",
      participantId: participant!.id,
    });
    expect(membership.ok).toBe(true);
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Pool award",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 5, repeat: "repeat", requiresCheckIn: false },
    });
    const pool = await createPool({
      eventSlug: "scoring-night",
      activityId: activity.id,
      ownerType: "activity",
      points: 5,
    });
    expect(pool.ok).toBe(true);
    const result = await Promise.all([
      recordScore({
        eventSlug: "scoring-night",
        activityId: activity.id,
        sourceType: "manual",
        sourceId: "pool-1",
        idempotencyKey: "pool-command-1",
        reasonCode: "winner",
        actorType: "staff",
        poolId: pool.ok ? pool.value.id : "missing",
        postings: [{ participantId: participant!.id, points: 5 }],
      }),
      recordScore({
        eventSlug: "scoring-night",
        activityId: activity.id,
        sourceType: "manual",
        sourceId: "pool-2",
        idempotencyKey: "pool-command-2",
        reasonCode: "winner",
        actorType: "staff",
        poolId: pool.ok ? pool.value.id : "missing",
        postings: [{ participantId: participant!.id, points: 5 }],
      }),
    ]);
    expect(result.filter((entry) => entry.ok)).toHaveLength(1);
    const accepted = result.find((entry) => entry.ok);
    expect(
      (
        await query<{ team_id: string }>(
          `select team_id from score_postings where transaction_id = $1`,
          [accepted?.ok ? accepted.value.id : "missing"],
        )
      )[0]?.team_id,
    ).toBe(team.ok ? team.value.id : "missing");
  });

  it("keeps an automatic game receipt idempotent across a frozen retry", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Centre",
      template: "winner",
      status: "live",
      rule: {
        mode: "placement",
        placementPoints: { "1": 7, "2": 3 },
        repeat: "once-per-source",
        requiresCheckIn: false,
      },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'frozen' where event_slug = 'scoring-night'`,
    );
    const binding = await createGameScoreBinding({
      eventSlug: "scoring-night",
      activityId: activity.id,
      gameKind: "centre",
      acceptedScope: "game",
    });
    expect(binding.ok).toBe(true);
    const channelId = binding.ok ? binding.value.channelId : "missing";
    expect(await activateGameScoreBinding({ channelId, gameInstanceId: "game-1" })).toEqual({
      ok: true,
    });
    expect(
      await linkGamePlayer({
        channelId,
        gamePlayerId: "player-1",
        participantId: participant!.id,
      }),
    ).toEqual({ ok: true });
    const envelope = centreEnvelope({ channelId, revision: 1 });
    const ingestions = await Promise.all([
      ingestOfficialGameResult(envelope),
      ingestOfficialGameResult(envelope),
    ]);
    expect(ingestions.every((result) => result.ok)).toBe(true);
    expect(ingestions.map((result) => (result.ok ? result.value.duplicate : null)).sort()).toEqual([
      false,
      true,
    ]);
    const resultId = ingestions[0]?.ok ? ingestions[0].value.id : "missing";
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(0);
    expect(
      (await query<{ count: string }>(`select count(*)::text as count from score_game_receipts`))[0]
        ?.count,
    ).toBe("0");
    expect((await processOfficialGameResult(resultId)).state).toBe("held");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const processed = await retryHeldOfficialGameResult(resultId);
    expect(processed.state).toBe("processed");
    const duplicate = await ingestOfficialGameResult(envelope);
    expect(duplicate.ok && duplicate.value.duplicate).toBe(true);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from score_game_receipts receipts
            join official_game_results results on results.id = receipts.official_result_id
           where results.channel_id = $1 and results.result_id = 'final'`,
          [channelId],
        )
      )[0]?.count,
    ).toBe("1");

    const invalidCorrection = await ingestOfficialGameResult(
      centreEnvelope({ channelId, revision: 2, placement: 99 }),
    );
    expect(invalidCorrection.ok).toBe(true);
    expect(
      (
        await processOfficialGameResult(
          invalidCorrection.ok ? invalidCorrection.value.id : "missing",
        )
      ).state,
    ).toBe("held");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);

    const correction = await ingestOfficialGameResult(
      centreEnvelope({ channelId, revision: 3, placement: 2 }),
    );
    expect(correction.ok).toBe(true);
    expect(
      (await processOfficialGameResult(correction.ok ? correction.value.id : "missing")).state,
    ).toBe("corrected");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(3);

    const cancellation = await ingestOfficialGameResult(
      centreEnvelope({ channelId, revision: 4, operation: "cancel" }),
    );
    expect(cancellation.ok).toBe(true);
    expect(
      (await processOfficialGameResult(cancellation.ok ? cancellation.value.id : "missing")).state,
    ).toBe("cancelled");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(0);
    expect(
      await query<{
        revision: number;
        status: string;
        points: string;
        has_reversal: boolean;
      }>(
        `select results.revision,
                receipts.status,
                coalesce(sum(postings.points), 0)::text as points,
                receipts.reversal_transaction_id is not null as has_reversal
           from score_game_receipts receipts
           join official_game_results results on results.id = receipts.official_result_id
           left join score_postings postings on postings.transaction_id = receipts.transaction_id
          where results.channel_id = $1
          group by results.revision, receipts.status, receipts.reversal_transaction_id
          order by results.revision`,
        [channelId],
      ),
    ).toEqual([
      { revision: 1, status: "processed", points: "7", has_reversal: false },
      { revision: 3, status: "corrected", points: "3", has_reversal: true },
      { revision: 4, status: "cancelled", points: "0", has_reversal: true },
    ]);
  });

  it("creates event-local placeholders for unclaimed official game players", async () => {
    const ticketParticipant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Unclaimed players",
      template: "placement",
      status: "live",
      rule: {
        mode: "placement",
        placementPoints: { "1": 7, "2": 3 },
        repeat: "once-per-source",
        requiresCheckIn: false,
      },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const binding = await createGameScoreBinding({
      eventSlug: "scoring-night",
      activityId: activity.id,
      gameKind: "centre",
      acceptedScope: "game",
    });
    const channelId = binding.ok ? binding.value.channelId : "missing";
    expect(await activateGameScoreBinding({ channelId, gameInstanceId: "game-1" })).toEqual({
      ok: true,
    });
    const ingested = await ingestOfficialGameResult(
      centreEnvelope({
        channelId,
        revision: 1,
        players: [
          { playerId: "unclaimed-one", outcome: "completed", placement: 1 },
          { playerId: "unclaimed-two", outcome: "completed", placement: 2 },
        ],
      }),
    );
    expect(ingested.ok).toBe(true);
    expect(
      await processOfficialGameResult(ingested.ok ? ingested.value.id : "missing"),
    ).toMatchObject({ state: "processed" });
    expect(
      await query<{
        game_player_id: string;
        ticket_id: string | null;
        points: number;
      }>(
        `select links.game_player_id, participants.ticket_id, postings.points
           from event_game_player_links links
           join event_participants participants on participants.id = links.participant_id
           join score_postings postings on postings.participant_id = participants.id
          where links.channel_id = $1
          order by links.game_player_id`,
        [channelId],
      ),
    ).toEqual([
      { game_player_id: "unclaimed-one", ticket_id: null, points: 7 },
      { game_player_id: "unclaimed-two", ticket_id: null, points: 3 },
    ]);
    const claimToken = await issueGamePlayerClaimToken({
      channelId,
      gamePlayerId: "unclaimed-one",
    });
    expect(claimToken.ok).toBe(true);
    const token = claimToken.ok ? claimToken.value.token : "missing";
    expect(
      await claimGamePlayerResult({
        token: `${token}tampered`,
        targetParticipantId: ticketParticipant!.id,
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      await claimGamePlayerResult({ token, targetParticipantId: ticketParticipant!.id }),
    ).toEqual({ ok: true, value: { participantId: ticketParticipant!.id } });
    expect(
      await claimGamePlayerResult({ token, targetParticipantId: ticketParticipant!.id }),
    ).toEqual({ ok: true, value: { participantId: ticketParticipant!.id } });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
  });
});
