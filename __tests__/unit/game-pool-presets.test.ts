import { describe, expect, it } from "vitest";
import { GAME_POOL_DEFAULTS, poolGameSettings } from "@/features/things/pool/presets";
import {
  gamePoolSettingsBundle,
  parseGamePoolSettingsBundle,
  recommendedGamePoolSettingsBundle,
  serializeGamePoolSettingsBundle,
} from "@/features/things/pool/preset-bundle";
import {
  parseEmbeddedGameSettingsDocument,
  parseGameSettingsDocument,
  serializeGameSettingsDocument,
} from "@/features/things/shared/game-settings";
import type { GamePoolEntrance } from "@/features/things/pool/types";

describe("game-pool presets", () => {
  it("uses the low-friction public-room defaults", () => {
    expect(GAME_POOL_DEFAULTS["same-brain"]).toMatchObject({
      targetSize: 8,
      gameSettings: { settings: { rounds: 8, scoring: "embedding" } },
    });
    expect(GAME_POOL_DEFAULTS.liars).toMatchObject({
      targetSize: 9,
      gameSettings: {
        settings: { mode: "mafia", roomMode: "same-room", firstGame: false },
      },
    });
    expect(GAME_POOL_DEFAULTS.centre).toMatchObject({
      targetSize: 6,
      gameSettings: { settings: { difficulty: 3, delayedRivals: false } },
    });
    expect(GAME_POOL_DEFAULTS.twin).toMatchObject({
      targetSize: 6,
      gameSettings: { settings: { handSize: 6 } },
    });
    expect(GAME_POOL_DEFAULTS["draw-country"]).toMatchObject({
      targetSize: 8,
      gameSettings: { settings: { drawSeconds: 30, roundTotal: 5 } },
    });
  });

  it("rejects settings whose game discriminator does not match", () => {
    expect(() => poolGameSettings({ game: "liars", rounds: 20 }, "same-brain")).toThrow(
      "not Same Brain",
    );
  });

  it("rejects invalid native settings instead of silently changing shared JSON", () => {
    const document = GAME_POOL_DEFAULTS.centre.gameSettings;
    expect(() =>
      parseGameSettingsDocument({
        ...document,
        settings: { game: "centre", difficulty: 99, delayedRivals: false },
      }),
    ).toThrow("between 1 and 5");
  });

  it("round-trips every recommended portable settings bundle", () => {
    for (const game of Object.keys(GAME_POOL_DEFAULTS)) {
      const bundle = recommendedGamePoolSettingsBundle(game as keyof typeof GAME_POOL_DEFAULTS);
      expect(parseGamePoolSettingsBundle(serializeGamePoolSettingsBundle(bundle))).toEqual(bundle);
      expect(parseGameSettingsDocument(serializeGameSettingsDocument(bundle.gameSettings))).toEqual(
        bundle.gameSettings,
      );
      expect(parseEmbeddedGameSettingsDocument(serializeGamePoolSettingsBundle(bundle))).toEqual(
        bundle.gameSettings,
      );
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
      isDefault: false,
      gameSettings: GAME_POOL_DEFAULTS.centre.gameSettings,
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
    const value = serializeGamePoolSettingsBundle(gamePoolSettingsBundle(entrance));
    expect(value).not.toContain("secret-id");
    expect(value).not.toContain("secret-player-token");
  });

  it("rejects unknown versions and mismatched game presets", () => {
    const bundle = recommendedGamePoolSettingsBundle("centre");
    expect(() => parseGamePoolSettingsBundle({ ...bundle, schemaVersion: 2 })).toThrow(
      "version is not supported",
    );
    expect(() =>
      parseGamePoolSettingsBundle({
        ...bundle,
        gameSettings: GAME_POOL_DEFAULTS.liars.gameSettings,
      }),
    ).toThrow("do not match");
  });
});
