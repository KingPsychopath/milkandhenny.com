import { describe, expect, it } from "vitest";

import {
  LIARS_MIN_VILLAGERS,
  LIARS_PLAYER_LIMITS,
  LIARS_ROLES,
  liarsActionMoves,
  liarsDealRoles,
  liarsDefaultLineup,
  liarsDetectWinner,
  liarsFirstGameLineup,
  liarsGraveyardArmsAt,
  liarsLineupEntries,
  liarsLineupTotal,
  liarsNightDuration,
  liarsPlurality,
  liarsReadsGuilty,
  liarsRoleSide,
  liarsSideCounts,
  liarsTargetableIds,
  liarsValidateLineup,
  liarsDefaultTimings,
  liarsWrongVoteBudget,
} from "../../features/things/liars/liars-rules";
import type { LiarsMode, LiarsRole } from "../../features/things/liars/types";

const NO_REPEAT = { doctorRepeatTarget: false };
const JESTER_ENDS = { jesterEndsGame: true };

function counts(mode: LiarsMode, playerCount: number) {
  return liarsDefaultLineup(mode, playerCount);
}

function playerCounts(mode: LiarsMode) {
  const { min, max } = LIARS_PLAYER_LIMITS[mode];
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

/** A deterministic `pick` so a deal can be asserted rather than sampled. */
function sequencePick(sequence: number[]) {
  let index = 0;
  return (bound: number) => sequence[index++ % sequence.length] % bound;
}

describe("liars lineups", () => {
  it.each(playerCounts("mafia"))("deals a valid mafia lineup for %i players", (playerCount) => {
    const lineup = counts("mafia", playerCount);
    const result = liarsValidateLineup("mafia", lineup, playerCount);
    expect(result.ok, JSON.stringify(lineup)).toBe(true);
    expect(liarsLineupTotal(lineup)).toBe(playerCount);
  });

  it.each(playerCounts("imposter"))(
    "deals a valid imposter lineup for %i players",
    (playerCount) => {
      const lineup = counts("imposter", playerCount);
      const result = liarsValidateLineup("imposter", lineup, playerCount);
      expect(result.ok, JSON.stringify(lineup)).toBe(true);
      expect(liarsLineupTotal(lineup)).toBe(playerCount);
    },
  );

  it("never starts the mafia at parity, and always leaves villagers to watch", () => {
    for (const playerCount of playerCounts("mafia")) {
      const lineup = counts("mafia", playerCount);
      const { town, mafia } = liarsSideCounts(lineup);
      expect(mafia, `${playerCount} players`).toBeLessThan(town);
      expect(lineup.roles.villager ?? 0).toBeGreaterThanOrEqual(LIARS_MIN_VILLAGERS);
    }
  });

  it("keeps the mafia side at roughly one in four", () => {
    for (const playerCount of playerCounts("mafia")) {
      const { mafia } = liarsSideCounts(counts("mafia", playerCount));
      expect(mafia).toBeGreaterThanOrEqual(1);
      expect(mafia / playerCount).toBeLessThanOrEqual(0.32);
    }
  });

  it("respects every role's minimum player count", () => {
    for (const mode of ["mafia", "imposter"] as const) {
      for (const playerCount of playerCounts(mode)) {
        for (const [role] of liarsLineupEntries(counts(mode, playerCount)))
          expect(LIARS_ROLES[role].minPlayers, `${role} at ${playerCount}`).toBeLessThanOrEqual(
            playerCount,
          );
      }
    }
  });

  it("strips the first-game lineup to doctor, detective and villagers", () => {
    for (const playerCount of playerCounts("mafia")) {
      const lineup = liarsFirstGameLineup("mafia", playerCount);
      expect(liarsValidateLineup("mafia", lineup, playerCount).ok).toBe(true);
      expect(Object.keys(lineup.roles).toSorted()).toEqual([
        "detective",
        "doctor",
        "mafia",
        "villager",
      ]);
    }
  });

  it("reports the wrong-vote budget the lobby board shows", () => {
    // Twelve players: three mafia against eight town, so two wrong ejections are survivable.
    expect(liarsWrongVoteBudget(counts("mafia", 12))).toBe(2);
    expect(liarsWrongVoteBudget({ roles: { mafia: 3, villager: 3 } })).toBe(0);
  });
});

describe("liars lineup validation", () => {
  it("rejects a lineup that does not match the roster", () => {
    const result = liarsValidateLineup("mafia", { roles: { mafia: 1, villager: 3 } }, 9);
    expect(result).toMatchObject({ ok: false, problem: { code: "count_mismatch" } });
  });

  it("rejects a lineup that starts at parity", () => {
    const result = liarsValidateLineup("mafia", { roles: { mafia: 3, villager: 3 } }, 6);
    expect(result).toMatchObject({ ok: false, problem: { code: "mafia_parity" } });
  });

  it("rejects a lineup with no plain villagers left to watch", () => {
    const result = liarsValidateLineup(
      "mafia",
      { roles: { mafia: 1, doctor: 1, detective: 1, lookout: 1, bodyguard: 1 } },
      5,
    );
    expect(result).toMatchObject({ ok: false, problem: { code: "not_enough_villagers" } });
  });

  it("names the broken shape before it names a role's minimum", () => {
    // Both are wrong here. The one a host can act on is the missing villagers.
    const result = liarsValidateLineup(
      "mafia",
      { roles: { mafia: 1, doctor: 1, detective: 1, escort: 1, vigilante: 1 } },
      5,
    );
    expect(result).toMatchObject({ ok: false, problem: { code: "not_enough_villagers" } });
  });

  it("rejects a role below its minimum player count with a specific reason", () => {
    const result = liarsValidateLineup(
      "mafia",
      { roles: { mafia: 1, escort: 1, doctor: 1, villager: 2 } },
      5,
    );
    expect(result).toMatchObject({ ok: false, problem: { code: "role_needs_players" } });
    if (!result.ok) expect(result.problem.message).toContain("escort");
  });

  it("rejects roles from the other mode", () => {
    const result = liarsValidateLineup("mafia", { roles: { imposter: 1, villager: 4 } }, 5);
    expect(result).toMatchObject({ ok: false, problem: { code: "wrong_mode" } });
  });

  it("rejects a game nobody can lose", () => {
    expect(liarsValidateLineup("mafia", { roles: { doctor: 1, villager: 4 } }, 5)).toMatchObject({
      ok: false,
      problem: { code: "no_mafia" },
    });
  });

  it("warns rather than blocks when a host piles on more specials than the count wants", () => {
    const lineup = {
      roles: {
        godfather: 1,
        mafia: 1,
        jammer: 1,
        doctor: 1,
        detective: 1,
        lookout: 1,
        bodyguard: 1,
        escort: 1,
        jester: 1,
        villager: 3,
      },
    };
    const result = liarsValidateLineup("mafia", lineup, 12);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.warnings.some(({ code }) => code === "too_many_specials")).toBe(true);
  });

  it("never warns on the lineup the game recommends", () => {
    for (const playerCount of playerCounts("mafia")) {
      const result = liarsValidateLineup("mafia", counts("mafia", playerCount), playerCount);
      expect(result.ok, `${playerCount}`).toBe(true);
      if (result.ok) expect(result.warnings, `${playerCount} players`).toEqual([]);
    }
  });
});

describe("liars deal", () => {
  it("hands out exactly the lineup that was validated", () => {
    const lineup = counts("mafia", 12);
    const playerIds = Array.from({ length: 12 }, (_, index) => `p${index}`);
    const dealt = liarsDealRoles({ lineup, playerIds, pick: sequencePick([3, 7, 1, 5, 2]) });

    expect(Object.keys(dealt)).toHaveLength(12);
    const tally: Partial<Record<LiarsRole, number>> = {};
    for (const role of Object.values(dealt)) tally[role] = (tally[role] ?? 0) + 1;
    expect(tally).toEqual(lineup.roles);
  });

  it("steers a rematch away from redealing the same role to the same person", () => {
    const lineup = { roles: { mafia: 1, doctor: 1, detective: 1, villager: 2 } };
    const playerIds = ["a", "b", "c", "d", "e"];
    const first = liarsDealRoles({ lineup, playerIds, pick: sequencePick([1, 2, 3, 4]) });
    const second = liarsDealRoles({
      lineup,
      playerIds,
      previousRoles: first,
      pick: sequencePick([1, 2, 3, 4]),
    });

    // The villagers are interchangeable, so the guarantee is about the specials.
    for (const playerId of playerIds) {
      if (first[playerId] === "villager") continue;
      expect(second[playerId], playerId).not.toBe(first[playerId]);
    }
  });
});

describe("liars win detection", () => {
  const alive = (roles: LiarsRole[]) =>
    roles.map((role, index) => ({ playerId: `p${index}`, role }));

  it("gives the town the win when the last mafia dies", () => {
    expect(
      liarsDetectWinner({
        mode: "mafia",
        toggles: JESTER_ENDS,
        alive: alive(["doctor", "villager", "villager"]),
      }),
    ).toBe("town");
  });

  it("gives the mafia the win at parity, not only past it", () => {
    expect(
      liarsDetectWinner({
        mode: "mafia",
        toggles: JESTER_ENDS,
        alive: alive(["mafia", "villager"]),
      }),
    ).toBe("mafia");
    expect(
      liarsDetectWinner({
        mode: "mafia",
        toggles: JESTER_ENDS,
        alive: alive(["mafia", "villager", "villager"]),
      }),
    ).toBeNull();
  });

  it("does not count the jester toward either side", () => {
    expect(
      liarsDetectWinner({
        mode: "mafia",
        toggles: JESTER_ENDS,
        alive: alive(["mafia", "villager", "villager", "jester"]),
      }),
    ).toBeNull();
  });

  it("ends the game outright when the jester is ejected", () => {
    expect(
      liarsDetectWinner({
        mode: "mafia",
        toggles: JESTER_ENDS,
        alive: alive(["mafia", "villager", "villager", "villager"]),
        ejectedJesterId: "j",
      }),
    ).toBe("third");
  });

  it("leaves the jester with nothing when the toggle is off", () => {
    expect(
      liarsDetectWinner({
        mode: "mafia",
        toggles: { jesterEndsGame: false },
        alive: alive(["mafia", "villager", "villager", "villager"]),
        ejectedJesterId: "j",
      }),
    ).toBeNull();
  });

  it("makes the crew find every imposter, not just one", () => {
    const pending = liarsDetectWinner({
      mode: "imposter",
      toggles: JESTER_ENDS,
      alive: alive(["imposter", "crew", "crew", "crew", "crew"]),
      crewEjections: 1,
      imposterEjections: 1,
    });
    expect(pending).toBeNull();
  });

  it("holds the crew win until the last imposter has taken their guess", () => {
    const awaitingGuess = liarsDetectWinner({
      mode: "imposter",
      toggles: JESTER_ENDS,
      alive: alive(["crew", "crew", "crew", "crew"]),
      finalGuessCorrect: null,
    });
    expect(awaitingGuess).toBeNull();

    expect(
      liarsDetectWinner({
        mode: "imposter",
        toggles: JESTER_ENDS,
        alive: alive(["crew", "crew", "crew", "crew"]),
        finalGuessCorrect: false,
      }),
    ).toBe("town");

    expect(
      liarsDetectWinner({
        mode: "imposter",
        toggles: JESTER_ENDS,
        alive: alive(["crew", "crew", "crew", "crew"]),
        finalGuessCorrect: true,
      }),
    ).toBe("mafia");
  });

  it("gives the imposter the win on two wrong ejections or the final three", () => {
    expect(
      liarsDetectWinner({
        mode: "imposter",
        toggles: JESTER_ENDS,
        alive: alive(["imposter", "crew", "crew", "crew"]),
        crewEjections: 2,
      }),
    ).toBe("mafia");
    expect(
      liarsDetectWinner({
        mode: "imposter",
        toggles: JESTER_ENDS,
        alive: alive(["imposter", "crew", "crew"]),
        crewEjections: 0,
      }),
    ).toBe("mafia");
  });
});

describe("liars targeting", () => {
  const living = [
    { playerId: "gf", role: "godfather" as LiarsRole },
    { playerId: "mob", role: "mafia" as LiarsRole },
    { playerId: "doc", role: "doctor" as LiarsRole },
    { playerId: "det", role: "detective" as LiarsRole },
    { playerId: "vil", role: "villager" as LiarsRole },
  ];

  it("keeps the mafia from targeting their own", () => {
    const ids = liarsTargetableIds({
      mode: "mafia",
      role: "godfather",
      actorId: "gf",
      living,
      toggles: NO_REPEAT,
    });
    expect(ids).toEqual(["doc", "det", "vil"]);
  });

  it("lets only the doctor target themselves", () => {
    expect(
      liarsTargetableIds({
        mode: "mafia",
        role: "doctor",
        actorId: "doc",
        living,
        toggles: NO_REPEAT,
      }),
    ).toContain("doc");
    expect(
      liarsTargetableIds({
        mode: "mafia",
        role: "detective",
        actorId: "det",
        living,
        toggles: NO_REPEAT,
      }),
    ).not.toContain("det");
    expect(
      liarsTargetableIds({
        mode: "mafia",
        role: "villager",
        actorId: "vil",
        living,
        toggles: NO_REPEAT,
      }),
    ).not.toContain("vil");
  });

  it("stops the doctor protecting the same person two nights running", () => {
    const ids = liarsTargetableIds({
      mode: "mafia",
      role: "doctor",
      actorId: "doc",
      living,
      previousTargetId: "doc",
      toggles: NO_REPEAT,
    });
    expect(ids).not.toContain("doc");
    expect(
      liarsTargetableIds({
        mode: "mafia",
        role: "doctor",
        actorId: "doc",
        living,
        previousTargetId: "doc",
        toggles: { doctorRepeatTarget: true },
      }),
    ).toContain("doc");
  });

  it("gives roles with no night action nothing to target", () => {
    expect(
      liarsTargetableIds({
        mode: "imposter",
        role: "crew",
        actorId: "c",
        living: [],
        toggles: NO_REPEAT,
      }),
    ).toEqual([]);
  });
});

describe("liars night mechanics", () => {
  it("counts every action as leaving the house except watching", () => {
    expect(liarsActionMoves("mafia", "someone")).toBe(true);
    expect(liarsActionMoves("doctor", "someone")).toBe(true);
    expect(liarsActionMoves("villager", "someone")).toBe(false);
    expect(liarsActionMoves("jester", "someone")).toBe(false);
    // Staying in is never movement.
    expect(liarsActionMoves("mafia", null)).toBe(false);
  });

  it("reads the godfather as innocent and every other mafia as guilty", () => {
    expect(liarsReadsGuilty("mafia")).toBe(true);
    expect(liarsReadsGuilty("jammer")).toBe(true);
    expect(liarsReadsGuilty("godfather")).toBe(false);
    expect(liarsReadsGuilty("doctor")).toBe(false);
  });

  it("gives the night longer once the room is bigger than ten", () => {
    const timings = liarsDefaultTimings("same-room");
    expect(liarsNightDuration(timings, 8)).toBe(45_000);
    expect(liarsNightDuration(timings, 10)).toBe(45_000);
    expect(liarsNightDuration(timings, 13)).toBe(90_000);
  });

  it("gives a remote room longer to deliberate", () => {
    expect(liarsDefaultTimings("remote").deliberation).toBeGreaterThan(
      liarsDefaultTimings("same-room").deliberation,
    );
  });

  it("arms the graveyard once half the table is gone", () => {
    expect(liarsGraveyardArmsAt(9)).toBe(5);
    expect(liarsGraveyardArmsAt(12)).toBe(6);
  });
});

describe("liars voting", () => {
  it("ejects on a plurality", () => {
    expect(liarsPlurality([{ targetId: "a" }, { targetId: "a" }, { targetId: "b" }])).toBe("a");
  });

  it("ejects nobody on a tie", () => {
    expect(liarsPlurality([{ targetId: "a" }, { targetId: "b" }])).toBeNull();
  });

  it("ignores abstentions rather than counting them against a quorum", () => {
    expect(liarsPlurality([{ targetId: "a" }, { targetId: null }, { targetId: null }])).toBe("a");
  });

  it("ejects nobody when everyone abstains", () => {
    expect(liarsPlurality([{ targetId: null }, { targetId: null }])).toBeNull();
  });
});

describe("liars role table", () => {
  it("gives every role a side and a rules page", () => {
    for (const role of Object.values(LIARS_ROLES)) {
      expect(role.rules.length, role.id).toBeGreaterThan(0);
      expect(role.summary.length, role.id).toBeGreaterThan(0);
      expect(["town", "mafia", "third"]).toContain(liarsRoleSide(role.id));
    }
  });

  it("gives every mafia-mode role a night action so nobody idles", () => {
    for (const role of Object.values(LIARS_ROLES)) {
      if (role.mode !== "mafia") continue;
      expect(role.actionLabel, role.id).not.toBeNull();
    }
  });
});
