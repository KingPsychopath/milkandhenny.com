import { describe, expect, it } from "vitest";

import {
  hashMultiplayerCredential,
  resolveMultiplayerJoinAttempt,
} from "../../features/things/shared/room-primitives.server";
import { optionalMultiplayerJoinAttempt } from "../../features/things/shared/multiplayer-validation";

describe("multiplayer join attempt resolution", () => {
  it("creates a server credential for older clients", () => {
    const result = resolveMultiplayerJoinAttempt([]);
    expect(result).toMatchObject({ kind: "new" });
    if (result.kind === "new") {
      expect(result.joinId).toBeUndefined();
      expect(result.playerToken.length).toBeGreaterThan(20);
    }
  });

  it("uses a new browser attempt as the durable player identity", () => {
    const result = resolveMultiplayerJoinAttempt([], {
      joinId: "join-new",
      playerToken: "browser-created-token",
    });
    expect(result).toEqual({
      kind: "new",
      joinId: "join-new",
      playerToken: "browser-created-token",
    });
  });

  it("recovers the existing player only when the browser still has its credential", () => {
    const player = {
      id: "player-one",
      joinId: "join-retry",
      tokenHash: hashMultiplayerCredential("right-token"),
    };
    expect(
      resolveMultiplayerJoinAttempt([player], {
        joinId: "join-retry",
        playerToken: "right-token",
      }),
    ).toEqual({ kind: "retry", player, playerToken: "right-token" });
    expect(
      resolveMultiplayerJoinAttempt([player], {
        joinId: "join-retry",
        playerToken: "wrong-token",
      }),
    ).toEqual({ kind: "conflict" });
  });

  it("accepts both join fields together and rejects partial identities", () => {
    expect(optionalMultiplayerJoinAttempt(undefined, undefined)).toEqual({});
    expect(optionalMultiplayerJoinAttempt("join", "token")).toEqual({
      joinId: "join",
      playerToken: "token",
    });
    expect(() => optionalMultiplayerJoinAttempt("join", undefined)).toThrow("Invalid join attempt");
  });
});
