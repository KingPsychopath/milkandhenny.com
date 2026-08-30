import { describe, expect, it } from "vitest";

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
    controller = await send({ type: "phase.advance" });
    expect(controller.phase).toBe("steal-ready");
    controller = await send({ type: "phase.advance" });
    expect(controller.cue?.kind).toBe("steal");
    controller = await send({ type: "house-answer.add", label: "A new steal answer" });
    expect(controller.round?.houseAnswers[1]?.points).toBe(2);
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(12);
    const fourth = controller.round!.answers[3]!;
    controller = await send({ type: "answer.reveal", answerId: fourth.id });
    expect(controller.phase).toBe("round-reveal");
    expect(controller.teams.find(({ id }) => id === "two")?.score).toBe(26);
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
