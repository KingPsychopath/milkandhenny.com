import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";

import { personGameHistory, recordPersonGame } from "@/features/person-games/history.server";
import { query } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase, truncateAll } from "../helpers/postgres";

const PERSON_ONE = "0198e9d8-53d7-7db1-bda4-c0f557db73a1";
const PERSON_TWO = "0198e9d8-53d7-7db2-8ff1-ea31f494216c";

describeWithDatabase("person game history", () => {
  beforeAll(applySchema);
  beforeEach(async () => {
    await truncateAll();
    await query(
      `insert into event_people (id,canonical_name) values
       ($1,'One'),($2,'Two')`,
      [PERSON_ONE, PERSON_TWO],
    );
  });
  afterAll(closeDatabase);

  it("isolates people and records retry-safe game events", async () => {
    const record = {
      personId: PERSON_ONE,
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

    expect(await personGameHistory(PERSON_TWO)).toEqual([]);
    expect(await personGameHistory(PERSON_ONE)).toEqual([
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
