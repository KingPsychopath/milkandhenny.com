import { createHash } from "node:crypto";

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { query } from "@/lib/platform/postgres.server";
import {
  acceptHeldScore,
  createActivity,
  createPool,
  createTeam,
  findSettings,
  getOrCreateSettings,
  listScoreNotifications,
  listPools,
  listScoreMediaLinks,
  listScoreAuditEvents,
  listScoreAnomalyFlags,
  listCheckedInTeamParticipants,
  listTeams,
  markParticipantCheckedIn,
  participantForTicket,
  recordScore,
  rebuildEventProjections,
  releaseActivityReservations,
  reverseScore,
  setTeamMembership,
  shuffleCheckedInTeams,
  updateParticipantPublicIdentity,
} from "@/features/event-scoring/store.server";
import { getEvent, putEvent } from "@/features/events/store.server";
import { markTicketStatus } from "@/features/tickets/store.server";
import {
  activateGameScoreBinding,
  consumeOfficialGameResult,
  createGameScoreBinding,
  ingestOfficialGameResult,
  linkGamePlayer,
  processOfficialGameResult,
  retryHeldOfficialGameResult,
} from "@/features/event-scoring/games.server";
import {
  claimDiscovery,
  copyDiscovery,
  createDiscovery,
  findDiscoveryForPresented,
  replaceDiscoveryClueSecret,
  updateDiscovery,
} from "@/features/event-scoring/discoveries.server";
import {
  buildDiscoveryPrintPack,
  buildEventPrintPack,
  inspectRenderedPrintPdf,
  renderDiscoveryPrintPdf,
} from "@/features/event-scoring/print.server";
import {
  adjustStaffPool,
  archiveEventStaffRole,
  assignEventStaffRole,
  createEventStaffRole,
  createStaffAccess,
  issueStaffPool,
  resolveStaffAccess,
  revokeStaffAccess,
  revokeStaffAccessDevice,
  staffAssignmentForPermission,
  updateEventStaffRoleScope,
} from "@/features/event-scoring/staff.server";
import { actionEmailHash } from "@/features/attendee-operations/action-links.server";
import { acceptAccessAction } from "@/features/attendee-operations/access-grants.server";
import {
  awardStaffPoints,
  getStaffScoringPage,
  mintStaffAwardClaim,
  setStaffGuestPhotos,
} from "@/features/event-scoring/staff-scoring.server";
import { updateEventOperationsPolicy } from "@/features/attendee-operations/capabilities.server";
import { getEventDropSchedule } from "@/features/events/drop.server";
import {
  claimStaffAward,
  getStaffAwardClaimPreview,
} from "@/features/event-scoring/staff-award-claims.server";
import { officialResultPayloadHash } from "@/features/game-results/outbox.server";
import { buildTicketQrPayload } from "@/features/tickets/qr.server";
import { redeemTicket } from "@/features/tickets/tickets.server";
import {
  closeOfflineScoreReservation,
  reconcileOfflineScoreCommands,
  reserveOfflineScoreBudget,
} from "@/features/event-scoring/offline.server";
import { pseudonymizeEventPerson } from "@/features/event-scoring/identity.server";
import {
  getScoringOperationsSnapshot,
  recordScoringOperationalEvent,
} from "@/features/event-scoring/operations.server";
import { confirmManagedEventGameResult } from "@/features/event-scoring/game-launch.server";
import {
  icebreakerEncounterPlayers,
  pitchesPlayersFromBallots,
} from "@/features/event-scoring/managed-game-results";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import {
  applyPenalty,
  adminParticipantScore,
  awardPoints,
  changeScoringState,
  configureScoring,
  createActivityFromPersonalTemplate,
  createScoringActivity,
  correctPointsAfterClose,
  finalizeLeaderboard,
  mergeParticipants,
  listPersonalActivityTemplates,
  processScheduledScoringTransitions,
  personalScore,
  publicLeaderboard,
  reverseParticipantMerge,
  savePersonalActivityTemplate,
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

  it("balances checked-in guests, reshuffles team counts, and places later arrivals", async () => {
    const ticketIds = [
      "01ARZ3NDEKTSV4RR",
      "01ARZ3NDEKTSV4T1",
      "01ARZ3NDEKTSV4T2",
      "01ARZ3NDEKTSV4T3",
      "01ARZ3NDEKTSV4T4",
      "01ARZ3NDEKTSV4T5",
      "01ARZ3NDEKTSV4T6",
    ];
    await query(
      `insert into tickets (id,event_slug,ticket_type_id,holder_name,order_id)
       select id,'scoring-night','standard','Guest ' || row_number() over (), 'team-order-' || id
         from unnest($1::text[]) as id
       on conflict (id) do nothing`,
      [ticketIds],
    );
    const participants = await Promise.all(
      ticketIds.map((ticketId) => participantForTicket(ticketId)),
    );
    expect(participants.every(Boolean)).toBe(true);
    for (const participant of participants.slice(0, 5)) {
      await markParticipantCheckedIn(participant!.id);
    }

    const threeTeams = await shuffleCheckedInTeams({
      eventSlug: "scoring-night",
      teamCount: 3,
      actorType: "admin",
      actorId: "admin-1",
    });
    expect(threeTeams.ok).toBe(true);
    expect((await listTeams("scoring-night")).filter((team) => team.status === "active")).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ colourKey: "amber" }),
        expect.objectContaining({ colourKey: "sage" }),
        expect.objectContaining({ colourKey: "plum" }),
      ]),
    );
    expect(
      (await listTeams("scoring-night"))
        .filter((team) => team.status === "active")
        .map((team) => team.checkedInCount)
        .sort(),
    ).toEqual([1, 2, 2]);
    expect(await listCheckedInTeamParticipants("scoring-night")).toHaveLength(5);

    expect(
      await redeemTicket({
        scanned: ticketIds[5]!,
        eventSlug: "scoring-night",
        redeemedBy: "admin",
      }),
    ).toMatchObject({ result: "admitted" });
    expect(
      (await listTeams("scoring-night"))
        .filter((team) => team.status === "active")
        .map((team) => team.checkedInCount)
        .sort(),
    ).toEqual([2, 2, 2]);
    expect((await participantForTicket(ticketIds[5]!))?.teamName).toBeTruthy();

    const twoTeams = await shuffleCheckedInTeams({
      eventSlug: "scoring-night",
      teamCount: 2,
      actorType: "admin",
      actorId: "admin-1",
    });
    expect(twoTeams.ok).toBe(true);
    const teams = await listTeams("scoring-night");
    expect(
      teams.filter((team) => team.status === "active").map((team) => team.checkedInCount),
    ).toEqual([3, 3]);
    expect(teams.filter((team) => team.status === "active").map((team) => team.colourKey)).toEqual([
      "amber",
      "sage",
    ]);
    expect(teams.filter((team) => team.status === "archived")).toHaveLength(1);
    expect(
      await shuffleCheckedInTeams({
        eventSlug: "scoring-night",
        teamCount: 5,
        actorType: "admin",
        actorId: "admin-1",
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("saves an activity as a personal template without linking later edits", async () => {
    const source = await createScoringActivity({
      eventSlug: "scoring-night",
      name: "House winner",
      template: "winner",
      rule: { mode: "fixed", fixedPoints: 7, repeat: "once", requiresCheckIn: true },
      status: "draft",
      actorId: "admin-1",
    });
    expect(source.ok).toBe(true);
    if (!source.ok) return;
    const saved = await savePersonalActivityTemplate({
      activityId: source.value.id,
      actorId: "admin-1",
    });
    expect(saved.ok && saved.value.rule.fixedPoints).toBe(7);
    expect(await listPersonalActivityTemplates("another-admin")).toEqual([]);
    const created = await createActivityFromPersonalTemplate({
      eventSlug: "scoring-night",
      templateId: saved.ok ? saved.value.id : "missing",
      actorId: "admin-1",
      name: "Final winner",
    });
    expect(created.ok && created.value).toMatchObject({
      name: "Final winner",
      status: "draft",
      rule: { fixedPoints: 7 },
    });
  });

  it("reports private scoring health and deterministic alert thresholds", async () => {
    await Promise.all(
      [1, 2, 3].map(() =>
        recordScoringOperationalEvent({
          eventSlug: "scoring-night",
          kind: "write-failure",
          operation: "integration-check",
        }),
      ),
    );
    const snapshot = await getScoringOperationsSnapshot("scoring-night");
    expect(snapshot).toMatchObject({ writeFailures: 3, projectionDrift: 0 });
    expect(snapshot.alerts).toContainEqual({
      code: "repeated-write-failure",
      severity: "critical",
      message: "3 score writes failed in 15 minutes.",
    });
  });

  it("validates Pitches ballots and Icebreaker encounters before official scoring", async () => {
    expect(
      pitchesPlayersFromBallots({
        candidateParticipantIds: ["one", "two"],
        ballots: [
          { voterParticipantId: "voter", candidateParticipantId: "one" },
          { voterParticipantId: "voter", candidateParticipantId: "two" },
        ],
      }),
    ).toMatchObject({ ok: false });
    expect(icebreakerEncounterPlayers(["same", "same"])).toMatchObject({ ok: false });

    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
       values ('01ARZ3NDEKTSV4R2', 'scoring-night', 'standard', 'Second', 'ord_second')`,
    );
    const first = await participantForTicket("01ARZ3NDEKTSV4RR");
    const second = await participantForTicket("01ARZ3NDEKTSV4R2");
    expect(first && second).toBeTruthy();
    if (!first || !second) return;
    await markParticipantCheckedIn(first.id);
    await markParticipantCheckedIn(second.id);
    await getOrCreateSettings("scoring-night");
    await changeScoringState({ eventSlug: "scoring-night", state: "ready", actorId: "admin" });
    await changeScoringState({ eventSlug: "scoring-night", state: "live", actorId: "admin" });
    const activity = await createScoringActivity({
      eventSlug: "scoring-night",
      name: "Meet somebody",
      template: "completion",
      rule: { mode: "fixed", fixedPoints: 2, repeat: "once", requiresCheckIn: true },
      status: "live",
      actorId: "admin",
    });
    expect(activity.ok).toBe(true);
    if (!activity.ok) return;
    const result = await confirmManagedEventGameResult({
      kind: "icebreaker",
      eventSlug: "scoring-night",
      activityId: activity.value.id,
      gameInstanceId: "icebreaker-night",
      resultId: "encounter-one",
      participantIds: [first.id, second.id],
    });
    expect(result.ok).toBe(true);
    const repeated = await confirmManagedEventGameResult({
      kind: "icebreaker",
      eventSlug: "scoring-night",
      activityId: activity.value.id,
      gameInstanceId: "icebreaker-night",
      resultId: "encounter-one",
      participantIds: [first.id, second.id],
    });
    expect(repeated.ok).toBe(true);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(2);
    expect((await participantForTicket("01ARZ3NDEKTSV4R2"))?.balance).toBe(2);
  });

  it("keeps public display choices separate from participant and score identity", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    expect(participant).toBeTruthy();
    expect(
      await updateParticipantPublicIdentity({
        eventSlug: "scoring-night",
        participantId: participant!.id,
        displayMode: "alias",
        publicAlias: "Night Owl",
      }),
    ).toMatchObject({ ok: true, value: { publicAlias: "Night Owl", displayMode: "alias" } });
    expect(
      await updateParticipantPublicIdentity({
        eventSlug: "scoring-night",
        participantId: participant!.id,
        displayMode: "hidden",
      }),
    ).toMatchObject({ ok: true, value: { publicAlias: "Night Owl", displayMode: "hidden" } });
    expect(
      await updateParticipantPublicIdentity({
        eventSlug: "scoring-night",
        participantId: participant!.id,
        displayMode: "alias",
        publicAlias: null,
      }),
    ).toMatchObject({
      ok: true,
      value: { publicAlias: participant!.generatedAlias, displayMode: "alias" },
    });
    expect(
      await updateParticipantPublicIdentity({
        eventSlug: "scoring-night",
        participantId: participant!.id,
        displayMode: "alias",
        publicAlias: "guest-deadbeef",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.id).toBe(participant!.id);
  });

  it("applies the configured public-name policy without changing participant identity", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    expect(participant).toBeTruthy();
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings
          set state = 'live', leaderboard_visibility = 'public-live'
        where event_slug = 'scoring-night'`,
    );
    await updateParticipantPublicIdentity({
      eventSlug: "scoring-night",
      participantId: participant!.id,
      displayMode: "alias",
      publicAlias: "Night Owl",
    });
    const alice = "0198e9d8-53d7-7db3-8ca5-e337796bc432";
    await query(`insert into event_people (id, canonical_name) values ($1,'Alice Smith')`, [alice]);
    await query(`update event_participants set person_id = $2 where id = $1`, [
      participant!.id,
      alice,
    ]);

    const generated = await publicLeaderboard({ eventSlug: "scoring-night" });
    expect(generated.ok && generated.value.rows[0]?.publicAlias).toBe(participant!.generatedAlias);
    await query(
      `update event_scoring_settings set public_names = 'choice' where event_slug = 'scoring-night'`,
    );
    const chosen = await publicLeaderboard({ eventSlug: "scoring-night" });
    expect(chosen.ok && chosen.value.rows[0]?.publicAlias).toBe("Night Owl");
    await query(
      `update event_scoring_settings set public_names = 'canonical' where event_slug = 'scoring-night'`,
    );
    const canonical = await publicLeaderboard({ eventSlug: "scoring-night" });
    expect(canonical.ok && canonical.value.rows[0]?.publicAlias).toBe("Alice Smith");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.id).toBe(participant!.id);
  });

  it("exposes one ledger as private history and a privacy-safe public breakdown", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    expect(participant).toBeTruthy();
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings
          set state = 'live', leaderboard_visibility = 'public-live'
        where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Best dancer",
      template: "participation",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 5, repeat: "once", requiresCheckIn: false },
    });
    expect(
      (
        await recordScore({
          eventSlug: "scoring-night",
          activityId: activity.id,
          sourceType: "manual",
          sourceId: "dance-floor",
          idempotencyKey: "dance-floor-winner",
          reasonCode: "other",
          actorType: "admin",
          postings: [{ participantId: participant!.id, points: 5 }],
        })
      ).ok,
    ).toBe(true);

    const own = await personalScore({
      eventSlug: "scoring-night",
      ticketId: "01ARZ3NDEKTSV4RR",
    });
    expect(own.ok && own.value.transactions[0]).toMatchObject({
      activityName: "Best dancer",
      sourceType: "manual",
      points: 5,
    });

    const admin = await adminParticipantScore({
      eventSlug: "scoring-night",
      participantId: participant!.id,
    });
    expect(admin.ok && admin.value.transactions[0]?.activityName).toBe("Best dancer");

    const publicBoard = await publicLeaderboard({ eventSlug: "scoring-night" });
    expect(publicBoard.ok && publicBoard.value.rows[0]?.breakdown).toEqual([
      { label: "Best dancer", points: 5 },
    ]);
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

  it("pseudonymizes personal identity without changing immutable scoring", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const privatePerson = "0198e9d8-53d7-7db4-bfc9-22d87bc11f08";
    await query(`insert into event_people (id,canonical_name) values ($1,'Private Name')`, [
      privatePerson,
    ]);
    await query(
      `insert into event_person_identifiers (person_id,kind,value_hash,verified_at)
       values ($1,'email',$2,now())`,
      [privatePerson, "a".repeat(64)],
    );
    await query(`update event_participants set person_id = $2 where id = $1`, [
      participant!.id,
      privatePerson,
    ]);
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Privacy score",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 4, repeat: "repeat", requiresCheckIn: false },
    });
    expect(
      await awardPoints({
        eventSlug: "scoring-night",
        activityId: activity.id,
        participantIds: [participant!.id],
        idempotencyKey: "privacy-award",
        actorType: "admin",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await pseudonymizeEventPerson({
        eventSlug: "scoring-night",
        personId: privatePerson,
        actorId: "admin-test",
        reason: "Verified privacy request",
      }),
    ).toMatchObject({ ok: true, value: { participants: 1 } });
    expect(await participantForTicket("01ARZ3NDEKTSV4RR")).toMatchObject({
      id: participant!.id,
      balance: 4,
      displayMode: "anonymous",
      publicAlias: expect.stringMatching(/^removed-/),
    });
    expect(
      await query(`select id from event_person_identifiers where person_id = $1`, [privatePerson]),
    ).toEqual([]);
    expect(
      await query<{ count: string }>(
        `select count(*)::text as count from score_transactions where idempotency_key = 'privacy-award'`,
      ),
    ).toEqual([{ count: "1" }]);
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
    const event = await getEvent("scoring-night");
    if (!event) throw new Error("event missing");
    await putEvent({ ...event, slug: "renamed-scoring-night" }, { renameFrom: event.slug });
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
    expect(await participantForTicket("01ARZ3NDEKTSV4RR")).toMatchObject({ teamName: "Amber" });
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
      `update event_scoring_settings
          set state = 'frozen', allow_precheckin_online_points = true
        where event_slug = 'scoring-night'`,
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
    // Simulate a worker stopping after ingestion and seeing the durable envelope again.
    expect(await consumeOfficialGameResult(envelope)).toBe(true);
    expect(
      (
        await query<{ status: string }>(`select status from official_game_results where id = $1`, [
          resultId,
        ])
      )[0]?.status,
    ).toBe("held");
    expect(
      await changeScoringState({
        eventSlug: "scoring-night",
        state: "live",
        actorId: "admin-1",
      }),
    ).toMatchObject({ ok: true, value: { state: "live" } });
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

    const reopened = await ingestOfficialGameResult(
      centreEnvelope({ channelId, revision: 5, placement: 1 }),
    );
    expect(reopened.ok).toBe(true);
    expect(
      (await processOfficialGameResult(reopened.ok ? reopened.value.id : "missing")).state,
    ).toBe("corrected");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
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
      { revision: 5, status: "corrected", points: "7", has_reversal: false },
    ]);

    const conflicting = await ingestOfficialGameResult(
      centreEnvelope({ channelId, revision: 1, placement: 2 }),
    );
    expect(conflicting).toMatchObject({ ok: false, status: 409, retryable: false });
    expect(
      (
        await query<{ status: string }>(
          `select status from official_game_results
            where channel_id = $1 and result_id = 'final' and revision = 1`,
          [channelId],
        )
      )[0]?.status,
    ).toBe("processed");

    const early = await ingestOfficialGameResult(centreEnvelope({ channelId, revision: 9 }));
    expect(early).toMatchObject({ ok: false, status: 409, retryable: true });

    const stale = await retryHeldOfficialGameResult(
      invalidCorrection.ok ? invalidCorrection.value.id : "missing",
    );
    expect(stale.state).toBe("ignored");
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
  });

  it.each(["manual", "scheduled"] as const)(
    "retries a ready-state official result when scoring becomes live via %s transition",
    async (transition) => {
      const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
      const activity = await createActivity({
        eventSlug: "scoring-night",
        name: "Ready result",
        template: "winner",
        status: "live",
        rule: {
          mode: "placement",
          placementPoints: { "1": 7 },
          repeat: "once-per-source",
          requiresCheckIn: false,
        },
      });
      await getOrCreateSettings("scoring-night");
      await query(
        `update event_scoring_settings
            set state = 'ready', allow_precheckin_online_points = true
          where event_slug = 'scoring-night'`,
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
      expect(
        await linkGamePlayer({
          channelId,
          gamePlayerId: "player-1",
          participantId: participant!.id,
        }),
      ).toEqual({ ok: true });
      const ingested = await ingestOfficialGameResult(centreEnvelope({ channelId, revision: 1 }));
      expect(ingested.ok).toBe(true);
      expect(
        await processOfficialGameResult(ingested.ok ? ingested.value.id : "missing"),
      ).toMatchObject({ state: "held", reason: "Scoring is ready" });

      if (transition === "manual") {
        expect(
          await changeScoringState({
            eventSlug: "scoring-night",
            state: "live",
            actorId: "admin-1",
          }),
        ).toMatchObject({ ok: true, value: { state: "live" } });
      } else {
        await query(
          `update event_scoring_settings set scheduled_start = now() - interval '1 minute'
            where event_slug = 'scoring-night'`,
        );
        expect(await processScheduledScoringTransitions()).toBe(1);
      }

      expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
      expect(
        (
          await query<{ status: string }>(
            `select status from official_game_results where id = $1`,
            [ingested.ok ? ingested.value.id : "missing"],
          )
        )[0]?.status,
      ).toBe("processed");
    },
  );

  it("ignores unidentified official players without creating leaderboard participants", async () => {
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
    expect(await processOfficialGameResult(ingested.ok ? ingested.value.id : "missing")).toEqual({
      state: "ignored",
      resultId: ingested.ok ? ingested.value.id : "missing",
    });
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from event_participants where event_slug = 'scoring-night'`,
        )
      )[0]?.count,
    ).toBe("1");
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from event_game_player_links where channel_id = $1`,
          [channelId],
        )
      )[0]?.count,
    ).toBe("0");
    expect(
      (
        await query<{ status: string; transaction_id: string | null }>(
          `select status, transaction_id from score_game_receipts where official_result_id = $1`,
          [ingested.ok ? ingested.value.id : "missing"],
        )
      )[0],
    ).toEqual({ status: "ignored", transaction_id: null });
  });

  it("settles collected clues and the completion bonus exactly once", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Collect them all",
      template: "discovery",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 1, repeat: "repeat", requiresCheckIn: false },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const created = await createDiscovery({
      eventSlug: "scoring-night",
      activityId: activity.id,
      name: "Two hidden clues",
      method: "collected-clues",
      status: "live",
      rule: {
        pointMode: "per-clue-plus-completion",
        pointsPerClue: 2,
        completionBonus: 5,
        claimFrequency: "once",
        requiresCheckIn: false,
        remainderAward: "discard",
      },
      clues: [
        { key: "amber-door", label: "Amber door" },
        { key: "stone-step", label: "Stone step" },
      ],
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    const firstToken = created.value.clues?.[0]?.claimToken ?? "missing";
    expect(await findDiscoveryForPresented("scoring-night", firstToken)).toMatchObject({
      id: created.value.id,
    });
    const originalSecondToken = created.value.clues?.[1]?.claimToken ?? "missing";
    const replacement = await replaceDiscoveryClueSecret({
      eventSlug: "scoring-night",
      discoveryId: created.value.id,
      clueKey: "stone-step",
      actorId: "admin-1",
    });
    expect(replacement.ok).toBe(true);
    const secondToken = replacement.ok ? replacement.value.claimToken : "missing";
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant!.id,
        presented: originalSecondToken,
        commandId: "discovery-old-replaced-clue",
      }),
    ).toMatchObject({ ok: false, status: 400 });
    const printPack = await buildDiscoveryPrintPack({
      eventSlug: "scoring-night",
      layout: "two-per-page",
      discoveryIds: [created.value.id],
    });
    expect(printPack.ok && printPack.pack.items).toHaveLength(2);
    expect(printPack.ok && Object.keys(printPack.qrDataUrls)).toHaveLength(2);
    if (!printPack.ok) return;
    const pdf = await renderDiscoveryPrintPdf(printPack);
    expect(inspectRenderedPrintPdf(pdf)).toEqual({
      pageSizes: [[595.28, 841.89]],
      qrDestinations: printPack.pack.items.map((item) => item.destination),
      embeddedFontCount: 3,
    });
    for (const item of printPack.pack.items) {
      expect(pdf.toString("latin1")).toContain(`(${item.fallbackCode})`);
    }
    const smallCardPdf = await renderDiscoveryPrintPdf({
      ...printPack,
      pack: { ...printPack.pack, layout: "twelve-small" },
    });
    for (const item of printPack.pack.items) {
      expect(smallCardPdf.toString("latin1")).toContain(`(${item.fallbackCode})`);
    }
    for (const [paper, dimensions] of Object.entries({
      a4: [595.28, 841.89],
      letter: [612, 792],
      a5: [419.53, 595.28],
      card: [288, 432],
    }) as Array<["a4" | "letter" | "a5" | "card", [number, number]]>) {
      const pack = await buildEventPrintPack({
        eventSlug: "scoring-night",
        kind: "leaderboard",
        layout: "full-page",
        paper,
      });
      expect(pack.ok).toBe(true);
      if (!pack.ok) continue;
      expect(inspectRenderedPrintPdf(await renderDiscoveryPrintPdf(pack)).pageSizes).toEqual([
        dimensions,
      ]);
    }
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant!.id,
        presented: firstToken,
        commandId: "discovery-command-one",
      }),
    ).toEqual({
      ok: true,
      value: {
        state: "accepted",
        points: 2,
        transaction: expect.any(String),
        progress: { claimed: 1, total: 2, complete: false },
      },
    });
    const finalClaims = await Promise.all([
      claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant!.id,
        presented: secondToken,
        commandId: "discovery-command-two-a",
      }),
      claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant!.id,
        presented: secondToken,
        commandId: "discovery-command-two-b",
      }),
    ]);
    expect(finalClaims.every((result) => result.ok && result.value.points === 7)).toBe(true);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(9);
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from score_discovery_claims
            where discovery_id = $1 and participant_id = $2`,
          [created.value.id, participant!.id],
        )
      )[0]?.count,
    ).toBe("2");
  });

  it("runs a points-free hunt without scoring settings or a score activity", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const created = await createDiscovery({
      eventSlug: "scoring-night",
      name: "Find the amber door",
      method: "code",
      status: "live",
      rule: {
        pointMode: "none",
        claimFrequency: "once",
        requiresCheckIn: false,
        remainderAward: "discard",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    expect(created.value.activityId).toBeUndefined();
    expect(await findSettings("scoring-night")).toBeNull();
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant!.id,
        presented: created.value.code ?? "missing",
        commandId: "points-free-discovery-claim",
      }),
    ).toMatchObject({ ok: true, value: { state: "accepted", points: 0 } });
    expect(await findSettings("scoring-night")).toBeNull();
  });

  it("enforces repeatable discovery cooldowns, idempotency, limits, and fixed pools", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Repeatable station",
      template: "discovery",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 3, repeat: "once", requiresCheckIn: false },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const created = await createDiscovery({
      eventSlug: "scoring-night",
      activityId: activity.id,
      name: "Three-shot station",
      method: "qr",
      status: "live",
      rule: {
        pointMode: "fixed-pool",
        pointsPerClue: 3,
        poolPoints: 9,
        claimFrequency: "cooldown",
        cooldownSeconds: 60,
        maximumClaimsPerParticipant: 3,
        requiresCheckIn: false,
        remainderAward: "discard",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok || !participant) return;
    const presented = created.value.claimToken ?? "missing";
    const first = await claimDiscovery({
      discoveryId: created.value.id,
      participantId: participant.id,
      presented,
      commandId: "repeatable-discovery-one",
    });
    expect(first).toMatchObject({
      ok: true,
      value: { state: "accepted", points: 3, retryAfterSeconds: 60 },
    });
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant.id,
        presented,
        commandId: "repeatable-discovery-one",
      }),
    ).toEqual(first);
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant.id,
        presented,
        commandId: "repeatable-discovery-too-soon",
      }),
    ).toMatchObject({ ok: false, status: 429, retryAfterSeconds: expect.any(Number) });

    await query(
      `update score_discovery_claims
          set created_at = now() - interval '61 seconds'
        where discovery_id = $1`,
      [created.value.id],
    );
    const concurrent = await Promise.all([
      claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant.id,
        presented,
        commandId: "repeatable-discovery-two-a",
      }),
      claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant.id,
        presented,
        commandId: "repeatable-discovery-two-b",
      }),
    ]);
    expect(concurrent.filter((result) => result.ok)).toHaveLength(1);
    expect(concurrent.filter((result) => !result.ok && result.status === 429)).toHaveLength(1);

    await query(
      `update score_discovery_claims
          set created_at = now() - interval '61 seconds'
        where discovery_id = $1`,
      [created.value.id],
    );
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant.id,
        presented,
        commandId: "repeatable-discovery-three",
      }),
    ).toMatchObject({ ok: true, value: { points: 3 } });
    expect(
      await claimDiscovery({
        discoveryId: created.value.id,
        participantId: participant.id,
        presented,
        commandId: "repeatable-discovery-four",
      }),
    ).toMatchObject({ ok: false, status: 409, error: expect.stringContaining("claim limit") });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(9);
    expect(
      (
        await query<{ count: string; points: string }>(
          `select count(*)::text as count, sum(points)::text as points
             from score_discovery_claims
            where discovery_id = $1 and state = 'accepted'`,
          [created.value.id],
        )
      )[0],
    ).toEqual({ count: "3", points: "9" });
  });

  it("enforces activity check-in and repeat rules inside the score transaction", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Checked-in winner",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 4, repeat: "once", requiresCheckIn: true },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const award = (command: string) =>
      awardPoints({
        eventSlug: "scoring-night",
        activityId: activity.id,
        participantIds: [participant!.id],
        idempotencyKey: command,
        sourceId: command,
        actorType: "admin",
        actorId: "admin-1",
      });
    expect(await award("checked-award-one")).toMatchObject({ ok: false, status: 409 });
    await markParticipantCheckedIn(participant!.id, new Date());
    const accepted = await award("checked-award-one");
    expect(accepted).toMatchObject({ ok: true, value: { status: "accepted" } });
    expect(await award("checked-award-one")).toEqual(accepted);
    expect(await award("checked-award-two")).toMatchObject({ ok: false, status: 409 });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(4);
    const cancelledActivity = await createActivity({
      eventSlug: "scoring-night",
      name: "Cancelled event award",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 1, repeat: "repeat", requiresCheckIn: false },
    });
    await query(`update events set status = 'cancelled' where slug = 'scoring-night'`);
    expect(
      await awardPoints({
        eventSlug: "scoring-night",
        activityId: cancelledActivity.id,
        participantIds: [participant!.id],
        idempotencyKey: "cancelled-event-award",
        actorType: "admin",
      }),
    ).toMatchObject({ ok: false, status: 409 });
  });

  it("revokes one staff device without revoking the assignment", async () => {
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Points table",
      assignmentType: "station",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "integration test",
      overrides: { transferPoints: true },
    });
    expect(access.permissions.awardPoints).toBe(true);
    expect(access.permissions.transferPoints).toBe(true);
    expect(
      await resolveStaffAccess({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "device-one",
      }),
    ).toMatchObject({ id: access.id });
    expect(
      await revokeStaffAccessDevice({
        eventSlug: "scoring-night",
        assignmentId: access.id,
        deviceId: "device-one",
        actorId: "admin-test",
        reason: "test device cleanup",
      }),
    ).toBe(true);
    expect(
      await resolveStaffAccess({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "device-one",
      }),
    ).toBeNull();
    expect(
      await resolveStaffAccess({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "device-two",
      }),
    ).toMatchObject({ id: access.id });
    await revokeStaffAccess({
      eventSlug: "scoring-night",
      assignmentId: access.id,
      actorId: "admin-test",
      reason: "test cleanup",
    });
    expect(
      await resolveStaffAccess({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "device-two",
      }),
    ).toBeNull();
  });

  it("assigns reusable roles to many identities and keeps composite scopes narrow", async () => {
    const people = [
      ["0198e9d8-53d7-7db5-8ca5-e337796bc433", "Alex", "alex@example.com"],
      ["0198e9d8-53d7-7db6-8ca5-e337796bc434", "Sam", "sam@example.com"],
    ] as const;
    for (const [personId, name, email] of people) {
      await query(`insert into event_people (id,canonical_name) values ($1,$2)`, [personId, name]);
      await query(
        `insert into event_person_identifiers
           (person_id,kind,value_hash,display_hint,email_address,verified_at)
         values ($1,'email',$2,$3,$4,now())`,
        [personId, actionEmailHash(email), `${email[0]}•••@example.com`, email],
      );
    }
    await query(
      `insert into checkpoints (event_slug,id,name,default_allowance,allowances,multi_scan,position)
       values ('scoring-night','food','Food',1,'{}'::jsonb,true,0)`,
    );
    const door = await createEventStaffRole({
      eventSlug: "scoring-night",
      label: "Door",
      preset: "door-scanner",
      actorId: "admin-test",
      reason: "role composition test",
    });
    const food = await createEventStaffRole({
      eventSlug: "scoring-night",
      label: "Food",
      preset: "checkpoint-scanner",
      scope: { checkpointIds: ["food"] },
      actorId: "admin-test",
      reason: "role composition test",
    });
    const alexDoor = await assignEventStaffRole({
      eventSlug: "scoring-night",
      roleId: door.id,
      delivery: "direct",
      recipientEmail: "alex@example.com",
      actorId: "admin-test",
      reason: "Alex is on entry",
    });
    const alexFood = await assignEventStaffRole({
      eventSlug: "scoring-night",
      roleId: food.id,
      delivery: "direct",
      recipientEmail: "alex@example.com",
      actorId: "admin-test",
      reason: "Alex covers food too",
    });
    await assignEventStaffRole({
      eventSlug: "scoring-night",
      roleId: food.id,
      delivery: "direct",
      recipientEmail: "sam@example.com",
      actorId: "admin-test",
      reason: "Sam is on food",
    });

    const access = { ...alexDoor, assignments: [alexDoor, alexFood] };
    expect(staffAssignmentForPermission(access, "admitTickets")?.id).toBe(alexDoor.id);
    expect(
      staffAssignmentForPermission(
        access,
        "scanCheckpoints",
        (assignment) =>
          !Array.isArray(assignment.scope.checkpointIds) ||
          assignment.scope.checkpointIds.includes("food"),
      )?.id,
    ).toBe(alexFood.id);
    expect(
      staffAssignmentForPermission(
        access,
        "scanCheckpoints",
        (assignment) =>
          !Array.isArray(assignment.scope.checkpointIds) ||
          assignment.scope.checkpointIds.includes("merch"),
      ),
    ).toBeNull();
    await expect(
      assignEventStaffRole({
        eventSlug: "scoring-night",
        roleId: food.id,
        delivery: "direct",
        recipientEmail: "alex@example.com",
        actorId: "admin-test",
        reason: "duplicate must fail",
      }),
    ).rejects.toThrow();
    const counts = await query<{ role_id: string; count: string }>(
      `select role_id,count(*)::text as count from score_staff_assignments
        where status = 'active' group by role_id order by role_id`,
    );
    expect(counts.find((entry) => entry.role_id === door.id)?.count).toBe("1");
    expect(counts.find((entry) => entry.role_id === food.id)?.count).toBe("2");
  });

  it("archives obsolete roles while revoking their active access", async () => {
    const role = await createEventStaffRole({
      eventSlug: "scoring-night",
      label: "Temporary marshal",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "temporary role test",
    });
    const station = await assignEventStaffRole({
      eventSlug: "scoring-night",
      roleId: role.id,
      delivery: "station",
      actorId: "admin-test",
      reason: "temporary station test",
    });

    await expect(
      archiveEventStaffRole({
        eventSlug: "scoring-night",
        roleId: role.id,
        actorId: "admin-test",
        reason: "temporary staffing is finished",
      }),
    ).resolves.toEqual({ roleId: role.id, revokedAssignments: 1 });
    await expect(
      resolveStaffAccess({ eventSlug: "scoring-night", token: station.token! }),
    ).resolves.toBeNull();
    await expect(
      assignEventStaffRole({
        eventSlug: "scoring-night",
        roleId: role.id,
        delivery: "station",
        actorId: "admin-test",
        reason: "archived role must stay unavailable",
      }),
    ).rejects.toThrow("unavailable or expired");
    await expect(
      archiveEventStaffRole({
        eventSlug: "scoring-night",
        roleId: role.id,
        actorId: "admin-test",
        reason: "second retirement attempt",
      }),
    ).resolves.toBeNull();

    const [storedRole] = await query<{ status: string }>(
      `select status from event_staff_roles where id = $1`,
      [role.id],
    );
    const [storedAssignment] = await query<{ status: string; invitation_state: string }>(
      `select status,invitation_state from score_staff_assignments where id = $1`,
      [station.id],
    );
    expect(storedRole?.status).toBe("archived");
    expect(storedAssignment).toEqual({ status: "revoked", invitation_state: "active" });
  });

  it("updates a role scope and every active assignment without replacing its link", async () => {
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Late award",
      template: "participation",
      status: "live",
      rule: {
        mode: "participation",
        repeat: "once",
        participationPoints: 3,
        requiresCheckIn: true,
      },
    });
    const role = await createEventStaffRole({
      eventSlug: "scoring-night",
      label: "Scope marshal",
      preset: "points-marshal",
      scope: { activityIds: [] },
      actorId: "admin-test",
      reason: "scope update test",
    });
    const station = await assignEventStaffRole({
      eventSlug: "scoring-night",
      roleId: role.id,
      delivery: "station",
      actorId: "admin-test",
      reason: "scope update station",
    });

    await expect(
      updateEventStaffRoleScope({
        eventSlug: "scoring-night",
        roleId: role.id,
        scope: { activityIds: [activity.id] },
        actorId: "admin-test",
        reason: "include the late award",
      }),
    ).resolves.toMatchObject({ updatedAssignments: 1 });

    const resolved = await resolveStaffAccess({
      eventSlug: "scoring-night",
      token: station.token!,
    });
    expect(resolved?.scope.activityIds).toEqual([activity.id]);

    await updateEventStaffRoleScope({
      eventSlug: "scoring-night",
      roleId: role.id,
      scope: { activityIds: [] },
      actorId: "admin-test",
      reason: "all live activities",
    });
    const page = await getStaffScoringPage({
      eventSlug: "scoring-night",
      token: station.token!,
      deviceId: "scope-update-device",
    });
    expect(page.found && page.activities.some((entry) => entry.id === activity.id)).toBe(true);
  });

  it("lets an authorised event lead schedule, cancel, and open the shared album", async () => {
    await updateEventOperationsPolicy({
      eventSlug: "scoring-night",
      capabilities: { guestPhotos: true },
      actorId: "admin-test",
      actorType: "admin",
      reason: "prepare the event album",
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Event lead",
      assignmentType: "station",
      preset: "event-manager",
      actorId: "admin-test",
      reason: "event lead photo controls",
    });
    const opensAt = new Date(Date.now() + 60_000).toISOString();

    const scheduled = await setStaffGuestPhotos({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "event-lead-device",
      enabled: true,
      opensAt,
    });
    expect(scheduled).toMatchObject({
      ok: true,
      value: { schedule: { opensAt } },
    });
    expect(
      await getStaffScoringPage({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "event-lead-device",
      }),
    ).toMatchObject({ found: true, mediaSchedule: { opensAt } });

    await expect(
      setStaffGuestPhotos({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "event-lead-device",
        enabled: false,
      }),
    ).resolves.toMatchObject({
      ok: true,
      value: { schedule: { cancelledAt: expect.any(String) } },
    });
    expect((await getEventDropSchedule("scoring-night"))?.cancelledAt).toBeDefined();

    await expect(
      setStaffGuestPhotos({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "event-lead-device",
        enabled: true,
      }),
    ).resolves.toMatchObject({ ok: true, value: { drop: { live: true, available: true } } });
  });

  it("does not let a copied staff invitation prove ownership of an email", async () => {
    const role = await createEventStaffRole({
      eventSlug: "scoring-night",
      label: "Copied invite",
      preset: "door-scanner",
      actorId: "admin-test",
      reason: "copied invite test",
    });
    const invitation = await assignEventStaffRole({
      eventSlug: "scoring-night",
      roleId: role.id,
      delivery: "copy",
      recipientEmail: "invited@example.com",
      actorId: "admin-test",
      reason: "copied invite test",
      origin: "https://example.test",
    });
    expect(invitation.token).toBeTruthy();
    expect(await acceptAccessAction(invitation.token!)).toMatchObject({ ok: false, status: 401 });
    const rows = await query<{ invitation_state: string; consumed_at: Date | null }>(
      `select assignments.invitation_state,links.consumed_at
         from score_staff_assignments assignments
         join attendee_action_links links on links.id = assignments.invitation_link_id
        where assignments.id = $1`,
      [invitation.id],
    );
    expect(rows[0]).toEqual({ invitation_state: "pending", consumed_at: null });
  });

  it("enforces staff activity scope and a shared pool during concurrent awards", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Quick winner",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 4, repeat: "repeat", requiresCheckIn: false },
    });
    const other = await createActivity({
      eventSlug: "scoring-night",
      name: "Other table",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 1, repeat: "repeat", requiresCheckIn: false },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Winner table",
      assignmentType: "station",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id], largeAwardWarningAt: 10 },
    });
    const pool = await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 5,
    });
    expect(pool.ok).toBe(true);
    const page = await getStaffScoringPage({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "station-device",
    });
    expect(page).toMatchObject({ found: true, activities: [{ id: activity.id }] });
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const base = {
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "station-device",
      activityId: activity.id,
      participantId: participant!.id,
    };
    const outcomes = await Promise.all([
      awardStaffPoints({ ...base, commandId: "staff-command-one" }),
      awardStaffPoints({ ...base, commandId: "staff-command-two" }),
    ]);
    expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(4);
    expect(
      await awardStaffPoints({ ...base, activityId: other.id, commandId: "staff-other" }),
    ).toMatchObject({ ok: false, status: 403 });
  });

  it("lets exactly one attendee claim an expiring staff award QR", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
       values ('01ARZ3NDEKTSV4R3', 'scoring-night', 'standard', 'Second guest', 'ord_second')`,
    );
    const first = await participantForTicket("01ARZ3NDEKTSV4RR");
    const second = await participantForTicket("01ARZ3NDEKTSV4R3");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Quick thanks",
      template: "participation",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 3, repeat: "repeat", requiresCheckIn: false },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Quick award marshal",
      assignmentType: "station",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id] },
    });
    await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 10,
    });
    const minted = await mintStaffAwardClaim({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "qr-device",
      activityId: activity.id,
      expiresInSeconds: 60,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok || !first || !second) return;

    const results = await Promise.all([
      claimStaffAward({
        eventSlug: "scoring-night",
        token: minted.value.token,
        participantId: first.id,
      }),
      claimStaffAward({
        eventSlug: "scoring-night",
        token: minted.value.token,
        participantId: second.id,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(
      (await participantForTicket("01ARZ3NDEKTSV4RR"))!.balance +
        (await participantForTicket("01ARZ3NDEKTSV4R3"))!.balance,
    ).toBe(3);

    const replayable = await mintStaffAwardClaim({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "qr-device",
      activityId: activity.id,
      expiresInSeconds: 60,
    });
    expect(replayable.ok).toBe(true);
    if (!replayable.ok) return;
    const confirmed = await claimStaffAward({
      eventSlug: "scoring-night",
      token: replayable.value.token,
      participantId: first.id,
    });
    const recovered = await claimStaffAward({
      eventSlug: "scoring-night",
      token: replayable.value.token,
      participantId: first.id,
    });
    expect(confirmed).toMatchObject({ ok: true, value: { points: 3 } });
    expect(recovered).toMatchObject({ ok: true, value: { points: 3 } });
    if (confirmed.ok && recovered.ok) {
      expect(recovered.value.transaction.id).toBe(confirmed.value.transaction.id);
    }
    expect(
      (await participantForTicket("01ARZ3NDEKTSV4RR"))!.balance +
        (await participantForTicket("01ARZ3NDEKTSV4R3"))!.balance,
    ).toBe(6);

    const expired = await mintStaffAwardClaim({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "qr-device",
      activityId: activity.id,
      expiresInSeconds: 60,
    });
    expect(expired.ok).toBe(true);
    if (!expired.ok) return;
    const expiredTokenHash = createHash("sha256").update(expired.value.token).digest("hex");
    await query(
      `update score_staff_award_claims set expires_at = now() - interval '1 second'
        where token_hash = $1`,
      [expiredTokenHash],
    );
    expect(
      await claimStaffAward({
        eventSlug: "scoring-night",
        token: expired.value.token,
        participantId: first.id,
      }),
    ).toMatchObject({ ok: false, status: 410 });
  });

  it("keeps a physical quick award available until the attendee checks in", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Door-side thanks",
      template: "scan-to-award",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 3, repeat: "repeat", requiresCheckIn: true },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Door-side marshal",
      assignmentType: "station",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id] },
    });
    await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 10,
    });
    const minted = await mintStaffAwardClaim({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "precheck-qr-device",
      activityId: activity.id,
      expiresInSeconds: 60,
    });
    expect(minted.ok).toBe(true);
    if (!minted.ok || !participant) return;

    expect(await getStaffAwardClaimPreview("scoring-night", minted.value.token)).toMatchObject({
      requiresCheckIn: true,
      state: "active",
    });
    expect(
      await claimStaffAward({
        eventSlug: "scoring-night",
        token: minted.value.token,
        participantId: participant.id,
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(await getStaffAwardClaimPreview("scoring-night", minted.value.token)).toMatchObject({
      state: "active",
    });

    await markParticipantCheckedIn(participant.id);
    expect(
      await claimStaffAward({
        eventSlug: "scoring-night",
        token: minted.value.token,
        participantId: participant.id,
      }),
    ).toMatchObject({ ok: true, value: { points: 3 } });
  });

  it("awards every active ticket in a selected multi-ticket order atomically", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
       values ('01ARZ3NDEKTSV4R4', 'scoring-night', 'standard', 'Order guest', 'ord_test')`,
    );
    const first = await participantForTicket("01ARZ3NDEKTSV4RR");
    await participantForTicket("01ARZ3NDEKTSV4R4");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Table bonus",
      template: "participation",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 2, repeat: "repeat", requiresCheckIn: false },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Table marshal",
      assignmentType: "station",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id] },
    });
    await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 10,
    });

    const result = await awardStaffPoints({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "order-device",
      activityId: activity.id,
      participantId: first!.id,
      recipientScope: "order",
      commandId: "order-award",
    });

    expect(result.ok && result.value.postings).toHaveLength(2);
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(2);
    expect((await participantForTicket("01ARZ3NDEKTSV4R4"))?.balance).toBe(2);
  });

  it("commits a staff award independently from its optional media attachment", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Photo winner",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 3, repeat: "repeat", requiresCheckIn: false },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Photo marshal",
      assignmentType: "station",
      preset: "event-manager",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id] },
    });
    await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 10,
    });
    const base = {
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "photo-device",
      activityId: activity.id,
      participantId: participant!.id,
    };
    expect(
      await awardStaffPoints({
        ...base,
        commandId: "photo-award-valid",
        media: {
          storageRef: "transfer:event-photo-1",
          visibility: "event-album",
          consentState: "obtained",
        },
      }),
    ).toMatchObject({ ok: true });
    expect(await listScoreMediaLinks("scoring-night")).toMatchObject([
      {
        activityId: activity.id,
        participantId: participant!.id,
        staffActorId: access.id,
        storageRef: "transfer:event-photo-1",
      },
    ]);
    expect(
      await awardStaffPoints({
        ...base,
        commandId: "photo-award-bad-media",
        media: {
          storageRef: " ",
          visibility: "event-album",
          consentState: "obtained",
        },
      }),
    ).toMatchObject({ ok: true });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(6);
    expect(
      await listScoreAuditEvents({
        eventSlug: "scoring-night",
        participantId: participant!.id,
        actorId: access.id,
        activityId: activity.id,
        sourceType: "manual",
        status: "accepted",
      }),
    ).toHaveLength(2);
  });

  it("reconciles a bounded offline device budget exactly once", async () => {
    const previousSecret = process.env.AUTH_SECRET;
    process.env.AUTH_SECRET = "offline-score-test-secret";
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Offline winner",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 3, repeat: "repeat", requiresCheckIn: false },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Offline marshal",
      assignmentType: "station",
      preset: "points-marshal",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id], offlineBudgetMax: 12 },
    });
    await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 20,
    });
    const reservationInput = {
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "offline-device",
      activityId: activity.id,
      points: 9,
    };
    const [reserved, concurrent] = await Promise.all([
      reserveOfflineScoreBudget(reservationInput),
      reserveOfflineScoreBudget(reservationInput),
    ]);
    expect(reserved.ok).toBe(true);
    if (!reserved.ok) return;
    expect(concurrent).toMatchObject({
      ok: true,
      value: { id: reserved.value.id, points: 9 },
    });
    const command = {
      commandId: "offline-command-one",
      localSequence: 1,
      participantProof: buildTicketQrPayload("01ARZ3NDEKTSV4RR"),
      result: {},
      deviceTime: new Date().toISOString(),
    };
    const input = {
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "offline-device",
      reservationId: reserved.value.id,
    };
    expect(await reconcileOfflineScoreCommands({ ...input, commands: [command] })).toMatchObject({
      ok: true,
      value: [{ commandId: command.commandId, state: "accepted" }],
    });
    expect(await reconcileOfflineScoreCommands({ ...input, commands: [command] })).toMatchObject({
      ok: true,
      value: [{ commandId: command.commandId, state: "accepted" }],
    });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(3);
    expect(await closeOfflineScoreReservation(input)).toMatchObject({
      ok: true,
      value: { releasedPoints: 6 },
    });
    const pool = (await listPools("scoring-night"))[0];
    expect(pool).toMatchObject({ reserved: 0, spent: 3, available: 17 });
    const second = await reserveOfflineScoreBudget({
      eventSlug: "scoring-night",
      token: access.token!,
      deviceId: "offline-device",
      activityId: activity.id,
      points: 6,
    });
    expect(second.ok).toBe(true);
    expect(await releaseActivityReservations("scoring-night", activity.id)).toBe(6);
    expect((await listPools("scoring-night"))[0]).toMatchObject({
      reserved: 0,
      spent: 3,
      available: 17,
    });
    if (previousSecret === undefined) delete process.env.AUTH_SECRET;
    else process.env.AUTH_SECRET = previousSecret;
  });

  it("flags rapid staff repetition for human review", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Review signals",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 1, repeat: "repeat", requiresCheckIn: false },
    });
    const access = await createStaffAccess({
      eventSlug: "scoring-night",
      label: "Known marshal",
      assignmentType: "station",
      preset: "event-manager",
      actorId: "admin-test",
      reason: "integration test",
      scope: { activityIds: [activity.id] },
    });
    await createPool({
      eventSlug: "scoring-night",
      ownerType: "station",
      ownerId: access.id,
      points: 30,
    });
    const award = (commandId: string) =>
      awardStaffPoints({
        eventSlug: "scoring-night",
        token: access.token!,
        deviceId: "signal-device",
        activityId: activity.id,
        participantId: participant!.id,
        commandId,
      });
    for (let index = 0; index < 20; index += 1) {
      expect(await award(`rapid-${index}`)).toMatchObject({ ok: true });
    }
    expect(await listScoreAnomalyFlags("scoring-night")).toMatchObject([
      { signal: "rapid-repetition", assignmentId: access.id, deviceId: "signal-device" },
    ]);
  });

  it("adds to and reclaims only unused staff pool points", async () => {
    const issued = await issueStaffPool({
      eventSlug: "scoring-night",
      ownerType: "staff",
      ownerId: "staff-budget",
      points: 20,
      actorId: "admin-test",
    });
    expect(issued.ok).toBe(true);
    if (!issued.ok) return;
    expect(
      await adjustStaffPool({
        eventSlug: "scoring-night",
        poolId: issued.value.id,
        delta: -5,
        actorId: "admin-test",
      }),
    ).toMatchObject({ ok: true, value: { issued: 15, available: 15 } });
    expect(
      await adjustStaffPool({
        eventSlug: "another-event",
        poolId: issued.value.id,
        delta: 1,
        actorId: "admin-test",
      }),
    ).toMatchObject({ ok: false, status: 409 });
    const audits = await query<{ action: string }>(
      `select action from score_audit_events where entity_id = $1 order by id`,
      [issued.value.id],
    );
    expect(audits.map((audit) => audit.action)).toEqual(["pool.created", "pool.adjusted"]);
  });

  it("uses audited discovery lifecycle transitions and fresh copy credentials", async () => {
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Hidden QR",
      template: "discovery",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 2, repeat: "once", requiresCheckIn: false },
    });
    const created = await createDiscovery({
      eventSlug: "scoring-night",
      activityId: activity.id,
      name: "Hidden QR",
      method: "qr",
      rule: {
        pointMode: "once",
        pointsPerClue: 2,
        claimFrequency: "once",
        requiresCheckIn: false,
        remainderAward: "discard",
      },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    for (const status of ["live", "paused", "ended"] as const) {
      expect(
        await updateDiscovery({
          eventSlug: "scoring-night",
          discoveryId: created.value.id,
          actorId: "admin-test",
          status,
        }),
      ).toMatchObject({ ok: true, value: { status } });
    }
    expect(
      await updateDiscovery({
        eventSlug: "scoring-night",
        discoveryId: created.value.id,
        actorId: "admin-test",
        status: "live",
      }),
    ).toMatchObject({ ok: false, status: 409 });
    expect(
      await updateDiscovery({
        eventSlug: "scoring-night",
        discoveryId: created.value.id,
        actorId: "admin-test",
        status: "draft",
        reopen: true,
        reason: "The printed clue is back in service",
      }),
    ).toMatchObject({ ok: true, value: { status: "draft" } });
    const copied = await copyDiscovery({
      eventSlug: "scoring-night",
      discoveryId: created.value.id,
      actorId: "admin-test",
    });
    expect(copied.ok).toBe(true);
    if (copied.ok) {
      expect(copied.value.id).not.toBe(created.value.id);
      expect(copied.value.claimToken).not.toBe(created.value.claimToken);
      expect(copied.value.status).toBe("draft");
    }
  });

  it("applies noted penalties and makes a closed correction provisional", async () => {
    const participant = await participantForTicket("01ARZ3NDEKTSV4RR");
    const activity = await createActivity({
      eventSlug: "scoring-night",
      name: "Score review",
      template: "winner",
      status: "live",
      rule: { mode: "fixed", fixedPoints: 10, repeat: "repeat", requiresCheckIn: false },
    });
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings set state = 'live' where event_slug = 'scoring-night'`,
    );
    expect(
      await awardPoints({
        eventSlug: "scoring-night",
        activityId: activity.id,
        participantIds: [participant!.id],
        idempotencyKey: "penalty-base-award",
        actorType: "admin",
      }),
    ).toMatchObject({ ok: true });
    expect(
      await applyPenalty({
        eventSlug: "scoring-night",
        activityId: activity.id,
        participantId: participant!.id,
        points: 3,
        idempotencyKey: "penalty-one",
        actorType: "admin",
        note: "Rule violation confirmed",
      }),
    ).toMatchObject({ ok: true });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(7);
    expect(
      (await listScoreNotifications(participant!.id)).find(
        (notification) => notification.kind === "negative",
      ),
    ).toMatchObject({ points: -3, reasonCode: "penalty" });
    await query(
      `update event_scoring_settings set state = 'closed' where event_slug = 'scoring-night'`,
    );
    expect(
      await finalizeLeaderboard({
        eventSlug: "scoring-night",
        actorId: "admin-test",
        prizeSlots: 1,
      }),
    ).toMatchObject({ ok: true });
    expect(
      await correctPointsAfterClose({
        eventSlug: "scoring-night",
        activityId: activity.id,
        participantId: participant!.id,
        delta: 2,
        idempotencyKey: "closed-correction-one",
        actorId: "admin-test",
        note: "Verified missing result",
        confirmed: true,
      }),
    ).toMatchObject({ ok: true });
    expect((await participantForTicket("01ARZ3NDEKTSV4RR"))?.balance).toBe(9);
    expect(
      (
        await query<{ status: string }>(
          `select status from score_prize_finalizations where event_slug = 'scoring-night'`,
        )
      )[0]?.status,
    ).toBe("provisional");
    expect(
      await finalizeLeaderboard({
        eventSlug: "scoring-night",
        actorId: "admin-test",
        prizeSlots: 1,
      }),
    ).toMatchObject({ ok: true });
  });

  it("applies scheduled scoring boundaries from offset-aware instants", async () => {
    await getOrCreateSettings("scoring-night");
    await query(
      `update event_scoring_settings
          set state = 'ready', leaderboard_visibility = 'preview',
              scheduled_start = $2, scheduled_freeze = $3, scheduled_end = $4
        where event_slug = $1`,
      [
        "scoring-night",
        new Date("2026-10-25T01:30:00+01:00"),
        new Date("2026-10-25T01:15:00+00:00"),
        new Date("2026-10-25T01:30:00+00:00"),
      ],
    );
    expect(await processScheduledScoringTransitions(new Date("2026-10-25T00:45:00Z"))).toBe(1);
    expect(await findSettings("scoring-night")).toMatchObject({
      state: "live",
      leaderboardVisibility: "public-live",
    });
    expect(await processScheduledScoringTransitions(new Date("2026-10-25T01:20:00Z"))).toBe(1);
    expect((await findSettings("scoring-night"))?.state).toBe("frozen");
    expect(await processScheduledScoringTransitions(new Date("2026-10-25T01:45:00Z"))).toBe(1);
    expect(await findSettings("scoring-night")).toMatchObject({
      state: "closed",
      leaderboardVisibility: "public-final",
    });
    expect(
      (
        await query<{ count: string }>(
          `select count(*)::text as count from score_audit_events where action = 'scoring.state.scheduled'`,
        )
      )[0]?.count,
    ).toBe("3");
  });

  it("stores, changes, and clears the complete event-night schedule", async () => {
    const first = await configureScoring({
      eventSlug: "scoring-night",
      actorId: "admin-test",
      leaderboardVisibility: "preview",
      gamesOpenAt: "2026-09-01T18:00:00.000Z",
      gamesCloseAt: "2026-09-01T20:00:00.000Z",
      scheduledStart: "2026-09-01T18:00:00.000Z",
      scheduledFreeze: "2026-09-01T21:55:00.000Z",
      scheduledEnd: "2026-09-01T22:00:00.000Z",
    });
    expect(first).toMatchObject({
      ok: true,
      value: {
        gamesOpenAt: "2026-09-01T18:00:00.000Z",
        gamesCloseAt: "2026-09-01T20:00:00.000Z",
        scheduledStart: "2026-09-01T18:00:00.000Z",
        scheduledFreeze: "2026-09-01T21:55:00.000Z",
        scheduledEnd: "2026-09-01T22:00:00.000Z",
      },
    });

    const cleared = await configureScoring({
      eventSlug: "scoring-night",
      actorId: "admin-test",
      gamesOpenAt: null,
      gamesCloseAt: null,
      scheduledStart: null,
      scheduledFreeze: null,
      scheduledEnd: null,
    });
    expect(cleared).toMatchObject({ ok: true, value: { eventSlug: "scoring-night" } });
    if (!cleared.ok) return;
    expect(cleared.value.gamesOpenAt).toBeUndefined();
    expect(cleared.value.gamesCloseAt).toBeUndefined();
    expect(cleared.value.scheduledStart).toBeUndefined();
    expect(cleared.value.scheduledFreeze).toBeUndefined();
    expect(cleared.value.scheduledEnd).toBeUndefined();
  });
});
