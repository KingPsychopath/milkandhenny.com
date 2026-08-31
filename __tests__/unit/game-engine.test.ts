import { Effect } from "effect";
import { describe, expect, it } from "vitest";

import {
  applyGameCommand,
  gameRandomInt,
  gameRuleFailure,
  gameTransition,
  versionGameCommand,
  type GameContext,
} from "@/features/things/shared/game-engine";
import {
  gameWorkflowTestLayer,
  makeGameContext,
} from "@/features/things/shared/game-workflow-services.server";

describe("game engine contract", () => {
  it("should return state and domain events without adding runtime behavior", () => {
    const context: GameContext = { now: 42, newId: "action-1", randomValues: [0.25] };
    const transition = gameTransition(
      { score: Math.floor(context.randomValues[0] * 4), updatedAt: context.now },
      [{ id: context.newId, type: "score.changed" }],
    );

    expect(transition).toEqual({
      ok: true,
      value: {
        state: { score: 1, updatedAt: 42 },
        events: [{ id: "action-1", type: "score.changed" }],
      },
    });
  });

  it("should represent rule failures as values", () => {
    expect(gameRuleFailure({ code: "not_your_turn" })).toEqual({
      ok: false,
      error: { code: "not_your_turn" },
    });
  });

  it("should consume supplied randomness deterministically", () => {
    const pick = gameRandomInt({ now: 0, newId: "id", randomValues: [0.1, 0.9] });

    expect([pick(10), pick(10), pick(10)]).toEqual([1, 9, 1]);
  });

  it("should obtain clocks, IDs, and randomness from replaceable Effect services", async () => {
    const expected: GameContext = {
      now: 1_234,
      newId: "fixed-id",
      randomValues: [0.2, 0.8],
    };

    await expect(
      Effect.runPromise(makeGameContext(4).pipe(Effect.provide(gameWorkflowTestLayer(expected)))),
    ).resolves.toEqual({
      now: 1_234,
      newId: "fixed-id",
      randomValues: [0.2, 0.8, 0.2, 0.8],
    });
  });
});

describe("versioned pure game commands", () => {
  const context: GameContext = { now: 1_000, newId: "generated", randomValues: [0.25] };
  const command = versionGameCommand({
    game: "test",
    actionId: "action-1",
    actor: "player-1",
    action: { type: "score", points: 2 } as const,
  });
  const reduce = (
    state: { processedActions: string[]; score: number },
    current: typeof command,
    _supplied: GameContext,
  ) => {
    const replayed = state.processedActions.includes(current.actionId);
    if (!replayed) {
      state.score += current.action.points;
      state.processedActions.push(current.actionId);
    }
    return { replayed };
  };

  it("is deterministic for fixed state, command, clock, ID, and randomness", () => {
    const state: { processedActions: string[]; score: number } = {
      processedActions: [],
      score: 0,
    };
    expect(applyGameCommand(state, command, context, reduce)).toEqual(
      applyGameCommand(state, command, context, reduce),
    );
    expect(state).toEqual({ processedActions: [], score: 0 });
  });

  it("replays the same action ID without applying it twice", () => {
    const first = applyGameCommand(
      { processedActions: [] as string[], score: 0 },
      command,
      context,
      reduce,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = applyGameCommand(first.value.state, command, context, reduce);
    expect(replay).toMatchObject({
      ok: true,
      value: {
        state: { processedActions: ["action-1"], score: 2 },
        events: [{ schemaVersion: 1, type: "command.replayed" }],
      },
    });
  });
});
