import type {
  LiarsLineup,
  LiarsMode,
  LiarsRole,
  LiarsRoomMode,
  LiarsSide,
  LiarsTimings,
  LiarsToggles,
} from "./types";

/**
 * The single source of truth for both games. The setup screen, the rules sheet, the deal card and
 * the engine all read from here, so the rules a player is shown cannot drift from the rules the
 * server enforces. Pure and browser-safe — no Redis, no crypto, no environment.
 */

export const LIARS_PLAYER_LIMITS = {
  mafia: { min: 5, max: 16 },
  imposter: { min: 4, max: 16 },
} as const;

/** Past this the day turns into role-claim soup. Warned, never blocked. */
export const LIARS_SPECIAL_SOFT_CAP = (playerCount: number) => Math.ceil(playerCount / 2) + 1;
export const LIARS_SPECIAL_HARD_CAP = 9;
export const LIARS_MIN_VILLAGERS = 2;
export const LIARS_MAX_NAME_LENGTH = 24;
export const LIARS_LAST_WORDS_LENGTH = 80;

export interface LiarsRoleDefinition {
  id: LiarsRole;
  mode: LiarsMode;
  name: string;
  side: LiarsSide;
  /** One line, shown on the deal card and beside the role on the lobby board. */
  summary: string;
  /** The expandable rules, in the order they should be read. */
  rules: string[];
  /** Night action label, or null for roles that do not act. */
  actionLabel: string | null;
  /** How the night report addresses this role. */
  reportVerb: string | null;
  minPlayers: number;
  maxCopies: number;
  /** Plain villagers and plain mafia are not "specials" for cap purposes. */
  special: boolean;
  selfTarget: boolean;
  /** Does acting mean leaving your house? Watching does not — you stay up watching their door. */
  moves: boolean;
}

const ROLE_LIST: LiarsRoleDefinition[] = [
  {
    id: "mafia",
    mode: "mafia",
    name: "mafia",
    side: "mafia",
    summary: "Kill one person each night, or stay in.",
    rules: [
      "Each night the mafia agree on one person to kill, or choose to stay in.",
      "Staying in means nobody dies and nobody moves — there is nothing for a watcher to see.",
      "You know who the other mafia are, and you can see their pick change in real time.",
      "You cannot target another mafia.",
      "You win when the mafia equal or outnumber the town.",
    ],
    actionLabel: "who dies tonight",
    reportVerb: "it's done",
    minPlayers: 5,
    maxCopies: 3,
    special: false,
    selfTarget: false,
    moves: true,
  },
  {
    id: "godfather",
    mode: "mafia",
    name: "godfather",
    side: "mafia",
    summary: "You kill, and you read innocent.",
    rules: [
      "You are mafia, and the detective always reads you as innocent.",
      "When the mafia disagree, your pick is the one that happens.",
      "If you die, the call passes to the longest-surviving mafia.",
    ],
    actionLabel: "who dies tonight",
    reportVerb: "it's done",
    minPlayers: 7,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "jammer",
    mode: "mafia",
    name: "jammer",
    side: "mafia",
    summary: "Cancel one person's night action.",
    rules: [
      "Choose someone each night. Whatever they were going to do does not happen.",
      "They are told their night was interrupted, and they still count as having moved — they went out and were turned away.",
      "You cannot block your own team.",
    ],
    actionLabel: "who to block",
    reportVerb: "blocked",
    minPlayers: 12,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "doctor",
    mode: "mafia",
    name: "doctor",
    side: "town",
    summary: "Save one person each night. You may save yourself.",
    rules: [
      "Choose one person each night. If they are attacked, they live.",
      "You may choose yourself.",
      "You cannot protect the same person two nights running, yourself included.",
      "A save cancels the attack outright, so a bodyguard on the same person survives too.",
    ],
    actionLabel: "who to save",
    reportVerb: "you're watching over them",
    minPlayers: 5,
    maxCopies: 1,
    special: true,
    selfTarget: true,
    moves: true,
  },
  {
    id: "detective",
    mode: "mafia",
    name: "detective",
    side: "town",
    summary: "Learn whether one person is guilty.",
    rules: [
      "Choose one person each night. You learn guilty or innocent.",
      "You read apparent alignment, so the godfather comes back innocent.",
      "Your answer arrives ten seconds before the night ends, in the same card everyone else gets.",
    ],
    actionLabel: "who to investigate",
    reportVerb: null,
    minPlayers: 5,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "lookout",
    mode: "mafia",
    name: "lookout",
    side: "town",
    summary: "See everyone who visited one person.",
    rules: [
      "Choose one person each night. You learn the names of everyone who came to their door.",
      "This is the strong version of what villagers do — they learn only whether someone went out.",
    ],
    actionLabel: "whose door to watch",
    reportVerb: null,
    minPlayers: 7,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "bodyguard",
    mode: "mafia",
    name: "bodyguard",
    side: "town",
    summary: "Guard one person. Die in their place.",
    rules: [
      "Choose one person each night. If they are attacked, you die instead and they live.",
      "If the doctor saved them, the attack is cancelled and you both live.",
      "Someone still dies, so the night is never silent.",
    ],
    actionLabel: "who to guard",
    reportVerb: "you're at their door",
    minPlayers: 9,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "escort",
    mode: "mafia",
    name: "escort",
    side: "town",
    summary: "Spend the night with someone. See who comes for them.",
    rules: [
      "Choose one person each night. You spend the night at their house.",
      "If anything happens to them, you see the attacker's name.",
      "If the attack succeeds you die with them — but your report publishes at dawn as your dying testimony.",
      "If the doctor saves them, you both live and you keep the name to yourself.",
      "Your own house is empty, so a kill aimed at you misses.",
    ],
    actionLabel: "who to spend the night with",
    reportVerb: null,
    minPlayers: 11,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "vigilante",
    mode: "mafia",
    name: "vigilante",
    side: "town",
    summary: "One shot, once per game.",
    rules: [
      "You may kill one person, once, on any night. Or hold.",
      "If you kill a townsperson, you die of guilt the following night.",
      "Protection works against you exactly as it works against the mafia.",
    ],
    actionLabel: "who to shoot",
    reportVerb: "the shot is loaded",
    minPlayers: 14,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: true,
  },
  {
    id: "villager",
    mode: "mafia",
    name: "villager",
    side: "town",
    summary: "Keep watch on someone's door.",
    rules: [
      "Choose one person each night and stay up watching their door. You never leave your own street.",
      "You learn whether they went out. Anyone who acted at night went out — the mafia, but also the doctor and the detective.",
      "Alone, what you saw is true but unprovable. If two or more of you watched the same person, it is announced at dawn — and nobody learns who watched.",
      "Nothing is announced when someone stayed in. Silence is silence.",
    ],
    actionLabel: "whose door to watch",
    reportVerb: null,
    minPlayers: 5,
    maxCopies: 16,
    special: false,
    selfTarget: false,
    moves: false,
  },
  {
    id: "jester",
    mode: "mafia",
    name: "jester",
    side: "third",
    summary: "You win alone, if the town votes you out.",
    rules: [
      "You want to be ejected. Being killed at night does not count.",
      "At night you watch a door, exactly like a villager, so nobody can tell you apart.",
      "You win alone.",
    ],
    actionLabel: "whose door to watch",
    reportVerb: null,
    minPlayers: 9,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: false,
  },
  {
    id: "crew",
    mode: "imposter",
    name: "crew",
    side: "town",
    summary: "You know the word. Prove you belong.",
    rules: [
      "You and everyone else on the crew share one secret word.",
      "On your turn, say one word out loud that describes it — vague enough that an imposter cannot steal it, clear enough that the crew believe you.",
      "Vote out every imposter to win.",
    ],
    actionLabel: null,
    reportVerb: null,
    minPlayers: 4,
    maxCopies: 16,
    special: false,
    selfTarget: false,
    moves: false,
  },
  {
    id: "understudy",
    mode: "imposter",
    name: "understudy",
    side: "town",
    summary: "You have a word. It is not quite the right one.",
    rules: [
      "You were given a word close to the real one — and you are not told which is which.",
      "Play it straight. You are on the crew and you win with them.",
      "Your clues will fit, until suddenly they do not.",
    ],
    actionLabel: null,
    reportVerb: null,
    minPlayers: 7,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: false,
  },
  {
    id: "imposter",
    mode: "imposter",
    name: "imposter",
    side: "mafia",
    summary: "You have no word. Bluff.",
    rules: [
      "Everyone else shares a word. You do not know it.",
      "Listen to the clues, work it out, and give one convincing enough that nobody looks at you.",
      "Survive two ejections, or reach the final three, and you win.",
      "If you are the last imposter and you are voted out, you get one guess at the word — get it right and you take the whole game.",
    ],
    actionLabel: null,
    reportVerb: null,
    minPlayers: 4,
    maxCopies: 3,
    special: true,
    selfTarget: false,
    moves: false,
  },
  {
    id: "mole",
    mode: "imposter",
    name: "mole",
    side: "mafia",
    summary: "You know the word, and you know the imposter.",
    rules: [
      "You have the real word and you know exactly who the imposter is.",
      "You win with them, so your job is to give clues that keep suspicion anywhere else.",
      "The imposter does not know you exist.",
    ],
    actionLabel: null,
    reportVerb: null,
    minPlayers: 12,
    maxCopies: 1,
    special: true,
    selfTarget: false,
    moves: false,
  },
];

export const LIARS_ROLES: Record<LiarsRole, LiarsRoleDefinition> = Object.fromEntries(
  ROLE_LIST.map((role) => [role.id, role]),
) as Record<LiarsRole, LiarsRoleDefinition>;

export function liarsRolesForMode(mode: LiarsMode) {
  return ROLE_LIST.filter((role) => role.mode === mode);
}

export const LIARS_MODE_COPY: Record<
  LiarsMode,
  {
    name: string;
    /** "a mafia room" but "an imposter room". */
    article: string;
    tagline: string;
    sides: Record<LiarsSide, string>;
    /** Singular forms, for the counts that come out as one. */
    sidesSingular: Record<LiarsSide, string>;
  }
> = {
  mafia: {
    name: "mafia",
    article: "a",
    tagline: "Someone in this room is killing people. Work out who before they run out of people.",
    sides: { town: "town", mafia: "mafia", third: "jester" },
    sidesSingular: { town: "town", mafia: "mafia", third: "jester" },
  },
  imposter: {
    name: "imposter",
    article: "an",
    tagline: "Everyone knows the word except one of you. Say a clue. Don't be the one they catch.",
    sides: { town: "crew", mafia: "imposters", third: "third party" },
    sidesSingular: { town: "crew", mafia: "imposter", third: "third party" },
  },
};

/** `3 imposters` but `1 imposter`. */
export function liarsSideLabel(mode: LiarsMode, side: LiarsSide, count: number) {
  const copy = LIARS_MODE_COPY[mode];
  return count === 1 ? copy.sidesSingular[side] : copy.sides[side];
}

export const LIARS_DEFAULT_TOGGLES: LiarsToggles = {
  announceAttackTarget: true,
  revealRoleOnDeath: true,
  revealEjectedRole: true,
  jesterEndsGame: true,
  doctorRepeatTarget: false,
  coldOpen: false,
  blindImposters: false,
  simultaneousClues: false,
  cameraTorch: false,
  lastWords: true,
  graveyardVote: true,
  liveGodView: false,
  firstGame: false,
};

export function liarsDefaultTimings(roomMode: LiarsRoomMode): LiarsTimings {
  return {
    deal: 25_000,
    night: 45_000,
    dawn: 15_000,
    // A laggy call eats the first twenty seconds of any conversation.
    deliberation: roomMode === "remote" ? 90_000 : 60_000,
    vote: 30_000,
    verdict: 15_000,
    finalGuess: 30_000,
    clueTurn: 60_000,
  };
}

/**
 * The dusk lead-in. Identical on every device, and long enough to actually be useful: nothing
 * role-specific is on screen until it ends, so there is a real moment to turn your phone away from
 * whoever is sitting next to you. Two and a half seconds was a transition; five is a warning.
 */
export const LIARS_DUSK_MS = 5_000;
/** How long before the night ends the report card lands. */
export const LIARS_REPORT_LEAD_MS = 10_000;
/** Held for its full length and never dismissible — a fast tap would advertise a short card. */
export const LIARS_REPORT_HOLD_MS = 10_000;
export const LIARS_LAST_WORDS_MS = 30_000;
/** Each publicly corroborated movement gets its own beat in the reveal. */
export const LIARS_MOVEMENT_BEAT_MS = 1_500;
/** The dawn hold: three full seconds of dead before a revive can land. */
export const LIARS_DEATH_HOLD_MS = 3_000;
export const LIARS_DEATH_LANDS_MS = 3_000;
export const LIARS_CONNECTED_WINDOW_MS = 25_000;
export const LIARS_HOST_CLAIM_AFTER_MS = 60_000;

export function liarsNightDuration(timings: LiarsTimings, playerCount: number) {
  // Eleven people picking targets in 45 seconds is a scramble.
  return timings.night + Math.max(0, playerCount - 10) * 15_000;
}

function lineupOf(entries: Array<[LiarsRole, number]>): LiarsLineup {
  return { roles: Object.fromEntries(entries.filter(([, count]) => count > 0)) };
}

export function liarsDefaultLineup(
  mode: LiarsMode,
  playerCount: number,
  imposterCount?: number,
): LiarsLineup {
  if (mode === "imposter") {
    const range = liarsImposterRange(playerCount);
    const imposters = Math.min(
      range.max,
      Math.max(range.min, imposterCount ?? (playerCount >= 16 ? 3 : playerCount >= 10 ? 2 : 1)),
    );
    const understudy = playerCount >= 7 ? 1 : 0;
    const mole = playerCount >= 12 ? 1 : 0;
    return lineupOf([
      ["imposter", imposters],
      ["mole", mole],
      ["understudy", understudy],
      ["crew", playerCount - imposters - understudy - mole],
    ]);
  }

  const clamped = Math.min(
    LIARS_PLAYER_LIMITS.mafia.max,
    Math.max(LIARS_PLAYER_LIMITS.mafia.min, playerCount),
  );
  return { roles: { ...MAFIA_LINEUPS[clamped] } };
}

/**
 * Written out rather than derived. The mafia side lands at roughly one in four — the ratio that
 * produces three to five round games — and villagers stay numerous, because watch needs bodies and
 * a table where almost everyone holds a power role stops being a deduction game.
 */
const MAFIA_LINEUPS: Record<number, Partial<Record<LiarsRole, number>>> = {
  5: { mafia: 1, doctor: 1, detective: 1, villager: 2 },
  6: { mafia: 1, doctor: 1, detective: 1, villager: 3 },
  7: { godfather: 1, mafia: 1, doctor: 1, detective: 1, villager: 3 },
  8: { godfather: 1, mafia: 1, doctor: 1, detective: 1, lookout: 1, villager: 3 },
  9: { godfather: 1, mafia: 1, doctor: 1, detective: 1, lookout: 1, villager: 3, jester: 1 },
  10: { godfather: 1, mafia: 2, doctor: 1, detective: 1, lookout: 1, villager: 3, jester: 1 },
  11: {
    godfather: 1, mafia: 2, doctor: 1, detective: 1, lookout: 1, bodyguard: 1, villager: 3,
    jester: 1,
  },
  12: {
    godfather: 1, mafia: 1, jammer: 1, doctor: 1, detective: 1, lookout: 1, bodyguard: 1,
    villager: 4, jester: 1,
  },
  13: {
    godfather: 1, mafia: 2, jammer: 1, doctor: 1, detective: 1, lookout: 1, bodyguard: 1,
    villager: 4, jester: 1,
  },
  14: {
    godfather: 1, mafia: 2, jammer: 1, doctor: 1, detective: 1, lookout: 1, bodyguard: 1,
    escort: 1, villager: 4, jester: 1,
  },
  15: {
    godfather: 1, mafia: 2, jammer: 1, doctor: 1, detective: 1, lookout: 1, bodyguard: 1,
    escort: 1, villager: 5, jester: 1,
  },
  16: {
    godfather: 1, mafia: 2, jammer: 1, doctor: 1, detective: 1, lookout: 1, bodyguard: 1,
    escort: 1, vigilante: 1, villager: 5, jester: 1,
  },
};

/** How many imposters a table of this size can carry without the crew being hopeless. */
export function liarsImposterRange(playerCount: number) {
  return { min: 1, max: playerCount >= 13 ? 3 : playerCount >= 8 ? 2 : 1 };
}

/** The line on the setup screen, which was wrong the moment a host picked two. */
export function liarsImposterBlurb(imposters: number) {
  return imposters === 1
    ? "Everyone knows the word except one of you. Say a clue. Don't be the one they catch."
    : `Everyone knows the word except ${imposters === 2 ? "two" : "three"} of you. Say a clue. Don't be one of the ones they catch.`;
}

/** Doctor, detective and villagers only, at any player count. Twelve first-timers with nine roles is a disaster. */
export function liarsFirstGameLineup(mode: LiarsMode, playerCount: number): LiarsLineup {
  if (mode === "imposter") {
    const imposters = playerCount >= 10 ? 2 : 1;
    return lineupOf([
      ["imposter", imposters],
      ["crew", playerCount - imposters],
    ]);
  }
  const mafia = playerCount >= 10 ? 3 : playerCount >= 7 ? 2 : 1;
  return lineupOf([
    ["mafia", mafia],
    ["doctor", 1],
    ["detective", 1],
    ["villager", playerCount - mafia - 2],
  ]);
}

export function liarsLineupEntries(lineup: LiarsLineup) {
  return (Object.entries(lineup.roles) as Array<[LiarsRole, number]>).filter(
    ([, count]) => count > 0,
  );
}

export function liarsLineupTotal(lineup: LiarsLineup) {
  return liarsLineupEntries(lineup).reduce((total, [, count]) => total + count, 0);
}

export function liarsSideCounts(lineup: LiarsLineup) {
  const counts: Record<LiarsSide, number> = { town: 0, mafia: 0, third: 0 };
  for (const [role, count] of liarsLineupEntries(lineup)) counts[LIARS_ROLES[role].side] += count;
  return counts;
}

/**
 * How many ejections the town can get wrong before the mafia reach parity, assuming one death a
 * night. The number people actually read off the lobby board.
 */
export function liarsWrongVoteBudget(lineup: LiarsLineup) {
  const { town, mafia } = liarsSideCounts(lineup);
  if (mafia === 0 || town <= mafia) return 0;
  return Math.max(0, Math.ceil((town - mafia) / 2) - 1);
}

export interface LiarsLineupProblem {
  code:
    | "count_mismatch"
    | "mafia_parity"
    | "too_many_specials"
    | "not_enough_villagers"
    | "role_needs_players"
    | "too_many_copies"
    | "no_mafia"
    | "wrong_mode";
  message: string;
}

export function liarsValidateLineup(
  mode: LiarsMode,
  lineup: LiarsLineup,
  playerCount: number,
): { ok: true; warnings: LiarsLineupProblem[] } | { ok: false; problem: LiarsLineupProblem } {
  const entries = liarsLineupEntries(lineup);
  const warnings: LiarsLineupProblem[] = [];

  for (const [role, count] of entries) {
    const definition = LIARS_ROLES[role];
    if (definition.mode !== mode)
      return {
        ok: false,
        problem: { code: "wrong_mode", message: `the ${definition.name} does not play in ${mode}` },
      };
    if (count > definition.maxCopies)
      return {
        ok: false,
        problem: {
          code: "too_many_copies",
          message: `only ${definition.maxCopies} ${definition.name} allowed`,
        },
      };
  }

  const total = liarsLineupTotal(lineup);
  if (total !== playerCount)
    return {
      ok: false,
      problem: {
        code: "count_mismatch",
        message: `${total} roles for ${playerCount} players`,
      },
    };

  const { town, mafia } = liarsSideCounts(lineup);
  if (mafia === 0)
    return {
      ok: false,
      problem: {
        code: "no_mafia",
        message: mode === "mafia" ? "nobody is mafia" : "nobody is the imposter",
      },
    };
  if (mafia >= town)
    return {
      ok: false,
      problem: {
        code: "mafia_parity",
        message: `${mafia} ${LIARS_MODE_COPY[mode].sides.mafia} and ${town} ${LIARS_MODE_COPY[mode].sides.town} — they would start at parity`,
      },
    };

  if (mode === "mafia" && (lineup.roles.villager ?? 0) < LIARS_MIN_VILLAGERS)
    return {
      ok: false,
      problem: {
        code: "not_enough_villagers",
        message: "no plain villagers left — watch stops working",
      },
    };

  // Checked after the structural rules, so a host who has broken the shape of the game hears about
  // that first rather than about one role's minimum.
  for (const [role] of entries) {
    const definition = LIARS_ROLES[role];
    if (playerCount < definition.minPlayers)
      return {
        ok: false,
        problem: {
          code: "role_needs_players",
          message: `the ${definition.name} needs ${definition.minPlayers} players`,
        },
      };
  }

  const specials = entries.filter(([role]) => LIARS_ROLES[role].special).length;
  if (specials > LIARS_SPECIAL_HARD_CAP)
    return {
      ok: false,
      problem: {
        code: "too_many_specials",
        message: `${specials} special roles — ${LIARS_SPECIAL_HARD_CAP} is the ceiling`,
      },
    };
  if (specials > LIARS_SPECIAL_SOFT_CAP(playerCount))
    warnings.push({
      code: "too_many_specials",
      message: `${specials} special roles for ${playerCount} players — the day gets hard to follow`,
    });

  return { ok: true, warnings };
}

export function liarsSpecialCount(lineup: LiarsLineup) {
  return liarsLineupEntries(lineup).filter(([role]) => LIARS_ROLES[role].special).length;
}

/**
 * Deals the lineup across the roster. `pick` returns an integer in `[0, n)` — the engine passes
 * node's `randomInt`, tests pass something deterministic. A rematch weights against your previous
 * role so nobody draws mafia three times running.
 */
export function liarsDealRoles(input: {
  lineup: LiarsLineup;
  playerIds: string[];
  previousRoles?: Record<string, LiarsRole>;
  pick: (bound: number) => number;
}): Record<string, LiarsRole> {
  const pool: LiarsRole[] = [];
  for (const [role, count] of liarsLineupEntries(input.lineup))
    for (let index = 0; index < count; index += 1) pool.push(role);
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const swap = input.pick(index + 1);
    [pool[index], pool[swap]] = [pool[swap], pool[index]];
  }

  const dealt: Record<string, LiarsRole> = {};
  input.playerIds.forEach((playerId, index) => {
    dealt[playerId] = pool[index];
  });

  const previous = input.previousRoles;
  if (previous) {
    // Repair pass: swap anyone who drew their last role again with a partner the swap also suits.
    // Not every lineup can be fully deranged (five players, two of them villagers), so this
    // reduces repeats rather than promising none.
    for (const playerId of input.playerIds) {
      if (dealt[playerId] !== previous[playerId]) continue;
      const partner = input.playerIds.find(
        (other) =>
          other !== playerId &&
          dealt[other] !== dealt[playerId] &&
          dealt[other] !== previous[playerId] &&
          dealt[playerId] !== previous[other],
      );
      if (!partner) continue;
      [dealt[playerId], dealt[partner]] = [dealt[partner], dealt[playerId]];
    }
  }
  return dealt;
}

export function liarsRoleSide(role: LiarsRole): LiarsSide {
  return LIARS_ROLES[role].side;
}

/** Apparent alignment, which is what the detective reads. The godfather comes back innocent. */
export function liarsReadsGuilty(role: LiarsRole) {
  return LIARS_ROLES[role].side === "mafia" && role !== "godfather";
}

export interface LiarsWinInput {
  mode: LiarsMode;
  toggles: Pick<LiarsToggles, "jesterEndsGame">;
  alive: Array<{ playerId: string; role: LiarsRole }>;
  /** Set when a jester was just ejected. */
  ejectedJesterId?: string | null;
  /** Imposter mode only. */
  crewEjections?: number;
  imposterEjections?: number;
  finalGuessCorrect?: boolean | null;
}

export function liarsDetectWinner(input: LiarsWinInput): LiarsSide | null {
  if (input.mode === "mafia" && input.ejectedJesterId && input.toggles.jesterEndsGame)
    return "third";

  const mafiaAlive = input.alive.filter(({ role }) => liarsRoleSide(role) === "mafia").length;
  const townAlive = input.alive.filter(({ role }) => liarsRoleSide(role) === "town").length;

  if (input.mode === "imposter") {
    if (input.finalGuessCorrect === true) return "mafia";
    // The crew must find every imposter; the last one ejected gets the guess.
    if (mafiaAlive === 0) return input.finalGuessCorrect === null ? null : "town";
    if ((input.crewEjections ?? 0) >= 2) return "mafia";
    if (input.alive.length <= 3) return "mafia";
    return null;
  }

  if (mafiaAlive === 0) return "town";
  if (mafiaAlive >= townAlive) return "mafia";
  return null;
}

export interface LiarsTargetInput {
  mode: LiarsMode;
  role: LiarsRole;
  actorId: string;
  living: Array<{ playerId: string; role: LiarsRole }>;
  /** The doctor cannot protect the same person two nights running, themselves included. */
  previousTargetId?: string | null;
  toggles: Pick<LiarsToggles, "doctorRepeatTarget">;
}

export function liarsTargetableIds(input: LiarsTargetInput): string[] {
  const definition = LIARS_ROLES[input.role];
  if (!definition.actionLabel) return [];
  const actorSide = definition.side;
  return input.living
    .filter(({ playerId, role }) => {
      // Checked before the self case, because the doctor's repeat rule includes themselves.
      if (
        input.role === "doctor" &&
        !input.toggles.doctorRepeatTarget &&
        input.previousTargetId === playerId
      )
        return false;
      if (playerId === input.actorId) return definition.selfTarget;
      // Mafia never target their own, and the jammer never blocks their own.
      if (input.mode === "mafia" && actorSide === "mafia" && liarsRoleSide(role) === "mafia")
        return false;
      return true;
    })
    .map(({ playerId }) => playerId);
}

/** Watching is not a visit — you stay up watching their door. Everything else leaves the house. */
export function liarsActionMoves(role: LiarsRole, targetId: string | null) {
  return targetId !== null && LIARS_ROLES[role].moves;
}

/** Once half the table is gone, the graveyard's plurality becomes one extra ballot. */
export function liarsGraveyardArmsAt(playerCount: number) {
  return Math.ceil(playerCount / 2);
}

/**
 * Plurality: most votes ejects, a tie ejects nobody. Not majority-of-living — forced abstentions
 * from dropped phones would push ejections out of reach and deadlock the town into losing.
 */
export function liarsPlurality(votes: Array<{ targetId: string | null }>): string | null {
  const tally = new Map<string, number>();
  for (const { targetId } of votes) {
    if (!targetId) continue;
    tally.set(targetId, (tally.get(targetId) ?? 0) + 1);
  }
  let leader: string | null = null;
  let best = 0;
  let tied = false;
  for (const [targetId, count] of tally) {
    if (count > best) {
      leader = targetId;
      best = count;
      tied = false;
    } else if (count === best) tied = true;
  }
  return tied ? null : leader;
}
