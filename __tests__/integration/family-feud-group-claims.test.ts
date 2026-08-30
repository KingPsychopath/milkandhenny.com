import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

import {
  claimGroupGameResult,
  openGroupGameClaimSession,
  readGroupGameClaimSession,
} from "@/features/event-scoring/group-game-claims.server";
import { consumeOfficialGameResult } from "@/features/event-scoring/games.server";
import { launchEventFamilyFeudGame } from "@/features/event-scoring/game-launch.server";
import {
  createActivity,
  getOrCreateSettings,
  markParticipantCheckedIn,
  participantForTicket,
} from "@/features/event-scoring/store.server";
import { subscribeOfficialResultWake } from "@/features/game-results/outbox.server";
import {
  applyFamilyFeudControllerAction,
  pairFamilyFeudController,
} from "@/features/things/family-feud/family-feud-room.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("Family Feud team result claims", () => {
  let stopConsumer: (() => Promise<void>) | undefined;
  beforeAll(async () => {
    stopConsumer = subscribeOfficialResultWake(async (envelopes) => {
      for (const envelope of envelopes) await consumeOfficialGameResult(envelope);
    });
    await applySchema();
  });
  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into events (slug, title, status, starts_at, timezone)
       values ('feud-night', 'Feud Night', 'published', now(), 'Europe/London')`,
    );
    await query(
      `insert into ticket_types (event_slug, id, name, quantity)
       values ('feud-night', 'standard', 'Standard', 20)`,
    );
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id) values
       ('01ARZ3NDEKTSV4F01', 'feud-night', 'standard', 'One', 'ord_feud_1'),
       ('01ARZ3NDEKTSV4F02', 'feud-night', 'standard', 'Two', 'ord_feud_2'),
       ('01ARZ3NDEKTSV4F03', 'feud-night', 'standard', 'Three', 'ord_feud_3')`,
    );
  });
  afterAll(async () => {
    await stopConsumer?.();
    await closeDatabase();
  });

  it("caps each team, merges points durably, and permits only one team per attendee", async () => {
    const participants = await Promise.all(
      ["01ARZ3NDEKTSV4F01", "01ARZ3NDEKTSV4F02", "01ARZ3NDEKTSV4F03"].map((ticket) =>
        participantForTicket(ticket),
      ),
    );
    for (const participant of participants) await markParticipantCheckedIn(participant!.id);
    await getOrCreateSettings("feud-night");
    await query(`update event_scoring_settings set state = 'live' where event_slug = 'feud-night'`);
    const activity = await createActivity({
      eventSlug: "feud-night",
      name: "Family Feud final",
      template: "placement",
      status: "live",
      rule: {
        mode: "placement",
        placementPoints: { "1": 8, "2": 3 },
        repeat: "once-per-source",
        requiresCheckIn: false,
      },
    });
    const launched = await launchEventFamilyFeudGame({
      eventSlug: "feud-night",
      activityId: activity.id,
      rounds: 4,
      teams: [
        { name: "Circle", playerCount: 2 },
        { name: "Triangle", playerCount: 2 },
      ],
    });
    expect(launched.ok).toBe(true);
    if (!launched.ok) return;
    const paired = await pairFamilyFeudController({
      roomId: launched.value.roomId,
      pairingToken: launched.value.controllerPairingToken,
    });
    if (!paired.ok) throw new Error(paired.error);
    await applyFamilyFeudControllerAction({
      roomId: launched.value.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "score.adjust", teamId: "one", points: 1, actionId: "winner" },
    });
    await applyFamilyFeudControllerAction({
      roomId: launched.value.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "game.end", actionId: "end" },
    });
    await applyFamilyFeudControllerAction({
      roomId: launched.value.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "result.confirm", actionId: "confirm" },
    });
    await vi.waitFor(
      async () => {
        const rows = await query<{ count: number }>(
          `select count(*)::integer as count from official_game_results
            where game_kind = 'family-feud' and status = 'processed'`,
        );
        expect(rows[0]?.count).toBe(1);
      },
      { timeout: 2_000, interval: 20 },
    );

    const circle = await openGroupGameClaimSession({
      gameKind: "family-feud",
      gameInstanceId: launched.value.roomId,
      resultId: "game:1",
      groupKey: "one",
      groupName: "Circle",
      gamePlayerPrefix: "team:one:slot:",
      maximumClaims: 2,
    });
    expect(circle.ok).toBe(true);
    if (!circle.ok) return;
    expect(
      await readGroupGameClaimSession({ eventSlug: "feud-night", token: circle.value.token }),
    ).toMatchObject({ ok: true, value: { points: 8, claimed: 0, maximumClaims: 2 } });
    const firstClaim = await claimGroupGameResult({
      eventSlug: "feud-night",
      token: circle.value.token,
      targetParticipantId: participants[0]!.id,
    });
    expect(firstClaim).toMatchObject({
      ok: true,
      value: { pointsAwarded: 8, previousBalance: 0, balance: 8 },
    });
    expect(
      await claimGroupGameResult({
        eventSlug: "feud-night",
        token: circle.value.token,
        targetParticipantId: participants[0]!.id,
      }),
    ).toEqual(firstClaim);
    expect(
      await claimGroupGameResult({
        eventSlug: "feud-night",
        token: circle.value.token,
        targetParticipantId: participants[1]!.id,
      }),
    ).toMatchObject({ ok: true, value: { pointsAwarded: 8 } });
    expect(
      await claimGroupGameResult({
        eventSlug: "feud-night",
        token: circle.value.token,
        targetParticipantId: participants[2]!.id,
      }),
    ).toMatchObject({ ok: false, status: 409 });

    const triangle = await openGroupGameClaimSession({
      gameKind: "family-feud",
      gameInstanceId: launched.value.roomId,
      resultId: "game:1",
      groupKey: "two",
      groupName: "Triangle",
      gamePlayerPrefix: "team:two:slot:",
      maximumClaims: 2,
    });
    if (!triangle.ok) throw new Error(triangle.error);
    expect(
      await claimGroupGameResult({
        eventSlug: "feud-night",
        token: triangle.value.token,
        targetParticipantId: participants[0]!.id,
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await claimGroupGameResult({
        eventSlug: "feud-night",
        token: triangle.value.token,
        targetParticipantId: participants[2]!.id,
      }),
    ).toMatchObject({ ok: true, value: { pointsAwarded: 3, balance: 3 } });
  });
});
