import { describe, expect, it } from "vitest";

import {
  PIXEL_WORLD_SCENE_VARIANTS,
  pixelWorldRoomSummary,
  pixelWorldTone,
  pixelWorldVariant,
  visiblePixelWorldPlayers,
} from "@/features/things/shared/pixel-world";

describe("pixel world", () => {
  it("keeps room styles and player tones stable", () => {
    expect(pixelWorldVariant("ROOM234")).toBe(pixelWorldVariant("ROOM234"));
    expect(pixelWorldVariant("ROOM234")).toBeGreaterThanOrEqual(0);
    expect(pixelWorldVariant("ROOM234")).toBeLessThan(PIXEL_WORLD_SCENE_VARIANTS);
    expect(pixelWorldTone("opaque-player")).toBe(pixelWorldTone("opaque-player"));
    expect(pixelWorldTone("opaque-player")).toBeLessThan(8);
  });

  it("does not draw departed players and bounds busy scenes", () => {
    const players = Array.from({ length: 12 }, (_, index) => ({
      id: `player-${index}`,
      ready: index % 2 === 0,
      left: index === 1,
    }));
    const visible = visiblePixelWorldPlayers(players);

    expect(visible).toHaveLength(8);
    expect(visible.some(({ id }) => id === "player-1")).toBe(false);
  });

  it("describes only public room readiness", () => {
    expect(
      pixelWorldRoomSummary({
        game: "mafia",
        roomId: "ROOM234",
        status: "waiting",
        capacity: 6,
        players: [
          { id: "a", ready: true },
          { id: "b", ready: false },
        ],
      }),
    ).toBe("1 of 2 ready");
  });
});
