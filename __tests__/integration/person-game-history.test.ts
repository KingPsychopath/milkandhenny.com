import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { personGameHistory, recordPersonGame } from "@/features/person-games/history.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

describeWithDatabase("person game history", () => {
  beforeAll(applySchema);
  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into event_people (id,canonical_name) values
       ('person_history_one','One'),('person_history_two','Two')`,
    );
  });
  afterAll(closeDatabase);

  it("isolates people and records retry-safe game events", async () => {
    const record = {
      personId: "person_history_one",
      game: "hot-and-cold",
      mode: "daily" as const,
      externalRef: "42",
      event: { key: "guess:warm", kind: "guess", payload: { rank: 12 } },
    };
    await recordPersonGame(record);
    await recordPersonGame(record);
    await recordPersonGame({
      ...record,
      status: "completed",
      outcome: "found",
      score: 0,
      event: { key: "guess:target", kind: "guess", payload: { rank: 0 } },
    });

    expect(await personGameHistory("person_history_two")).toEqual([]);
    expect(await personGameHistory("person_history_one")).toEqual([
      expect.objectContaining({
        game: "hot-and-cold",
        mode: "daily",
        reference: "42",
        status: "completed",
        outcome: "found",
        score: 0,
        eventCount: 2,
      }),
    ]);
  });
});
