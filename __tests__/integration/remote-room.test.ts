import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/platform/redis.server", () => ({ getRedis: () => null }));

import {
  closeRemoteRoom,
  createRemoteRoom,
  readRemoteJudge,
  sendRemoteJudgeCommand,
  syncRemoteHost,
} from "../../features/things/remote/remote-room.server";
import type { RemoteGameSnapshot } from "../../features/things/remote/types";

const snapshot: RemoteGameSnapshot = {
  game: "heads-up",
  phase: "playing",
  deckName: "All sorts",
  currentLabel: "Bubble wrap",
  nextLabel: "Chess",
  secondsRemaining: 42,
  paused: false,
  score: 0,
  results: [],
  updatedAt: Date.now(),
};

describe("remote game rooms", () => {
  beforeEach(() => vi.clearAllMocks());

  it("connects a judge and delivers each acknowledged command once", async () => {
    const room = await createRemoteRoom("heads-up");
    const initial = await syncRemoteHost({ roomId: room.roomId, hostToken: room.hostToken, snapshot, acknowledge: 0 });
    expect(initial.ok).toBe(true);

    const judge = await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken });
    expect(judge.snapshot?.currentLabel).toBe("Bubble wrap");

    await sendRemoteJudgeCommand({
      roomId: room.roomId,
      judgeToken: room.judgeToken,
      command: { id: "decision-1", type: "correct", createdAt: Date.now() },
    });
    const received = await syncRemoteHost({ roomId: room.roomId, hostToken: room.hostToken, snapshot, acknowledge: 0 });
    expect(received.commands).toHaveLength(1);

    const acknowledged = await syncRemoteHost({ roomId: room.roomId, hostToken: room.hostToken, snapshot, acknowledge: 1 });
    expect(acknowledged.commands).toHaveLength(0);
  });

  it("rejects invalid credentials and closes cleanly", async () => {
    const room = await createRemoteRoom("spelling-bee");
    expect((await readRemoteJudge({ roomId: room.roomId, judgeToken: "wrong" })).ok).toBe(false);
    expect((await closeRemoteRoom(room.roomId, room.hostToken)).ok).toBe(true);
    expect((await readRemoteJudge({ roomId: room.roomId, judgeToken: room.judgeToken })).ok).toBe(false);
  });
});
