import { Context, Effect, Layer } from "effect";

import { eventsOperation } from "@/features/events/events-operation.server";
import { runAdminScoringAction } from "./admin-api/actions.server";
import { readAdminScoring } from "./admin-api/read.server";
import { consumeOfficialResultWake } from "@/features/game-results/outbox.server";
import type { OfficialGameResultEnvelope } from "@/features/game-results/types";
import * as discoveryEngine from "./discoveries.server";
import * as gameClaimEngine from "./game-claims.server";
import * as groupClaimEngine from "./group-game-claims.server";
import { consumeOfficialGameResult } from "./games.server";
import * as offlineEngine from "./offline.server";
import * as scoringEngine from "./scoring.server";
import * as staffEngine from "./staff-scoring.server";
import { getStaffAwardClaimPreview } from "./staff-award-claims.server";
import { decideGuestRequest } from "@/features/tickets/guest-requests.server";

function operation<A>(name: string, run: (signal: AbortSignal) => Promise<A>, timeoutMs = 45_000) {
  return eventsOperation(
    {
      domain: "event-scoring",
      operation: name,
      kind: "idempotent-mutation",
      timeoutMs,
    },
    run,
  );
}

function readOperation<A>(name: string, run: (signal: AbortSignal) => Promise<A>) {
  return eventsOperation({ domain: "event-scoring", operation: name, timeoutMs: 20_000 }, run);
}

const read =
  <Args extends unknown[], Result>(name: string, run: (...args: Args) => Promise<Result>) =>
  (...args: Args) =>
    readOperation(name, () => run(...args));

const mutate =
  <Args extends unknown[], Result>(name: string, run: (...args: Args) => Promise<Result>) =>
  (...args: Args) =>
    operation(name, () => run(...args));

const publicLeaderboard = read("public_leaderboard", scoringEngine.publicLeaderboard);
const personalScore = read("personal_score", scoringEngine.personalScore);
const findDiscovery = read("find_discovery", discoveryEngine.findDiscoveryForPresented);
const getDiscovery = read("get_discovery", discoveryEngine.getDiscovery);
const getStaffAwardPreview = read("get_staff_award_preview", getStaffAwardClaimPreview);
const claimDiscovery = mutate("claim_discovery", discoveryEngine.claimDiscovery);
const claimGameResult = mutate("claim_game_result", gameClaimEngine.claimGamePlayerResult);
const readGroupClaim = read("read_group_claim", groupClaimEngine.readGroupGameClaimSession);
const claimGroupResult = mutate("claim_group_result", groupClaimEngine.claimGroupGameResult);

const getStaffPage = read("staff_page", staffEngine.getStaffScoringPage);
const searchStaffParticipants = read("staff_search", staffEngine.searchStaffParticipants);
const resolveStaffParticipant = read(
  "staff_resolve_participant",
  staffEngine.resolveStaffScannedParticipant,
);
const awardStaffPoints = mutate("staff_award", staffEngine.awardStaffPoints);
const mintStaffAward = mutate("staff_mint_award", staffEngine.mintStaffAwardClaim);
const admitStaffTicket = mutate("staff_admit", staffEngine.admitStaffTicket);
const scanStaffCheckpoint = mutate("staff_scan_checkpoint", staffEngine.scanStaffCheckpoint);
const shuffleStaffTeams = mutate("staff_shuffle_teams", staffEngine.shuffleStaffTeams);
const moveStaffTeamParticipant = mutate("staff_move_team", staffEngine.moveStaffTeamParticipant);
const reverseStaffAward = mutate("staff_reverse_award", staffEngine.reverseStaffAward);
const submitStaffGuest = mutate("staff_submit_guest", staffEngine.submitStaffGuest);
const decideStaffGuest = mutate("staff_decide_guest", staffEngine.decideStaffGuestRequest);
const decideAdminGuest = mutate("admin_decide_guest", decideGuestRequest);
const transferStaffPoints = mutate("staff_transfer_points", staffEngine.transferStaffPoints);
const acceptStaffHeldAction = mutate("staff_accept_held", staffEngine.acceptStaffHeldAction);
const setStaffGuestPhotos = mutate("staff_guest_photos", staffEngine.setStaffGuestPhotos);
const reserveOfflineBudget = mutate("offline_reserve", offlineEngine.reserveOfflineScoreBudget);
const reconcileOfflineCommands = mutate(
  "offline_reconcile",
  offlineEngine.reconcileOfflineScoreCommands,
);
const closeOfflineReservation = mutate("offline_close", offlineEngine.closeOfflineScoreReservation);
const runAdminAction = mutate("admin_action", runAdminScoringAction);
const readAdmin = read("admin_read", readAdminScoring);

const consumeWake = (envelopes: readonly OfficialGameResultEnvelope[]) =>
  operation("consume_wake", () =>
    consumeOfficialResultWake(envelopes, consumeOfficialGameResult),
  ).pipe(Effect.withSpan("event-scoring.official-results.wake"));

/**
 * Effect owns event-night orchestration; scoring, eligibility and balance rules stay in the
 * ordinary TypeScript engines and their transactional Postgres repositories.
 */
export class EventScoringService extends Context.Service<
  EventScoringService,
  {
    readonly consumeOfficialResult: (
      envelope: OfficialGameResultEnvelope,
    ) => Effect.Effect<boolean, unknown>;
    readonly consumeWake: typeof consumeWake;
    readonly publicLeaderboard: typeof publicLeaderboard;
    readonly personalScore: typeof personalScore;
    readonly findDiscovery: typeof findDiscovery;
    readonly getDiscovery: typeof getDiscovery;
    readonly getStaffAwardPreview: typeof getStaffAwardPreview;
    readonly claimDiscovery: typeof claimDiscovery;
    readonly claimGameResult: typeof claimGameResult;
    readonly readGroupClaim: typeof readGroupClaim;
    readonly claimGroupResult: typeof claimGroupResult;
    readonly getStaffPage: typeof getStaffPage;
    readonly searchStaffParticipants: typeof searchStaffParticipants;
    readonly resolveStaffParticipant: typeof resolveStaffParticipant;
    readonly awardStaffPoints: typeof awardStaffPoints;
    readonly mintStaffAward: typeof mintStaffAward;
    readonly admitStaffTicket: typeof admitStaffTicket;
    readonly scanStaffCheckpoint: typeof scanStaffCheckpoint;
    readonly shuffleStaffTeams: typeof shuffleStaffTeams;
    readonly moveStaffTeamParticipant: typeof moveStaffTeamParticipant;
    readonly reverseStaffAward: typeof reverseStaffAward;
    readonly submitStaffGuest: typeof submitStaffGuest;
    readonly decideStaffGuest: typeof decideStaffGuest;
    readonly decideAdminGuest: typeof decideAdminGuest;
    readonly transferStaffPoints: typeof transferStaffPoints;
    readonly acceptStaffHeldAction: typeof acceptStaffHeldAction;
    readonly setStaffGuestPhotos: typeof setStaffGuestPhotos;
    readonly reserveOfflineBudget: typeof reserveOfflineBudget;
    readonly reconcileOfflineCommands: typeof reconcileOfflineCommands;
    readonly closeOfflineReservation: typeof closeOfflineReservation;
    readonly readAdmin: typeof readAdmin;
    readonly runAdminAction: typeof runAdminAction;
  }
>()("EventScoringService") {
  // Historical scoring remains callable for explicit administrative recovery, but it owns no
  // process-global subscriber or scheduled work while the product is retired.
  static readonly layer = Layer.succeed(this, {
    acceptStaffHeldAction,
    setStaffGuestPhotos,
    admitStaffTicket,
    scanStaffCheckpoint,
    awardStaffPoints,
    claimDiscovery,
    claimGameResult,
    claimGroupResult,
    closeOfflineReservation,
    consumeOfficialResult: (envelope) =>
      operation("consume_official_result", () => consumeOfficialGameResult(envelope)),
    consumeWake,
    decideStaffGuest,
    decideAdminGuest,
    findDiscovery,
    getDiscovery,
    getStaffPage,
    getStaffAwardPreview,
    mintStaffAward,
    moveStaffTeamParticipant,
    personalScore,
    publicLeaderboard,
    readAdmin,
    readGroupClaim,
    reconcileOfflineCommands,
    reserveOfflineBudget,
    resolveStaffParticipant,
    reverseStaffAward,
    runAdminAction,
    searchStaffParticipants,
    shuffleStaffTeams,
    submitStaffGuest,
    transferStaffPoints,
  });
}
