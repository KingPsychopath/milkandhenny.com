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
  setTeamMembership,
} from "@/features/event-scoring/store.server";
import { renameEventSlug } from "@/features/events/store.server";
import { markTicketStatus } from "@/features/tickets/store.server";
import {
  processHeldGameResult,
  recordOfficialGameResult,
} from "@/features/event-scoring/games.server";
import {
  mergeParticipants,
  reverseParticipantMerge,
} from "@/features/event-scoring/scoring.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

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
    expect(
      (await query<{ team_id: string }>(`select team_id from score_postings limit 1`))[0]?.team_id,
    ).toBe(team.ok ? team.value.id : "missing");
  });

  it("keeps an automatic game receipt idempotent across a frozen retry", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Centre",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 7, repeat: "once-per-source", requiresCheckIn: false },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'frozen' where event_slug = 'scoring-night'`,
    );
    const held = await recordOfficialGameResult({
      eventSlug: "scoring-night",
      activityId: activity.id,
      gameKind: "centre",
      gameInstanceId: "game-1",
      sourceKey: "centre:game-1",
      players: [{ participantId: participant!.id, placement: 1 }],
    });
    expect(held.ok && held.value.state).toBe("held");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const processed = await processHeldGameResult({
      receiptId: held.ok ? held.value.receiptId : "missing",
      actorId: "admin-1",
    });
    expect(processed.state).toBe("processed");
    const duplicate = await recordOfficialGameResult({
      eventSlug: "scoring-night",
      activityId: activity.id,
      gameKind: "centre",
      gameInstanceId: "game-1",
      sourceKey: "centre:game-1",
      players: [{ participantId: participant!.id, placement: 1 }],
    });
    expect(duplicate.ok && duplicate.value.state).toBe("duplicate");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from score_game_receipts where source_key = 'centre:game-1'`,
        )
      )[0]?.count,
    ).toBe("1");
  });
});
