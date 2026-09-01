import { afterEach, describe, expect, it, vi } from "vitest";

import {
  canAcceptScore,
  consumePoolReservation,
  convertRulePoints,
  discoveryClaimPoints,
  hasUnresolvedTie,
  identityEvidenceStrength,
  leaderboardNameFor,
  maximumRulePoints,
  normalizeDiscoveryCode,
  poolAvailable,
  rankScores,
  reconcileCommands,
  reservePoolPoints,
  scoreRuleBalanceError,
  SCORE_ECONOMY,
  type ScorePool,
} from "@/features/event-scoring/types";
import {
  createScoreRequestDeadline,
  hasRememberedScoreSession,
  nextRetryDelayMs,
  reconcileSnapshot,
  rememberScoreSession,
  shouldRetryScoreResponse,
} from "@/features/event-scoring/client-sync";
import { discoveryCredential } from "@/features/event-scoring/discoveries.server";
import { simulateScoreClaim, TEST_SCENARIOS } from "@/features/event-scoring/test-mode";
import { formatDiscoveryCooldown } from "@/features/event-scoring/ui/useDiscoveryCooldown";
import {
  parseScoreRealtimeEvent,
  scoreRealtimePayload,
} from "@/features/event-scoring/score-realtime";

describe("event scoring rules", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("keeps score sync usable when browser marker storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
      setItem: vi.fn(() => {
        throw new DOMException("Blocked", "SecurityError");
      }),
    });

    expect(() => rememberScoreSession()).not.toThrow();
    expect(hasRememberedScoreSession()).toBe(false);
  });

  it("validates score wake-ups before delivering them to ticket streams", () => {
    expect(
      parseScoreRealtimeEvent({
        eventSlug: "summer-night",
        transactionId: "score-1",
        participantIds: ["participant-1"],
      }),
    ).toEqual({
      eventSlug: "summer-night",
      transactionId: "score-1",
      participantIds: ["participant-1"],
    });
    expect(parseScoreRealtimeEvent({ eventSlug: "summer-night", transactionId: 1 })).toBeNull();
    expect(
      parseScoreRealtimeEvent({
        eventSlug: "summer-night",
        transactionId: "score-1",
        participantIds: [null],
      }),
    ).toBeNull();
  });

  it("falls back to an event-wide wake-up before PostgreSQL's notify limit", () => {
    const payload = scoreRealtimePayload({
      eventSlug: "summer-night",
      transactionId: "score-1",
      participantIds: Array.from({ length: 1_000 }, (_, index) => `participant-${index}`),
    });

    expect(new TextEncoder().encode(payload).byteLength).toBeLessThan(7_900);
    expect(JSON.parse(payload)).toEqual({ eventSlug: "summer-night", transactionId: "score-1" });
  });

  it("aborts a score refresh that exceeds its request deadline", () => {
    vi.useFakeTimers();
    const deadline = createScoreRequestDeadline(10_000);

    expect(deadline.signal.aborted).toBe(false);
    vi.advanceTimersByTime(10_000);
    expect(deadline.signal.aborted).toBe(true);
  });

  it("keeps scoring off until an explicit live state", () => {
    expect(canAcceptScore({ state: "off" }, "normal")).toBe(false);
    expect(canAcceptScore({ state: "ready" }, "normal")).toBe(false);
    expect(canAcceptScore({ state: "live" }, "normal")).toBe(true);
    expect(canAcceptScore({ state: "frozen" }, "held-result")).toBe(true);
    expect(canAcceptScore({ state: "closed" }, "normal")).toBe(false);
  });

  it("converts rule revisions without changing previous rule results", () => {
    const rule = {
      mode: "raw-normalized" as const,
      pointsPerUnit: 2,
      maximumPoints: 10,
      repeat: "once" as const,
      requiresCheckIn: false,
    };
    expect(convertRulePoints(rule, { rawScore: 4 })).toBe(8);
    expect(convertRulePoints({ ...rule, maximumPoints: 5 }, { rawScore: 4 })).toBe(5);
  });

  it("keeps every configured outcome inside the shared event-night score ceiling", () => {
    const winner = {
      mode: "placement" as const,
      placementPoints: { "1": 10, "2": 5, "3": 3 },
      repeat: "once-per-source" as const,
      requiresCheckIn: true,
    };
    expect(maximumRulePoints(winner)).toBe(10);
    expect(scoreRuleBalanceError(winner)).toBeUndefined();
    expect(
      scoreRuleBalanceError({
        ...winner,
        placementPoints: { "1": SCORE_ECONOMY.maximumSingleAward + 1 },
      }),
    ).toContain(`${SCORE_ECONOMY.maximumSingleAward} points`);
  });

  it("assigns standard competition ranks while keeping deterministic order", () => {
    const ranked = rankScores([
      { participantId: "b", balance: 10, revision: 1, publicAlias: "bravo" },
      { participantId: "a", balance: 10, revision: 1, publicAlias: "alpha" },
      { participantId: "c", balance: 4, revision: 1, publicAlias: "charlie" },
    ]);
    expect(ranked.map((row) => [row.publicAlias, row.rank])).toEqual([
      ["alpha", 1],
      ["bravo", 1],
      ["charlie", 3],
    ]);
    expect(hasUnresolvedTie(ranked, 1)).toBe(true);
  });

  it("does not overspend a point pool", () => {
    const pool: ScorePool = { id: "pool", issued: 10, reserved: 0, spent: 2, held: 1 };
    expect(poolAvailable(pool)).toBe(7);
    const reserved = reservePoolPoints(pool, 7);
    expect(reserved && poolAvailable(reserved)).toBe(0);
    expect(reservePoolPoints(pool, 8)).toBeNull();
    expect(consumePoolReservation(reserved!, 7)?.spent).toBe(9);
  });

  it("normalizes human discovery codes without collapsing characters", () => {
    expect(normalizeDiscoveryCode("  three   words ")).toBe("THREE WORDS");
    expect(normalizeDiscoveryCode("Ａ-7")).toBe("A-7");
    expect(
      discoveryClaimPoints(
        {
          pointMode: "diminishing",
          tiers: [10, 5],
          claimFrequency: "once",
          requiresCheckIn: false,
          remainderAward: "discard",
        },
        2,
        false,
      ),
    ).toBe(5);
    expect(formatDiscoveryCooldown(272)).toBe("04:32");
  });

  it("keeps printed discovery credentials stable per replacement revision", () => {
    const first = discoveryCredential({ discoveryId: "disc_1", method: "qr", revision: 1 });
    expect(first).toBe(discoveryCredential({ discoveryId: "disc_1", method: "qr", revision: 1 }));
    expect(first).not.toBe(
      discoveryCredential({ discoveryId: "disc_1", method: "qr", revision: 2 }),
    );
    expect(first.startsWith("clue_")).toBe(true);
  });

  it("keeps weak identity signals out of automatic resolution", () => {
    expect(identityEvidenceStrength("name")).toBe("weak");
    expect(identityEvidenceStrength("verified-email")).toBe("strong");
  });

  it("selects generated, chosen, and verified canonical leaderboard names explicitly", () => {
    const participant = {
      generatedAlias: "guest-1234",
      chosenAlias: "Night Owl",
      canonicalName: "Alice Smith",
    };
    expect(leaderboardNameFor("generated", participant)).toBe("guest-1234");
    expect(leaderboardNameFor("choice", participant)).toBe("Night Owl");
    expect(leaderboardNameFor("canonical", participant)).toBe("Alice Smith");
    expect(leaderboardNameFor("canonical", { ...participant, canonicalName: undefined })).toBe(
      "guest-1234",
    );
  });

  it("reconciles by command id and never replaces a newer snapshot with an older one", () => {
    const commands = [{ id: "a", state: "pending" as const, localSequence: 1 }];
    expect(reconcileCommands(commands, new Map([["a", "accepted" as const]]))[0]?.state).toBe(
      "accepted",
    );
    const current = {
      eventSlug: "party",
      participantId: "p",
      balance: 9,
      revision: 2,
      synchronizedAt: "later",
    };
    expect(
      reconcileSnapshot(current, { ...current, balance: 1, revision: 1, synchronizedAt: "older" })
        .balance,
    ).toBe(9);
    expect(shouldRetryScoreResponse(400, 0)).toBe(false);
    expect(shouldRetryScoreResponse(503, 0)).toBe(true);
    expect(nextRetryDelayMs(2, 0)).toBe(1500);
  });

  it("rehearses every test mode outcome without a live mutation", () => {
    const outcomes = TEST_SCENARIOS.map((scenario) =>
      simulateScoreClaim({
        scenario,
        status: "live",
        rule: { mode: "fixed", fixedPoints: 5, repeat: "once", requiresCheckIn: false },
        previewPoints: 5,
      }),
    );
    expect(outcomes.map((outcome) => outcome.state)).toEqual([
      "accepted",
      "rejected",
      "rejected",
      "rejected",
      "held",
      "held",
    ]);
    expect(outcomes.every((outcome) => outcome.ledgerWrites === 0)).toBe(true);
    expect(outcomes.every((outcome) => outcome.poolChange === 0)).toBe(true);
    expect(outcomes.every((outcome) => outcome.rankChange === 0)).toBe(true);
  });
});
