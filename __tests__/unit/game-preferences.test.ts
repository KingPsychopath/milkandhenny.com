import { describe, expect, it } from "vitest";

import { gamePreferencesKey } from "../../features/things/shared/useGamePreferences";

/**
 * The hook itself needs a DOM, but the two things most likely to break silently are the key shape
 * and the per-field coercion, and the second is worth pinning without React in the way.
 */
function coerce<T extends Record<string, string | number | boolean>>(
  stored: unknown,
  defaults: T,
): T {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return defaults;
  const source = stored as Record<string, unknown>;
  const result = { ...defaults };
  for (const key of Object.keys(defaults) as Array<keyof T & string>) {
    const value = source[key];
    if (typeof value === typeof defaults[key]) result[key] = value as T[keyof T & string];
  }
  return result;
}

describe("game preferences", () => {
  const defaults = { rounds: 5, seconds: 20, sound: true, deck: "warm-up" };

  it("namespaces by game, so two games cannot tread on each other", () => {
    expect(gamePreferencesKey("liars")).not.toBe(gamePreferencesKey("heads-up"));
    expect(gamePreferencesKey("liars")).toContain("liars");
  });

  it("keeps what it recognises and defaults the rest", () => {
    expect(coerce({ rounds: 9, deck: "hard" }, defaults)).toEqual({
      rounds: 9,
      seconds: 20,
      sound: true,
      deck: "hard",
    });
  });

  it("drops one bad field rather than the whole lot", () => {
    // A setting that changed type across a release must not wipe everything beside it.
    expect(coerce({ rounds: "nine", seconds: 40 }, defaults)).toEqual({
      rounds: 5,
      seconds: 40,
      sound: true,
      deck: "warm-up",
    });
  });

  it("survives junk in storage", () => {
    for (const junk of [null, "string", 7, [], undefined])
      expect(coerce(junk, defaults)).toEqual(defaults);
  });

  it("ignores keys it has never heard of", () => {
    expect(coerce({ rounds: 3, removedLastYear: true }, defaults)).not.toHaveProperty(
      "removedLastYear",
    );
  });
});
