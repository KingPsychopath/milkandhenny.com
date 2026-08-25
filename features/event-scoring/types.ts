/**
 * Shared event-scoring contracts and pure rules.
 *
 * This module is safe to import from the browser. Durable writes, secrets and
 * platform adapters belong in the server modules in this feature.
 */

export const SCORING_STATES = ["off", "ready", "live", "frozen", "closed"] as const;
export type ScoringState = (typeof SCORING_STATES)[number];

export const LEADERBOARD_VISIBILITIES = [
  "hidden",
  "preview",
  "public-live",
  "public-final",
] as const;
export type LeaderboardVisibility = (typeof LEADERBOARD_VISIBILITIES)[number];

export const ACTIVITY_STATUSES = [
  "draft",
  "scheduled",
  "live",
  "paused",
  "exhausted",
  "ended",
  "cancelled",
] as const;
export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

export const ACTIVITY_TEMPLATES = [
  "winner",
  "placement",
  "participation",
  "completion",
  "team-result",
  "audience-vote",
  "scan-to-award",
  "free-form",
  "check-in",
  "discovery",
] as const;
export type ActivityTemplate = (typeof ACTIVITY_TEMPLATES)[number];

export const SOURCE_TYPES = [
  "manual",
  "game",
  "discovery",
  "check-in",
  "transfer",
  "reversal",
  "correction",
] as const;
export type ScoreSourceType = (typeof SOURCE_TYPES)[number];

export const SCORE_TRANSACTION_STATUSES = ["accepted", "held", "rejected", "reversed"] as const;
export type ScoreTransactionStatus = (typeof SCORE_TRANSACTION_STATUSES)[number];

export const STAFF_ASSIGNMENT_STATUSES = ["active", "paused", "revoked", "expired"] as const;
export type StaffAssignmentStatus = (typeof STAFF_ASSIGNMENT_STATUSES)[number];

export const STAFF_ASSIGNMENT_TYPES = ["personal", "station"] as const;
export type StaffAssignmentType = (typeof STAFF_ASSIGNMENT_TYPES)[number];

export const STAFF_PERMISSIONS = [
  "admitTickets",
  "viewParticipantPoints",
  "awardPoints",
  "runActivities",
  "transferPoints",
  "reverseAwards",
  "reviewHeldActions",
  "manageActivities",
  "manageDiscoveries",
  "uploadActivityPhotos",
  "manageStaffAndPools",
  "resolveIdentity",
  "finalizeLeaderboard",
  "requestGuests",
  "addGuests",
  "approveRequests",
] as const;
export type StaffPermission = (typeof STAFF_PERMISSIONS)[number];
export type StaffPermissionSet = Record<StaffPermission, boolean>;

export const SCORE_REASON_CODES = [
  "winner",
  "placement",
  "participation",
  "completion",
  "team-result",
  "audience-vote",
  "check-in",
  "discovery",
  "penalty",
  "transfer",
  "reversal",
  "correction",
  "other",
] as const;
export type ScoreReasonCode = (typeof SCORE_REASON_CODES)[number];

export type ScoringSettings = {
  eventSlug: string;
  state: ScoringState;
  leaderboardVisibility: LeaderboardVisibility;
  scheduledStart?: string;
  scheduledEnd?: string;
  allowPreCheckinOnlinePoints: boolean;
  publicNames: "generated" | "choice" | "canonical";
  publicRankingPolicy: "include" | "exclude-refunded" | "exclude-disqualified";
  photoConsentPolicy: "ask" | "required" | "not-required";
  allowStaffSelfAwards: boolean;
  revision: number;
};

export type ScoreRule = {
  mode: "fixed" | "raw-normalized" | "placement" | "participation" | "diminishing";
  fixedPoints?: number;
  pointsPerUnit?: number;
  maximumPoints?: number;
  placementPoints?: Record<string, number>;
  participationPoints?: number;
  tiers?: number[];
  repeat: "once" | "repeat" | "once-per-source";
  requiresCheckIn: boolean;
};

export type ScoreActivity = {
  id: string;
  eventSlug: string;
  name: string;
  template: ActivityTemplate;
  status: ActivityStatus;
  rule: ScoreRule;
  ruleRevision: number;
  startsAt?: string;
  endsAt?: string;
  pointPoolId?: string;
};

export type ScoreParticipant = {
  id: string;
  eventSlug: string;
  personId?: string;
  ticketId?: string;
  generatedAlias: string;
  chosenAlias?: string;
  canonicalName?: string;
  /** Effective private-facing alias: chosen alias when present, otherwise generated. */
  publicAlias: string;
  displayMode: "alias" | "anonymous" | "hidden";
  displayName?: string;
  teamName?: string;
  status: "active" | "refunded" | "void" | "disqualified" | "merged";
  checkedInAt?: string;
};

export function leaderboardNameFor(
  policy: ScoringSettings["publicNames"],
  participant: Pick<ScoreParticipant, "generatedAlias" | "chosenAlias" | "canonicalName">,
): string {
  if (policy === "choice") return participant.chosenAlias ?? participant.generatedAlias;
  if (policy === "canonical") return participant.canonicalName ?? participant.generatedAlias;
  return participant.generatedAlias;
}

export type ScorePosting = {
  participantId: string;
  points: number;
  teamId?: string;
};

export type ScoreTransaction = {
  id: string;
  eventSlug: string;
  activityId?: string;
  sourceType: ScoreSourceType;
  sourceId: string;
  idempotencyKey: string;
  status: ScoreTransactionStatus;
  reasonCode: ScoreReasonCode;
  note?: string;
  ruleRevision?: number;
  actorType: "system" | "admin" | "staff" | "attendee";
  actorId?: string;
  stationId?: string;
  deviceId?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  postings: ScorePosting[];
};

export type ScoreProjection = {
  participantId: string;
  balance: number;
  revision: number;
  lastTransactionAt?: string;
};

export type RankedScore = ScoreProjection & {
  rank: number;
  publicAlias: string;
  displayMode?: ScoreParticipant["displayMode"];
  teamId?: string;
  teamName?: string;
};

export type ScorePool = {
  id: string;
  issued: number;
  reserved: number;
  spent: number;
  held: number;
};

export type ScoreTeam = {
  id: string;
  eventSlug: string;
  name: string;
  status: "active" | "archived";
};

export type ScoreTeamMembership = {
  id: string;
  eventSlug: string;
  teamId: string;
  participantId: string;
  startsAt: string;
  endsAt?: string;
};

export type ScoreNotification = {
  id: string;
  participantId: string;
  transactionId: string;
  kind: "positive" | "negative" | "held" | "reversal";
  points: number;
  reasonCode: ScoreReasonCode;
  deliveredAt?: string;
  createdAt: string;
};

export type ScoreAuditEvent = {
  id: number;
  eventSlug: string;
  action: string;
  actorType: string;
  actorId?: string;
  assignmentId?: string;
  stationId?: string;
  deviceId?: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type ScoreMediaLink = {
  id: string;
  eventSlug: string;
  activityId?: string;
  transactionId?: string;
  participantId?: string;
  staffActorId?: string;
  storageRef: string;
  visibility: "event-album" | "admin-evidence" | "discard";
  consentState: "not-requested" | "requested" | "obtained" | "declined";
  expiresAt?: string;
  deletedAt?: string;
};

export type DiscoveryPointMode =
  | "none"
  | "once"
  | "fixed-pool"
  | "first-claimants"
  | "one-winner"
  | "diminishing"
  | "per-clue"
  | "completion"
  | "per-clue-plus-completion";

export type DiscoveryClaimState = "accepted" | "held" | "rejected";

type DiscoveryRuleBase = {
  pointMode: DiscoveryPointMode;
  pointsPerClue?: number;
  completionBonus?: number;
  poolPoints?: number;
  claimantLimit?: number;
  tiers?: number[];
  requiresCheckIn: boolean;
  eligibleTicketTypeIds?: string[];
  eligibleTeamIds?: string[];
  startsAt?: string;
  endsAt?: string;
  remainderAward: "discard" | "award";
};

export type DiscoveryRule = DiscoveryRuleBase &
  (
    | {
        claimFrequency: "once";
      }
    | {
        claimFrequency: "cooldown";
        cooldownSeconds: number;
        maximumClaimsPerParticipant?: number;
      }
  );

export function isScoringState(value: unknown): value is ScoringState {
  return typeof value === "string" && SCORING_STATES.includes(value as ScoringState);
}

export function isLeaderboardVisibility(value: unknown): value is LeaderboardVisibility {
  return (
    typeof value === "string" && LEADERBOARD_VISIBILITIES.includes(value as LeaderboardVisibility)
  );
}

/** Scoring is event-local and defaults to closed until an admin starts it. */
export function canAcceptScore(
  settings: Pick<ScoringSettings, "state">,
  action: "normal" | "correction" | "held-result",
): boolean {
  if (settings.state === "live")
    return action === "normal" || action === "correction" || action === "held-result";
  if (settings.state === "frozen") return action === "held-result";
  if (settings.state === "closed") return action === "correction";
  return false;
}

export function isWithinWindow(now: number, startsAt?: string, endsAt?: string): boolean {
  const start = startsAt ? Date.parse(startsAt) : Number.NEGATIVE_INFINITY;
  const end = endsAt ? Date.parse(endsAt) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(start) && startsAt) return false;
  if (!Number.isFinite(end) && endsAt) return false;
  return now >= start && now <= end;
}

export function activityCanAccept(
  activity: Pick<ScoreActivity, "status" | "startsAt" | "endsAt">,
  now = Date.now(),
): boolean {
  return (
    (activity.status === "live" || activity.status === "scheduled") &&
    isWithinWindow(now, activity.startsAt, activity.endsAt)
  );
}

/** Convert a raw game result or configured placement into event-local points. */
export function convertRulePoints(
  rule: ScoreRule,
  input: { rawScore?: number; placement?: number },
): number {
  let points = 0;
  switch (rule.mode) {
    case "fixed":
      points = rule.fixedPoints ?? 0;
      break;
    case "raw-normalized":
      points = Math.round((input.rawScore ?? 0) * (rule.pointsPerUnit ?? 1));
      break;
    case "placement":
      points = rule.placementPoints?.[String(input.placement ?? 0)] ?? 0;
      break;
    case "participation":
      points = rule.participationPoints ?? 0;
      break;
    case "diminishing":
      points = rule.tiers?.[(input.placement ?? 1) - 1] ?? 0;
      break;
  }
  const limited = rule.maximumPoints === undefined ? points : Math.min(points, rule.maximumPoints);
  return Number.isFinite(limited) ? Math.max(0, Math.trunc(limited)) : 0;
}

/** Standard competition rank: 1, 2, 2, 4. The secondary sort never changes rank. */
export function rankScores(
  scores: readonly (ScoreProjection & {
    publicAlias: string;
    displayMode?: ScoreParticipant["displayMode"];
    teamId?: string;
    teamName?: string;
  })[],
): RankedScore[] {
  const sorted = [...scores].sort(
    (left, right) =>
      right.balance - left.balance ||
      left.publicAlias.localeCompare(right.publicAlias) ||
      left.participantId.localeCompare(right.participantId),
  );
  let previousBalance: number | undefined;
  let previousRank = 0;
  return sorted.map((score, index) => {
    const rank = score.balance === previousBalance ? previousRank : index + 1;
    previousBalance = score.balance;
    previousRank = rank;
    return { ...score, rank };
  });
}

export function hasUnresolvedTie(scores: readonly RankedScore[], prizeSlots = 1): boolean {
  return scores.filter((score) => score.rank <= prizeSlots).length > prizeSlots;
}

export function poolAvailable(
  pool: Pick<ScorePool, "issued" | "reserved" | "spent" | "held">,
): number {
  return Math.max(0, pool.issued - pool.reserved - pool.spent - pool.held);
}

export function reservePoolPoints(pool: ScorePool, points: number): ScorePool | null {
  const amount = Math.trunc(points);
  if (amount <= 0 || poolAvailable(pool) < amount) return null;
  return { ...pool, reserved: pool.reserved + amount };
}

export function consumePoolReservation(pool: ScorePool, points: number): ScorePool | null {
  const amount = Math.trunc(points);
  if (amount <= 0 || pool.reserved < amount) return null;
  return { ...pool, reserved: pool.reserved - amount, spent: pool.spent + amount };
}

export function releasePoolReservation(pool: ScorePool, points: number): ScorePool | null {
  const amount = Math.trunc(points);
  if (amount <= 0 || pool.reserved < amount) return null;
  return { ...pool, reserved: pool.reserved - amount };
}

/** Codes are human-entered. Collapse whitespace and case, but never remove characters. */
export function normalizeDiscoveryCode(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleUpperCase("en-GB");
}

export function discoveryClaimPoints(
  rule: DiscoveryRule,
  claimNumber: number,
  completed: boolean,
): number {
  let points = 0;
  switch (rule.pointMode) {
    case "none":
      points = 0;
      break;
    case "once":
      points = rule.pointsPerClue ?? 0;
      break;
    case "fixed-pool":
    case "first-claimants":
    case "one-winner":
      points = rule.tiers?.[claimNumber - 1] ?? rule.pointsPerClue ?? rule.poolPoints ?? 0;
      break;
    case "diminishing":
      points = rule.tiers?.[claimNumber - 1] ?? 0;
      break;
    case "per-clue":
      points = rule.pointsPerClue ?? 0;
      break;
    case "completion":
      points = completed ? (rule.completionBonus ?? 0) : 0;
      break;
    case "per-clue-plus-completion":
      points = (rule.pointsPerClue ?? 0) + (completed ? (rule.completionBonus ?? 0) : 0);
      break;
  }
  return Math.max(0, Math.trunc(points));
}

export type IdentityEvidenceKind =
  | "ticket-possession"
  | "verified-email"
  | "authenticated-account"
  | "signed-claim"
  | "name"
  | "unverified-email"
  | "browser"
  | "device"
  | "ip"
  | "order"
  | "nickname";

export function identityEvidenceStrength(kind: IdentityEvidenceKind): "strong" | "weak" {
  return ["ticket-possession", "verified-email", "authenticated-account", "signed-claim"].includes(
    kind,
  )
    ? "strong"
    : "weak";
}

export function canAutomaticallyMergeIdentity(kinds: readonly IdentityEvidenceKind[]): boolean {
  return kinds.length > 0 && kinds.every((kind) => identityEvidenceStrength(kind) === "strong");
}

export type ClientCommandState = "pending" | "accepted" | "held" | "rejected";
export type ClientCommand = { id: string; state: ClientCommandState; localSequence: number };

/** Server revisions win. A rejected command never overwrites a confirmed balance. */
export function reconcileCommands(
  commands: readonly ClientCommand[],
  acknowledged: ReadonlyMap<string, ClientCommandState>,
): ClientCommand[] {
  return [...commands]
    .map((command) => ({ ...command, state: acknowledged.get(command.id) ?? command.state }))
    .sort((left, right) => left.localSequence - right.localSequence);
}

export function shouldNotifyScoreChange(
  source: ScoreSourceType,
  activeGameplay: boolean,
  lastNotifiedTransactionId: string | undefined,
  transactionId: string,
): boolean {
  return !activeGameplay && source !== "transfer" && lastNotifiedTransactionId !== transactionId;
}
