import type {
  MultiplayerAction,
  MultiplayerFailure,
  MultiplayerRevision,
  MultiplayerRoomIdentity,
  MultiplayerRoomLifetime,
  MultiplayerSequence,
  MultiplayerSuccess,
} from "../shared/multiplayer";
import type { MultiplayerReadiness } from "../shared/multiplayer-readiness";

/** Two games, one room. Chosen at creation and fixed for the life of the room. */
export type LiarsMode = "mafia" | "imposter";

/** Changes narration routing, sound routing and deliberation length. See docs/liars.md §5.11. */
export type LiarsRoomMode = "same-room" | "remote";

export type LiarsMafiaRole =
  | "mafia"
  | "godfather"
  | "jammer"
  | "doctor"
  | "detective"
  | "lookout"
  | "bodyguard"
  | "escort"
  | "vigilante"
  | "villager"
  | "jester";

export type LiarsImposterRole = "crew" | "understudy" | "imposter" | "mole";

export type LiarsRole = LiarsMafiaRole | LiarsImposterRole;

/**
 * Sides are shared across both modes so win detection is one function. Imposter's crew and
 * understudy are "town"; its imposter and mole are "mafia". Players never see these words — the
 * mode's copy table supplies the names they read.
 */
export type LiarsSide = "town" | "mafia" | "third";

export type LiarsPhase =
  | "lobby"
  | "deal"
  | "night"
  | "dawn"
  | "clue"
  | "deliberation"
  | "vote"
  | "verdict"
  | "finalGuess"
  | "ending";

export type LiarsDeathCause = "killed" | "ejected" | "guilt" | "bodyguard" | "left";

/** Public facts about a player that are true *this round only*. Rows clear when the day ends. */
export type LiarsMark = "moved" | "pointed" | "saved" | "attacked";

export interface LiarsLineup {
  /** Role id to how many copies are dealt. Absent means zero. */
  roles: Partial<Record<LiarsRole, number>>;
}

export interface LiarsToggles {
  announceAttackTarget: boolean;
  revealRoleOnDeath: boolean;
  revealEjectedRole: boolean;
  jesterEndsGame: boolean;
  doctorRepeatTarget: boolean;
  coldOpen: boolean;
  blindImposters: boolean;
  simultaneousClues: boolean;
  cameraTorch: boolean;
  lastWords: boolean;
  graveyardVote: boolean;
  liveGodView: boolean;
  firstGame: boolean;
}

export interface LiarsTimings {
  deal: number;
  night: number;
  dawn: number;
  deliberation: number;
  vote: number;
  verdict: number;
  finalGuess: number;
  /** Failsafe only — never rendered as a countdown. */
  clueTurn: number;
}

export interface LiarsPlayerSummary {
  id: string;
  name: string;
  alive: boolean;
  connected: boolean;
  ready: boolean;
  host: boolean;
  /** Present only for yourself, your mafia teammates, and everyone once the game has ended. */
  role?: LiarsRole;
  deathRound: number | null;
  deathCause: LiarsDeathCause | null;
  /** This round's public facts. Never a running history — that lives behind a tap. */
  marks: LiarsMark[];
  savedCount: number;
  /** Public vote count, populated at verdict only. */
  votes?: number;
}

export interface LiarsHistoryEntry {
  round: number;
  phase: "night" | "day";
  /** Public, so every viewer receives the identical string. */
  text: string;
}

export interface LiarsKnowledgeEntry {
  round: number;
  subjectName: string | null;
  text: string;
}

/**
 * The T−10s card. Identical shape for every role — a name and one line — so the card cannot be
 * read from across a room. See docs/liars.md §5.7.
 */
export interface LiarsNightReport {
  id: string;
  subjectName: string | null;
  line: string;
  /** `→` moved, `·` stillness, null for roles whose report is not about movement. */
  glyph: "moved" | "still" | null;
}

export interface LiarsDeathEvent {
  playerId: string;
  name: string;
  /** Set when the doctor pulled them back, so the client can run the revive beat. */
  revived: boolean;
  /** Set when a bodyguard took the hit, naming who actually died. */
  substituteName: string | null;
  cause: LiarsDeathCause;
  role?: LiarsRole;
}

export interface LiarsDawnSnapshot {
  narration: string;
  /** Absolute timestamps so every device animates against one clock. */
  nameLandsAt: number;
  holdUntil: number;
  reviveAt: number | null;
  settleAt: number;
  deaths: LiarsDeathEvent[];
  /** Publicly corroborated movement — names only, never who watched. */
  movementSeen: string[];
  witnessCount: number | null;
  lastWords: Array<{ name: string; text: string }>;
}

export interface LiarsClueSnapshot {
  /** Whose turn it is, on every device. */
  currentPlayerId: string | null;
  /** Full order so people can see who is coming. */
  order: string[];
  doneIds: string[];
  round: number;
  /** Failsafe deadline. Never rendered as a countdown. */
  advancesAt: number;
  /**
   * Round a table everyone can see and hear whose turn it is, so tapping per turn is pure overhead
   * — the thing people had to be reminded to do. There, one person taps once when the circle has
   * been all the way round. On a call nobody can see anything, so the turn has to be handed over
   * explicitly and the phone has to shout about it.
   */
  handoff: "each-turn" | "one-tap";
  /**
   * Names who has already said the circle is finished. It takes two different people, so one
   * misplaced thumb cannot skip somebody's turn — and two is a check a double-tap is not, because
   * a double-tap is still one person making the same mistake twice.
   */
  finishedBy: string[];
}

export interface LiarsGraveyardSnapshot {
  /** Live from the moment you die; counts once `armed` is true. */
  armed: boolean;
  armsWhenDeadReaches: number;
  deadCount: number;
  /** Tally among the dead, visible to the dead only. */
  tally: Array<{ playerId: string; name: string; votes: number }>;
  yourVote: string | null;
  /** Populated at verdict for everyone, so the table sees the graveyard's ballot land. */
  verdictName?: string | null;
}

export interface LiarsPrivateState extends MultiplayerReadiness {
  playerId: string;
  role: LiarsRole;
  alive: boolean;
  /** Mafia teammates. Empty for everyone else, and for blind imposters. */
  allyIds: string[];
  /**
   * What your teammates have currently picked, live. Coordinating is the fun of being mafia, and
   * the caller needs to see the disagreement before they overrule it.
   */
  allyTargets: Array<{ playerId: string; targetId: string | null; locked: boolean }>;
  /** Whose pick actually happens if the mafia disagree — godfather, else longest-surviving. */
  callerPlayerId: string | null;
  /** Imposter mode: your word, or null if you are the imposter. */
  word: string | null;
  /**
   * Imposter mode: shown to everybody, imposter included. It is their only foothold — without it
   * they open on a random guess and are out on the first turn.
   */
  wordCategory: string | null;
  /**
   * A dozen words from the category, one of which was dealt. Everyone sees the same board — it is
   * what gives the imposter a line of attack instead of open space, and what forces the crew to be
   * specific enough to prove they know the word without handing it over.
   */
  wordBoard: string[];
  nightTarget: string | null;
  nightLocked: boolean;
  vote: string | null;
  voteLocked: boolean;
  readyToVote: boolean;
  pointedAt: string | null;
  report: LiarsNightReport | null;
  knowledge: LiarsKnowledgeEntry[];
  /** Ids this role may act on right now, already filtered for self and team. */
  targetableIds: string[];
  lastWordsOpen: boolean;
  lastWordsClosesAt: number | null;
  finalGuessOpen: boolean;
}

export interface LiarsSnapshot
  extends MultiplayerRoomIdentity, MultiplayerRevision, MultiplayerSequence {
  mode: LiarsMode;
  roomMode: LiarsRoomMode;
  phase: LiarsPhase;
  serverNow: number;
  expiresAt: number;
  gameNumber: number;
  round: number;
  /** Absolute, server-owned. Every device animates against these. */
  phaseStartedAt: number;
  phaseEndsAt: number;
  /** Night only: the lead-in before targets can be chosen, and the report moment. */
  nightOpensAt: number | null;
  reportAt: number | null;
  lineup: LiarsLineup;
  toggles: LiarsToggles;
  players: LiarsPlayerSummary[];
  /** Locks, never names. `6 of 8 have acted`. */
  actedCount: number;
  livingCount: number;
  readyToVoteCount: number;
  history: LiarsHistoryEntry[];
  dawn: LiarsDawnSnapshot | null;
  clue: LiarsClueSnapshot | null;
  graveyard: LiarsGraveyardSnapshot | null;
  /** Populated only at `ending`, when everything opens up. */
  ending: LiarsEndingSnapshot | null;
  narratorPlayerId: string | null;
  hostPlayerId: string | null;
  hostDisconnectedSince: number | null;
  player: LiarsPrivateState | null;
}

export interface LiarsEndingSnapshot {
  winner: LiarsSide;
  headline: string;
  roles: Array<{ playerId: string; name: string; role: LiarsRole }>;
  log: LiarsHistoryEntry[];
  awards: Array<{ label: string; name: string; detail: string }>;
  /** Imposter only. */
  word: string | null;
}

export interface LiarsRoomCredentials extends MultiplayerRoomLifetime {
  hostToken: string;
  joinToken: string;
}

export interface LiarsPlayerCredentials extends MultiplayerRoomLifetime {
  playerId: string;
  playerToken: string;
  hostToken?: string;
  snapshot: LiarsSnapshot;
}

export type LiarsRoomErrorCode = "room_unavailable" | "lineup_invalid";

export type LiarsJoinErrorCode =
  | "invite_expired"
  | "game_started"
  | "invalid_name"
  | "name_taken"
  | "room_full"
  | "room_unavailable";

export type LiarsRejectionCode =
  | "action_unavailable"
  | "not_alive"
  | "invalid_target"
  | "players_not_ready"
  | "lineup_invalid"
  | "phase_ended"
  | "already_locked"
  | "not_your_turn"
  | "not_host";

export type LiarsJoinResult =
  | MultiplayerSuccess<LiarsPlayerCredentials>
  | MultiplayerFailure<LiarsJoinErrorCode>;

export type LiarsSnapshotResult =
  | MultiplayerSuccess<{ snapshot: LiarsSnapshot }>
  | (MultiplayerFailure<"room_unavailable"> & { snapshot: null });

export type LiarsHostAction = MultiplayerAction &
  (
    | { type: "game.configure"; lineup?: LiarsLineup; toggles?: Partial<LiarsToggles>; timings?: Partial<LiarsTimings>; roomMode?: LiarsRoomMode }
    | { type: "game.start"; force?: boolean }
    | { type: "phase.extend" }
    | { type: "phase.pause" | "phase.resume" }
    | { type: "player.remove"; playerId: string }
    | { type: "game.replay" | "game.lobby" | "game.end" }
  );

export type LiarsPlayerAction = MultiplayerAction &
  (
    | { type: "readiness.set"; ready: boolean }
    | { type: "night.select"; round: number; targetId: string | null }
    | { type: "night.lock"; round: number }
    | { type: "day.point"; round: number; targetId: string | null }
    | { type: "day.readyToVote"; round: number; ready: boolean }
    | { type: "vote.cast"; round: number; targetId: string | null }
    | { type: "vote.lock"; round: number }
    | { type: "clue.said"; round: number }
    | { type: "clue.skip"; round: number; playerId: string }
    | { type: "clue.allSaid"; round: number }
    | { type: "words.last"; text: string }
    | { type: "graveyard.vote"; round: number; targetId: string | null }
    | { type: "guess.final"; text: string }
    | { type: "host.claim" }
  );

export type LiarsActionResult =
  | MultiplayerSuccess<{ accepted: true; snapshot: LiarsSnapshot }>
  | MultiplayerSuccess<{
      accepted: false;
      snapshot: LiarsSnapshot;
      errorCode: LiarsRejectionCode;
      error: string;
      retryable: boolean;
    }>
  | (MultiplayerFailure<LiarsRoomErrorCode> & { accepted: false; snapshot: null });
