import { randomUUID } from "node:crypto";
import type { ExcalidrawElement } from "@excalidraw/excalidraw/element/types";

import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  achievementCabinetForPerson,
  achievementViewForParticipant,
  listAchievementNotifications,
  markAchievementNotificationsDelivered,
  refreshPersonAchievements,
} from "@/features/achievements/achievements.server";
import {
  PITCH_DOCUMENT_SCHEMA_VERSION,
  PITCH_SLIDE_DEFAULT_DURATION_MS,
  type PitchDocument,
} from "@/features/things/pitches/types";
import { createPitchDeck, createPitchOwnerToken } from "@/features/things/pitches/store.server";
import { getOrCreateSettings } from "@/features/event-scoring/store.server";
import { query, queryOne } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

async function addEventWithTicket(input: {
  slug: string;
  ticketId: string;
  orderId: string;
  holderName: string;
}) {
  await query(
    `insert into events (slug,title,status,starts_at,timezone)
     values ($1,$2,'published',now(),'Europe/London')`,
    [input.slug, input.slug],
  );
  await query(
    `insert into ticket_types (event_slug,id,name,quantity)
     values ($1,'standard','Standard',20)`,
    [input.slug],
  );
  await query(
    `insert into tickets (id,event_slug,ticket_type_id,holder_name,order_id)
     values ($1,$2,'standard',$3,$4)`,
    [input.ticketId, input.slug, input.holderName, input.orderId],
  );
  const participant = await queryOne<{ id: string }>(
    `select id from event_participants where ticket_id = $1`,
    [input.ticketId],
  );
  if (!participant) throw new Error("Ticket participant was not created");
  return participant.id;
}

function sixPopulatedSlides(): PitchDocument {
  return {
    schemaVersion: PITCH_DOCUMENT_SCHEMA_VERSION,
    slides: Array.from({ length: 6 }, (_, index) => ({
      id: `slide_achievement_${index}`,
      name: `Slide ${index + 1}`,
      version: 1,
      updatedAt: 100 + index,
      durationMs: PITCH_SLIDE_DEFAULT_DURATION_MS,
      elements: [
        {
          id: `achievement_object_${index}`,
          type: "rectangle",
          version: 1,
          versionNonce: 100 + index,
          updated: 100 + index,
          isDeleted: false,
        } as ExcalidrawElement,
      ],
      assetIds: {},
      mediaClips: [],
    })),
  };
}

describeWithDatabase("achievements", () => {
  beforeAll(applySchema);
  beforeEach(truncateAll);
  afterAll(closeDatabase);

  it("keeps event progress on the individual ticket participant", async () => {
    const first = await addEventWithTicket({
      slug: "multi-ticket-night",
      ticketId: "ticket-first",
      orderId: "shared-order",
      holderName: "First Guest",
    });
    await query(
      `insert into tickets (id,event_slug,ticket_type_id,holder_name,order_id)
       values ('ticket-second','multi-ticket-night','standard','Second Guest','shared-order')`,
    );
    const second = await queryOne<{ id: string }>(
      `select id from event_participants where ticket_id = 'ticket-second'`,
    );
    expect(second).not.toBeNull();

    await query(`update event_participants set checked_in_at = now() where id = $1`, [first]);
    const [firstView, secondView] = await Promise.all([
      achievementViewForParticipant(first),
      achievementViewForParticipant(second!.id),
    ]);

    expect(
      firstView.event.find((achievement) => achievement.key === "present")?.unlockedAt,
    ).toBeDefined();
    expect(
      secondView.event.find((achievement) => achievement.key === "present")?.unlockedAt,
    ).toBeUndefined();
    expect(await listAchievementNotifications(second!.id)).toEqual([]);
  });

  it("delivers an unlock once and keeps it available in permanent person history", async () => {
    const participantId = await addEventWithTicket({
      slug: "claimed-night",
      ticketId: "claimed-ticket",
      orderId: "claimed-order",
      holderName: "Claimed Guest",
    });
    const personId = randomUUID();
    await query(`insert into event_people (id,canonical_name) values ($1,'Claimed Guest')`, [
      personId,
    ]);
    await query(
      `update event_participants set person_id = $2,checked_in_at = now() where id = $1`,
      [participantId, personId],
    );

    await achievementViewForParticipant(participantId);
    const notifications = await listAchievementNotifications(participantId);
    expect(notifications.map((notification) => notification.key)).toContain("present");
    expect(
      await markAchievementNotificationsDelivered(
        participantId,
        notifications.map((notification) => notification.id),
      ),
    ).toBe(notifications.length);
    expect(await listAchievementNotifications(participantId)).toEqual([]);

    const cabinet = await achievementCabinetForPerson(personId);
    expect(cabinet.find((achievement) => achievement.key === "present")?.unlockedAt).toBeDefined();
  });

  it("unlocks cross-event attendance only for a verified person", async () => {
    const personId = randomUUID();
    await query(`insert into event_people (id,canonical_name) values ($1,'Regular Guest')`, [
      personId,
    ]);
    for (const [index, slug] of ["night-one", "night-two", "night-three"].entries()) {
      const participantId = await addEventWithTicket({
        slug,
        ticketId: `regular-ticket-${index}`,
        orderId: `regular-order-${index}`,
        holderName: "Regular Guest",
      });
      await query(
        `update event_participants set person_id = $2,checked_in_at = now() where id = $1`,
        [participantId, personId],
      );
    }

    const cabinet = await achievementCabinetForPerson(personId);
    expect(cabinet.find((achievement) => achievement.key === "regular-behaviour")).toMatchObject({
      current: 3,
      target: 3,
    });
    expect(
      cabinet.find((achievement) => achievement.key === "regular-behaviour")?.unlockedAt,
    ).toBeDefined();
  });

  it("unlocks Six Appeal from a saved deck and rewards only the selected live-event ticket", async () => {
    const personId = randomUUID();
    await query(`insert into event_people (id,canonical_name) values ($1,'Pitch Guest')`, [
      personId,
    ]);
    const participantId = await addEventWithTicket({
      slug: "six-appeal-night",
      ticketId: "pitch-guest-ticket",
      orderId: "pitch-night-order",
      holderName: "Pitch Guest",
    });
    await query(
      `insert into tickets (id,event_slug,ticket_type_id,holder_name,order_id)
       values ('pitch-sibling-ticket','six-appeal-night','standard','Other Guest','pitch-night-order')`,
    );
    const sibling = await queryOne<{ id: string }>(
      `select id from event_participants where ticket_id = 'pitch-sibling-ticket'`,
    );
    expect(sibling).not.toBeNull();
    await query(`update event_participants set person_id = $2 where id = $1`, [
      participantId,
      personId,
    ]);
    await getOrCreateSettings("six-appeal-night");
    await query(`update event_scoring_settings set state = 'live' where event_slug = $1`, [
      "six-appeal-night",
    ]);
    const ownerToken = createPitchOwnerToken();
    const created = await createPitchDeck({
      createRequestId: "achievement-six-slide-deck",
      ownerName: "Pitch Guest",
      ownerEmail: "pitch-achievement@example.com",
      ownerToken,
      title: "Six things worth believing",
      document: sixPopulatedSlides(),
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;
    await query(`update pitch_decks set owner_person_id = $2 where id = $1`, [
      created.value.deck.id,
      personId,
    ]);
    await refreshPersonAchievements(personId, {
      sixAppealParticipantIds: [participantId],
    });
    await refreshPersonAchievements(personId, {
      sixAppealParticipantIds: [participantId],
    });

    const cabinet = await achievementCabinetForPerson(personId);
    expect(cabinet.find((achievement) => achievement.key === "six-appeal")).toMatchObject({
      current: 1,
      target: 1,
    });
    expect(
      cabinet.find((achievement) => achievement.key === "six-appeal")?.unlockedAt,
    ).toBeDefined();
    const balances = await query<{ participant_id: string; balance: number }>(
      `select participant.id as participant_id,coalesce(projection.balance,0)::integer as balance
         from event_participants participant
         left join score_projections projection on projection.participant_id = participant.id
        where participant.id = any($1::text[]) order by participant.id`,
      [[participantId, sibling!.id]],
    );
    expect(new Map(balances.map((row) => [row.participant_id, row.balance]))).toEqual(
      new Map([
        [participantId, 5],
        [sibling!.id, 0],
      ]),
    );
    expect(
      (await listAchievementNotifications(participantId)).find(
        (notification) => notification.key === "six-appeal",
      )?.sourceTransactionId,
    ).toBeDefined();
  });
});
