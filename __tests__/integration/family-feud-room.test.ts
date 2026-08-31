import { describe, expect, it, vi } from "vitest";

import {
  applyFamilyFeudBuzzerAction,
  applyFamilyFeudControllerAction,
  createFamilyFeudRoom,
  pairFamilyFeudController,
  readFamilyFeudSnapshot,
} from "@/features/things/family-feud/family-feud-room-engine.server";
import type {
  FamilyFeudControllerAction,
  FamilyFeudSnapshot,
} from "@/features/things/family-feud/types";
import type { MultiplayerActionInput } from "@/features/things/shared/multiplayer";

function actionSender(roomId: string, controllerToken: string) {
  let index = 0;
  return async (action: MultiplayerActionInput<FamilyFeudControllerAction>) => {
    index += 1;
    const result = await applyFamilyFeudControllerAction({
      roomId,
      controllerToken,
      action: { ...action, actionId: `test-action-${index}` } as FamilyFeudControllerAction,
    });
    expect(result.ok).toBe(true);
    expect(result.accepted).toBe(true);
    return result.snapshot!;
  };
}

describe("Family Feud room", () => {
  it("replays a lost one-time controller pairing response without creating a new authority", async () => {
    const room = await createFamilyFeudRoom({ rounds: 4 });
    const controllerToken = "browser-generated-controller-recovery-token";
    const first = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
      controllerToken,
    });
    const recovered = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
      controllerToken,
    });

    expect(first).toMatchObject({ ok: true, controllerToken });
    expect(recovered).toMatchObject({ ok: true, controllerToken });
    expect(
      await pairFamilyFeudController({
        roomId: room.roomId,
        pairingToken: room.controllerPairingToken,
        controllerToken: "different-controller-token",
      }),
    ).toMatchObject({ ok: false, errorCode: "pairing_used" });
  });

  it("pairs one MC once, redacts the TV, and runs face-off, main and steal scoring", async () => {
    const room = await createFamilyFeudRoom({
      deckId: "everyday-life",
      rounds: 4,
      teams: [
        { name: "North", playerCount: 3 },
        { name: "South", playerCount: 2 },
      ],
    });
    const paired = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
    });
    expect(paired.ok).toBe(true);
    if (!paired.ok) return;
    expect(
      await pairFamilyFeudController({
        roomId: room.roomId,
        pairingToken: room.controllerPairingToken,
      }),
    ).toMatchObject({ ok: false, errorCode: "pairing_used" });
    const send = actionSender(room.roomId, paired.controllerToken);
    expect((await send({ type: "game.start" })).phase).toBe("rules");
    let controller = await send({ type: "phase.advance" });
    expect(controller.phase).toBe("practice");
    controller = await send({
      type: "answer.reveal",
      answerId: controller.round!.answers[0]!.id,
    });
    expect(controller.cue?.kind).toBe("correct");
    expect(controller.round?.answers[0]?.shown).toBe(true);
    controller = await send({ type: "phase.advance" });
    expect(controller.phase).toBe("round-intro");
    expect(controller.round?.prompt).toBeTruthy();
    expect(controller.round).toMatchObject({ cardLocked: false, candidatePosition: 1 });
    expect(controller.round?.candidateTotal).toBeGreaterThan(1);
    expect(controller.round?.deckName).toBe("Everyday life");
    const firstCandidateId = controller.round!.cardId;
    controller = await send({ type: "card.next" });
    expect(controller.round?.cardId).not.toBe(firstCandidateId);
    controller = await send({ type: "card.previous" });
    expect(controller.round?.cardId).toBe(firstCandidateId);

    const prematureHouseAnswer = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: {
        type: "house-answer.add",
        label: "Not while the TV is hidden",
        actionId: "premature-house-answer",
      },
    });
    expect(prematureHouseAnswer).toMatchObject({
      accepted: false,
      errorCode: "action_unavailable",
    });

    const presenterIntro = await readFamilyFeudSnapshot({
      roomId: room.roomId,
      role: "presenter",
      credential: room.presenterToken,
    });
    expect(presenterIntro.ok && presenterIntro.snapshot?.round?.prompt).toBeUndefined();
    expect(presenterIntro.ok && presenterIntro.snapshot?.round?.deckName).toBeUndefined();
    expect(
      presenterIntro.ok && presenterIntro.snapshot?.round?.answers.every(({ label }) => !label),
    ).toBe(true);

    controller = await send({ type: "card.use" });
    expect(controller.phase).toBe("category");
    expect(controller.round?.cardLocked).toBe(true);
    controller = await send({ type: "round.replace" });
    expect(controller.phase).toBe("round-intro");
    expect(controller.round?.cardId).not.toBe(firstCandidateId);
    expect(controller.round?.cardLocked).toBe(false);
    controller = await send({ type: "card.use" });
    expect(controller.phase).toBe("category");
    controller = await send({ type: "faceoff.open" });
    expect(controller.phase).toBe("faceoff");
    const buzz = await applyFamilyFeudBuzzerAction({
      roomId: room.roomId,
      buzzerToken: room.buzzerToken,
      action: { actionId: "buzz-one", type: "buzzer.hit", teamId: "two" },
    });
    expect(buzz.accepted).toBe(true);
    expect(buzz.snapshot?.cue?.kind).toBe("buzz");
    controller = await readController(room.roomId, paired.controllerToken);
    const first = controller.round!.answers[0]!;
    expect(first.boardValue).toBe(10);
    controller = await send({ type: "answer.reveal", answerId: first.id });
    expect(controller.phase).toBe("main-ready");
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(10);
    expect(controller.cue).toMatchObject({ kind: "correct", teamId: "two", points: 10 });
    controller = await send({ type: "undo.last" });
    expect(controller.phase).toBe("faceoff");
    expect(controller.round?.faceoffTeamId).toBe("two");
    expect(controller.round?.answers[0]).toMatchObject({ revealed: false });
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(0);
    controller = await send({ type: "answer.reveal", answerId: first.id });
    expect(controller.phase).toBe("main-ready");
    const lockedReplacement = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "round.replace", actionId: "replace-after-answer" },
    });
    expect(lockedReplacement).toMatchObject({
      accepted: false,
      errorCode: "action_unavailable",
    });
    controller = await send({ type: "phase.advance" });
    expect(controller.cue?.kind).toBe("open");
    controller = await send({ type: "timer.pause" });
    expect(controller.round).toMatchObject({ paused: true, phaseEndsAt: 0 });
    expect(controller.round!.pausedRemainingMs).toBeGreaterThan(0);
    controller = await send({ type: "timer.resume" });
    expect(controller.round).toMatchObject({ paused: false, pausedRemainingMs: 0 });
    expect(controller.round!.phaseEndsAt).toBeGreaterThan(Date.now());
    const second = controller.round!.answers[1]!;
    controller = await send({ type: "answer.reveal", answerId: second.id });
    expect(controller.teams.find(({ id }) => id === "one")?.score).toBe(9);
    const third = controller.round!.answers[2]!;
    controller = await send({ type: "house-answer.add", label: third.label! });
    expect(controller.round?.answers[2]).toMatchObject({ revealed: true, points: 8 });
    expect(controller.round?.houseAnswers).toHaveLength(0);
    expect(controller.teams.find(({ id }) => id === "one")?.score).toBe(17);
    expect(controller.cue).toMatchObject({ kind: "correct", teamId: "one", points: 8 });
    controller = await send({
      type: "house-answer.add",
      label: "A genuinely new room answer",
    });
    expect(controller.round?.houseAnswers).toHaveLength(1);
    expect(controller.round?.houseAnswers[0]?.points).toBe(1);
    expect(controller.teams.find(({ id }) => id === "one")?.score).toBe(18);
    const duplicateHouseAnswer = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: {
        type: "house-answer.add",
        label: "a genuinely new room answer!",
        actionId: "duplicate-house-answer",
      },
    });
    expect(duplicateHouseAnswer).toMatchObject({
      accepted: false,
      errorCode: "already_revealed",
    });
    controller = await send({ type: "phase.advance" });
    expect(controller.phase).toBe("steal-ready");
    controller = await send({ type: "phase.advance" });
    expect(controller.cue?.kind).toBe("steal");
    controller = await send({ type: "house-answer.add", label: "A new steal answer" });
    expect(controller.round?.houseAnswers[1]?.points).toBe(2);
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(12);
    expect(controller.phase).toBe("round-reveal");
    controller = await send({ type: "undo.last" });
    expect(controller.phase).toBe("steal");
    expect(controller.round?.houseAnswers).toHaveLength(1);
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(10);
    const fourth = controller.round!.answers[3]!;
    controller = await send({ type: "answer.reveal", answerId: fourth.id });
    expect(controller.phase).toBe("round-reveal");
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(24);
    expect(controller.cue).toMatchObject({ kind: "correct", teamId: "two", points: 14 });

    const presenterReveal = await readFamilyFeudSnapshot({
      roomId: room.roomId,
      role: "presenter",
      credential: room.presenterToken,
    });
    expect(
      presenterReveal.ok &&
        presenterReveal.snapshot?.round?.answers.every(({ label, shown }) => label && shown),
    ).toBe(true);
    expect(
      presenterReveal.ok &&
        presenterReveal.snapshot?.round?.answers.filter(({ revealed }) => !revealed).length,
    ).toBeGreaterThan(0);

    controller = await send({ type: "score.adjust", teamId: "one", points: 1 });
    expect(controller.teams[0].score).toBe(19);
    controller = await send({ type: "undo.last" });
    expect(controller.teams[0].score).toBe(18);
  });

  it("enters sudden death after tied regulation rounds and locks a confirmed result", async () => {
    const room = await createFamilyFeudRoom({ rounds: 4 });
    const paired = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
    });
    if (!paired.ok) throw new Error(paired.error);
    const send = actionSender(room.roomId, paired.controllerToken);
    await send({ type: "game.start" });
    await send({ type: "phase.advance" });
    await send({ type: "phase.advance" });
    for (let roundNumber = 1; roundNumber <= 4; roundNumber += 1) {
      await send({ type: "phase.advance" });
      await send({ type: "faceoff.open" });
      await send({ type: "faceoff.claim", teamId: "one" });
      await send({ type: "faceoff.miss" });
      await send({ type: "faceoff.miss" });
      await send({ type: "phase.advance" });
      await send({ type: "phase.advance" });
      await send({ type: "phase.advance" });
      await send({ type: "phase.advance" });
      await send({ type: "phase.advance" });
      const next = await send({ type: "phase.advance" });
      if (roundNumber < 4) expect(next.round?.number).toBe(roundNumber + 1);
    }
    let snapshot = await readController(room.roomId, paired.controllerToken);
    expect(snapshot.phase).toBe("round-intro");
    expect(snapshot.round?.number).toBe(5);
    expect(snapshot.round?.total).toBe(5);
    await send({ type: "phase.advance" });
    await send({ type: "faceoff.open" });
    await send({ type: "faceoff.claim", teamId: "two" });
    snapshot = await readController(room.roomId, paired.controllerToken);
    snapshot = await send({ type: "answer.reveal", answerId: snapshot.round!.answers[0]!.id });
    expect(snapshot.phase).toBe("round-reveal");
    await send({ type: "phase.advance" });
    snapshot = await send({ type: "phase.advance" });
    expect(snapshot.phase).toBe("finished");
    expect(snapshot.cue?.kind).toBe("victory");
    expect(snapshot.winnerTeamIds).toEqual(["two"]);
    snapshot = await send({ type: "result.confirm" });
    expect(snapshot.resultConfirmed).toBe(true);
    const rejected = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "score.adjust", teamId: "one", points: 1, actionId: "after-confirm" },
    });
    expect(rejected).toMatchObject({ accepted: false, errorCode: "result_confirmed" });
  });

  it("scopes each buzzer to its team and deduplicates repeated actions", async () => {
    const room = await createFamilyFeudRoom({ rounds: 4 });
    const paired = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
    });
    if (!paired.ok) throw new Error(paired.error);
    const firstAdvance = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "game.start", actionId: "same-start" },
    });
    const repeatedAdvance = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "game.start", actionId: "same-start" },
    });
    expect(firstAdvance.snapshot?.phase).toBe("rules");
    expect(repeatedAdvance.snapshot?.phase).toBe("rules");

    const send = actionSender(room.roomId, paired.controllerToken);
    await send({ type: "phase.advance" });
    await send({ type: "phase.advance" });
    await send({ type: "card.use" });
    await send({ type: "faceoff.open" });
    const wrongTeam = await applyFamilyFeudBuzzerAction({
      roomId: room.roomId,
      buzzerToken: room.buzzerTokens.one,
      action: { actionId: "wrong-team", type: "buzzer.hit", teamId: "two" },
    });
    expect(wrongTeam).toMatchObject({ accepted: false, errorCode: "action_unavailable" });
    const correctTeam = await applyFamilyFeudBuzzerAction({
      roomId: room.roomId,
      buzzerToken: room.buzzerTokens.one,
      action: { actionId: "correct-team", type: "buzzer.hit", teamId: "one" },
    });
    expect(correctTeam).toMatchObject({ accepted: true });
    expect(correctTeam.snapshot?.round?.faceoffTeamId).toBe("one");
  });

  it("keeps tied results unconfirmed until the MC starts sudden death", async () => {
    const room = await createFamilyFeudRoom({ rounds: 4 });
    const paired = await pairFamilyFeudController({
      roomId: room.roomId,
      pairingToken: room.controllerPairingToken,
    });
    if (!paired.ok) throw new Error(paired.error);
    const send = actionSender(room.roomId, paired.controllerToken);
    await send({ type: "game.start" });
    const tied = await send({ type: "game.end" });
    expect(tied).toMatchObject({ phase: "finished", winnerTeamIds: ["one", "two"] });
    const confirmation = await applyFamilyFeudControllerAction({
      roomId: room.roomId,
      controllerToken: paired.controllerToken,
      action: { type: "result.confirm", actionId: "reject-tie" },
    });
    expect(confirmation).toMatchObject({ accepted: false, errorCode: "action_unavailable" });
    let corrected = await send({ type: "score.adjust", teamId: "one", points: 1 });
    expect(corrected.winnerTeamIds).toEqual(["one"]);
    corrected = await send({ type: "undo.last" });
    expect(corrected.winnerTeamIds).toEqual(["one", "two"]);
    const suddenDeath = await send({ type: "sudden-death.start" });
    expect(suddenDeath.phase).toBe("round-intro");
    expect(suddenDeath.round).toMatchObject({ number: 5, total: 5 });
  });

  it("lets the presenter pairing code recover an abandoned MC session", async () => {
    const startedAt = Date.now();
    const clock = vi.spyOn(Date, "now").mockReturnValue(startedAt);
    try {
      const room = await createFamilyFeudRoom({ rounds: 4 });
      const first = await pairFamilyFeudController({
        roomId: room.roomId,
        pairingToken: room.controllerPairingToken,
      });
      if (!first.ok) throw new Error(first.error);
      expect(
        await pairFamilyFeudController({
          roomId: room.roomId,
          pairingToken: room.controllerPairingToken,
        }),
      ).toMatchObject({ ok: false, errorCode: "pairing_used" });

      clock.mockReturnValue(startedAt + 26_000);
      const recovered = await pairFamilyFeudController({
        roomId: room.roomId,
        pairingToken: room.controllerPairingToken,
      });
      expect(recovered.ok).toBe(true);
      if (!recovered.ok) return;
      const staleController = await applyFamilyFeudControllerAction({
        roomId: room.roomId,
        controllerToken: first.controllerToken,
        action: { type: "game.start", actionId: "stale-controller" },
      });
      expect(staleController).toMatchObject({ ok: false, errorCode: "room_unavailable" });
      const activeController = await applyFamilyFeudControllerAction({
        roomId: room.roomId,
        controllerToken: recovered.controllerToken,
        action: { type: "game.start", actionId: "recovered-controller" },
      });
      expect(activeController).toMatchObject({ accepted: true });
    } finally {
      clock.mockRestore();
    }
  });
});

async function readController(roomId: string, credential: string): Promise<FamilyFeudSnapshot> {
  const result = await readFamilyFeudSnapshot({
    roomId,
    role: "controller",
    credential,
  });
  if (!result.ok || !result.snapshot) throw new Error("Room unavailable");
  return result.snapshot;
}
