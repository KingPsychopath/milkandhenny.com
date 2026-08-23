import { describe, expect, it } from "vitest";
import { GAME_POOL_DEFAULTS, gamePoolPreset } from "@/features/things/pool/presets";
import {
  gamePoolPresetBundle,
  parseGamePoolPresetBundle,
  recommendedGamePoolPresetBundle,
  serializeGamePoolPresetBundle,
} from "@/features/things/pool/preset-bundle";
import type { GamePoolEntrance } from "@/features/things/pool/types";

describe("game-pool presets", () => {
  it("uses the low-friction public-room defaults", () => {
    expect(GAME_POOL_DEFAULTS["same-brain"]).toMatchObject({
      targetSize: 8,
      preset: { rounds: 8, scoring: "embedding" },
    });
    expect(GAME_POOL_DEFAULTS.liars).toMatchObject({
      targetSize: 9,
      preset: { mode: "mafia", roomMode: "same-room", firstGame: false },
    });
    expect(GAME_POOL_DEFAULTS.centre).toMatchObject({
      targetSize: 6,
      preset: { difficulty: 3, delayedRivals: false },
    });
    expect(GAME_POOL_DEFAULTS.twin).toMatchObject({
      targetSize: 6,
      preset: { handSize: 6 },
    });
    expect(GAME_POOL_DEFAULTS["draw-country"]).toMatchObject({
      targetSize: 8,
      preset: { drawSeconds: 30, roundTotal: 5 },
    });
  });

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

  it("round-trips every recommended portable settings bundle", () => {
    for (const game of Object.keys(GAME_POOL_DEFAULTS)) {
      const bundle = recommendedGamePoolPresetBundle(game as keyof typeof GAME_POOL_DEFAULTS);
      expect(parseGamePoolPresetBundle(serializeGamePoolPresetBundle(bundle))).toEqual(bundle);
      expect(bundle.admission).toEqual({
        autoJoin: true,
        allowRoomChoice: true,
        allowNewRooms: true,
        nameVisibility: "initials",
      });
    }
  });

  it("exports configuration without entrance or player secrets", () => {
    const entrance = {
      id: "secret-id",
      token: "secret-player-token",
      label: "Quick Centre",
      game: "centre",
      preset: GAME_POOL_DEFAULTS.centre.preset,
      targetSize: 6,
      autoJoin: true,
      allowRoomChoice: true,
      allowNewRooms: true,
      nameVisibility: "initials",
      createdAt: "2026-08-23T00:00:00.000Z",
      updatedAt: "2026-08-23T00:00:00.000Z",
      retiredAt: null,
      run: null,
    } satisfies GamePoolEntrance;
    const value = serializeGamePoolPresetBundle(gamePoolPresetBundle(entrance));
    expect(value).not.toContain("secret-id");
    expect(value).not.toContain("secret-player-token");
  });

  it("rejects unknown versions and mismatched game presets", () => {
    const bundle = recommendedGamePoolPresetBundle("centre");
    expect(() => parseGamePoolPresetBundle({ ...bundle, schemaVersion: 2 })).toThrow(
      "version is not supported",
    );
    expect(() =>
      parseGamePoolPresetBundle({
        ...bundle,
        preset: GAME_POOL_DEFAULTS.liars.preset,
      }),
    ).toThrow("does not match");
  });
});
