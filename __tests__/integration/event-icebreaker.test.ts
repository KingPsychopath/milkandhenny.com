import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  addEventIcebreakerEncounter,
  getEventIcebreaker,
} from "@/features/event-icebreaker/event-icebreaker.server";
import {
  markParticipantCheckedIn,
  participantForTicket,
} from "@/features/event-scoring/store.server";
import { changeScoringState, createScoringActivity } from "@/features/event-scoring/scoring.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("event arrival icebreaker", () => {
  beforeAll(applySchema);
  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into events (
         slug, title, status, starts_at, timezone, arrival_experience
       ) values ('arrival-night', 'Arrival Night', 'published', now(), 'Europe/London', 'icebreaker')`,
    );
    await query(
      `insert into ticket_types (event_slug, id, name, quantity)
       values ('arrival-night', 'standard', 'Standard', 20)`,
    );
  });
  afterAll(closeDatabase);

  async function participant(index: number) {
    const ticketId = `01ARZ3NDEKTSV${String(index).padStart(4, "0")}`;
    await query(
      `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id)
       values ($1, 'arrival-night', 'standard', $2, $3)`,
      [ticketId, `Guest ${index}`, `order-${index}`],
    );
    const result = await participantForTicket(ticketId);
    if (!result) throw new Error("participant was not created");
    return result;
  }

  it("requires check-in and keeps colour allocation balanced", async () => {
    const first = await participant(1);
    expect(await getEventIcebreaker("arrival-night", first.id)).toMatchObject({
      ok: false,
      status: 409,
    });

    const assignments: string[] = [];
    for (let index = 1; index <= 17; index += 1) {
      const current = index === 1 ? first : await participant(index);
      await markParticipantCheckedIn(current.id);
      const launch = await getEventIcebreaker("arrival-night", current.id);
      expect(launch.ok).toBe(true);
      if (launch.ok) assignments.push(launch.value.player.colour.code);
    }
    const counts = [...new Set(assignments)].map(
      (code) => assignments.filter((candidate) => candidate === code).length,
    );
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    expect(new Set(assignments).size).toBe(8);
  });

  it("persists new and repeat mixes, rejects another event, and ignores self-pairing", async () => {
    const first = await participant(1);
    const second = await participant(2);
    await Promise.all([markParticipantCheckedIn(first.id), markParticipantCheckedIn(second.id)]);
    const firstLaunch = await getEventIcebreaker("arrival-night", first.id);
    const secondLaunch = await getEventIcebreaker("arrival-night", second.id);
    if (!firstLaunch.ok || !secondLaunch.ok) throw new Error("launch failed");

    const self = await addEventIcebreakerEncounter({
      eventSlug: "arrival-night",
      participantId: first.id,
      partnerCode: firstLaunch.value.player.id,
    });
    expect(self).toMatchObject({ ok: true, value: { status: "self", encounter: null } });

    const added = await addEventIcebreakerEncounter({
      eventSlug: "arrival-night",
      participantId: first.id,
      partnerCode: secondLaunch.value.player.id,
    });
    expect(added).toMatchObject({ ok: true, value: { status: "new", persisted: true } });
    const repeat = await addEventIcebreakerEncounter({
      eventSlug: "arrival-night",
      participantId: first.id,
      partnerCode: secondLaunch.value.player.id,
    });
    expect(repeat).toMatchObject({ ok: true, value: { status: "repeat", persisted: true } });
    const reloaded = await getEventIcebreaker("arrival-night", first.id);
    expect(reloaded.ok && reloaded.value.ledger.encounters).toHaveLength(1);

    expect(
      await addEventIcebreakerEncounter({
        eventSlug: "arrival-night",
        participantId: first.id,
        partnerCode: "ABCDE",
      }),
    ).toMatchObject({ ok: false, status: 404 });
  });

  it("awards both guests once for a unique scored mix", async () => {
    const first = await participant(1);
    const second = await participant(2);
    await Promise.all([markParticipantCheckedIn(first.id), markParticipantCheckedIn(second.id)]);
    await changeScoringState({
      eventSlug: "arrival-night",
      state: "live",
      actorId: "admin",
      force: true,
    });
    const activity = await createScoringActivity({
      eventSlug: "arrival-night",
      name: "Icebreaker mix",
      template: "discovery",
      status: "live",
      rule: {
        mode: "fixed",
        fixedPoints: 2,
        repeat: "once-per-source",
        requiresCheckIn: true,
      },
      actorId: "admin",
    });
    expect(activity.ok).toBe(true);

    const firstLaunch = await getEventIcebreaker("arrival-night", first.id);
    const secondLaunch = await getEventIcebreaker("arrival-night", second.id);
    if (!firstLaunch.ok || !secondLaunch.ok) throw new Error("launch failed");
    const input = {
      eventSlug: "arrival-night",
      participantId: first.id,
      partnerCode: secondLaunch.value.player.id,
    };
    const [one, two] = await Promise.all([
      addEventIcebreakerEncounter(input),
      addEventIcebreakerEncounter(input),
    ]);
    expect(one).toMatchObject({ ok: true });
    expect(two).toMatchObject({ ok: true });
    expect((await participantForTicket("01ARZ3NDEKTSV0001"))?.balance).toBe(2);
    expect((await participantForTicket("01ARZ3NDEKTSV0002"))?.balance).toBe(2);

    await addEventIcebreakerEncounter({
      eventSlug: "arrival-night",
      participantId: second.id,
      partnerCode: firstLaunch.value.player.id,
    });
    expect((await participantForTicket("01ARZ3NDEKTSV0001"))?.balance).toBe(2);
    expect((await participantForTicket("01ARZ3NDEKTSV0002"))?.balance).toBe(2);
  });
});
