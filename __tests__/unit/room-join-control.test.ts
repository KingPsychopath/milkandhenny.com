import { describe, expect, it } from "vitest";

import { multiplayerRoomFromQr } from "../../features/things/shared/RoomJoinControl";

describe("multiplayer room QR parsing", () => {
  it("keeps a private invite fragment when scanning an in-app QR", () => {
    const result = multiplayerRoomFromQr(
      "https://milkandhenny.com/things/twin/ABC2345#join=secret-token",
      "/things/twin",
      "https://milkandhenny.com",
    );

    expect(result).toEqual({
      roomCode: "ABC2345",
      inviteUrl: "https://milkandhenny.com/things/twin/ABC2345#join=secret-token",
    });
  });

  it("accepts a plain room code without inventing an invite URL", () => {
    expect(multiplayerRoomFromQr("abc2345", "/things/twin", "https://milkandhenny.com")).toEqual({
      roomCode: "ABC2345",
    });
  });

  it("rejects another origin and another game's route", () => {
    expect(
      multiplayerRoomFromQr(
        "https://example.com/things/twin/ABC2345#join=stolen",
        "/things/twin",
        "https://milkandhenny.com",
      ),
    ).toBeNull();
    expect(
      multiplayerRoomFromQr(
        "https://milkandhenny.com/things/liars/ABC2345#join=wrong-game",
        "/things/twin",
        "https://milkandhenny.com",
      ),
    ).toBeNull();
  });

  it("rejects an invite URL with extra route segments", () => {
    expect(
      multiplayerRoomFromQr(
        "https://milkandhenny.com/things/twin/archive/ABC2345#join=wrong-route",
        "/things/twin",
        "https://milkandhenny.com",
      ),
    ).toBeNull();
  });
});
