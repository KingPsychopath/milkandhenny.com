import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import {
  listEventGameRegister,
  removeEventGameRegisterItem,
  upsertEventGameRegisterItem,
} from "@/features/event-scoring/event-games.server";
import { createActivity } from "@/features/event-scoring/store.server";
import { query } from "@/lib/platform/postgres.server";

import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("event game register", () => {
  beforeAll(async () => {
    await applySchema();
  });

  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into events (slug,title,status,starts_at,timezone)
       values ('game-night','Game Night','published',now(),'Europe/London')`,
    );
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it("keeps inclusion, entrance, scoring activities, and award method together", async () => {
    const played = await createActivity({
      eventSlug: "game-night",
      name: "Completed a multiplayer game",
      template: "completion",
      rule: { mode: "fixed", fixedPoints: 2, repeat: "repeat", requiresCheckIn: true },
    });
    const won = await createActivity({
      eventSlug: "game-night",
      name: "Won a multiplayer game",
      template: "winner",
      rule: { mode: "fixed", fixedPoints: 8, repeat: "repeat", requiresCheckIn: true },
    });

    const created = await upsertEventGameRegisterItem({
      eventSlug: "game-night",
      actorId: "admin",
      gameKey: "centre",
      label: "Centre",
      playMode: "pooled",
      poolEntranceId: "gpe_centre",
      awardMethod: "staff",
      activityIds: [played.id, won.id],
      status: "included",
    });
    expect(created).toMatchObject({
      ok: true,
      value: {
        gameKey: "centre",
        poolEntranceId: "gpe_centre",
        activityIds: [played.id, won.id],
      },
    });

    const updated = await upsertEventGameRegisterItem({
      eventSlug: "game-night",
      actorId: "admin",
      gameKey: "centre",
      label: "Centre",
      playMode: "hosted",
      awardMethod: "automatic",
      activityIds: [won.id],
      status: "paused",
    });
    expect(updated).toMatchObject({
      ok: true,
      value: { awardMethod: "automatic", status: "paused", activityIds: [won.id] },
    });
    expect(await listEventGameRegister("game-night")).toHaveLength(1);

    expect(
      await removeEventGameRegisterItem({ eventSlug: "game-night", gameKey: "centre" }),
    ).toEqual({ ok: true, value: { removed: true } });
    expect(await listEventGameRegister("game-night")).toEqual([]);
  });

  it("accepts one automatic pooled activity and rejects ambiguous automatic scoring", async () => {
    const activity = await createActivity({
      eventSlug: "game-night",
      name: "Played",
      template: "completion",
      rule: { mode: "fixed", fixedPoints: 2, repeat: "repeat", requiresCheckIn: true },
    });
    expect(
      await upsertEventGameRegisterItem({
        eventSlug: "game-night",
        actorId: "admin",
        gameKey: "centre",
        label: "Centre",
        playMode: "pooled",
        poolEntranceId: "gpe_centre",
        awardMethod: "automatic",
        activityIds: [activity.id],
        status: "included",
      }),
    ).toMatchObject({ ok: true, value: { awardMethod: "automatic" } });

    const second = await createActivity({
      eventSlug: "game-night",
      name: "Won",
      template: "winner",
      rule: { mode: "fixed", fixedPoints: 8, repeat: "repeat", requiresCheckIn: true },
    });
    expect(
      await upsertEventGameRegisterItem({
        eventSlug: "game-night",
        actorId: "admin",
        gameKey: "centre",
        label: "Centre",
        playMode: "pooled",
        poolEntranceId: "gpe_centre",
        awardMethod: "automatic",
        activityIds: [activity.id, second.id],
        status: "included",
      }),
    ).toMatchObject({ ok: false, status: 400 });
  });
});
