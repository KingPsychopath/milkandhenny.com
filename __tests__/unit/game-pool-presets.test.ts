import { describe, expect, it } from "vitest";
import { GAME_POOL_DEFAULTS, gamePoolPreset } from "@/features/things/pool/presets";

describe("game-pool presets", () => {
  it("uses a safe default when the game discriminator does not match", () => {
    expect(gamePoolPreset({ game: "liars", rounds: 20 }, "same-brain")).toEqual(
      GAME_POOL_DEFAULTS["same-brain"].preset,
    );
  });

  it("bounds numeric settings before they become room rules", () => {
    expect(gamePoolPreset({ game: "centre", difficulty: 99 }, "centre")).toMatchObject({
      difficulty: 5,
    });
    expect(gamePoolPreset({ game: "twin", handSize: -2 }, "twin")).toMatchObject({
      handSize: 3,
    });
    expect(
      gamePoolPreset({ game: "draw-country", drawSeconds: 5, roundTotal: 30 }, "draw-country"),
    ).toMatchObject({ drawSeconds: 15, roundTotal: 12 });
  });
});
