import { describe, expect, it } from "vitest";

import {
  gamePoolPlayerPath,
  requestedGamePoolChoice,
  shouldReplaceExistingGamePoolRoom,
  shouldReturnToExistingGamePoolRoom,
} from "@/features/things/pool/pool-lobby-policy";
import type { GamePoolJoinChoice } from "@/features/things/pool/pool-lobby-policy";

const activeRoomId = "ROOM123";
type PolicyCase = {
  name: string;
  requestedRoomId?: string;
  targetRejected: boolean;
  choice: GamePoolJoinChoice;
  expected?: boolean;
};

describe("game-pool lobby policy", () => {
  it("keeps an invite targeted until the target is rejected", () => {
    expect(requestedGamePoolChoice(activeRoomId, false)).toEqual({ roomId: activeRoomId });
    expect(requestedGamePoolChoice(activeRoomId, true)).toBe("auto");
    expect(requestedGamePoolChoice(undefined, false)).toBe("auto");
  });

  it.each([
    { name: "normal auto join", requestedRoomId: undefined, targetRejected: false, choice: "auto" },
    { name: "no active room", requestedRoomId: undefined, targetRejected: false, choice: "auto" },
  ] satisfies PolicyCase[])("returns to the existing room only for $name", (input) => {
    expect(
      shouldReturnToExistingGamePoolRoom({
        activeRoomId: input.name === "no active room" ? null : activeRoomId,
        requestedRoomId: input.requestedRoomId,
        targetRejected: input.targetRejected,
        choice: input.choice,
      }),
    ).toBe(input.name === "normal auto join");
  });

  it.each([
    { name: "a room code", requestedRoomId: "ROOM999", targetRejected: false, choice: "auto" },
    { name: "a rejected target", requestedRoomId: undefined, targetRejected: true, choice: "auto" },
    {
      name: "start another room",
      requestedRoomId: undefined,
      targetRejected: false,
      choice: "new",
    },
    {
      name: "a selected room",
      requestedRoomId: undefined,
      targetRejected: false,
      choice: { roomId: "ROOM999" },
    },
  ] satisfies PolicyCase[])("does not return to the existing room for $name", (input) => {
    expect(
      shouldReturnToExistingGamePoolRoom({
        activeRoomId,
        requestedRoomId: input.requestedRoomId,
        targetRejected: input.targetRejected,
        choice: input.choice,
      }),
    ).toBe(false);
  });

  it.each([
    {
      name: "a room code",
      requestedRoomId: "ROOM999",
      targetRejected: false,
      choice: "auto",
      expected: true,
    },
    {
      name: "a rejected target",
      requestedRoomId: undefined,
      targetRejected: true,
      choice: "auto",
      expected: true,
    },
    {
      name: "start another room",
      requestedRoomId: undefined,
      targetRejected: false,
      choice: "new",
      expected: true,
    },
    {
      name: "a different selected room",
      requestedRoomId: undefined,
      targetRejected: false,
      choice: { roomId: "ROOM999" },
      expected: true,
    },
    {
      name: "the existing selected room",
      requestedRoomId: undefined,
      targetRejected: false,
      choice: { roomId: activeRoomId },
      expected: false,
    },
    {
      name: "normal auto join",
      requestedRoomId: undefined,
      targetRejected: false,
      choice: "auto",
      expected: false,
    },
  ] satisfies PolicyCase[])("replaces the old seat only when the intent is $name", (input) => {
    expect(
      shouldReplaceExistingGamePoolRoom({
        activeRoomId,
        requestedRoomId: input.requestedRoomId,
        targetRejected: input.targetRejected,
        choice: input.choice,
      }),
    ).toBe(input.expected);
  });

  it("builds the playable room route", () => {
    expect(gamePoolPlayerPath("same-brain", activeRoomId)).toBe("/things/same-brain/ROOM123");
  });
});
