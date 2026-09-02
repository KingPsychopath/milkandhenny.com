import { describe, expect, it } from "vitest";

import {
  fallbackTeamColour,
  isTeamCount,
  isTeamColourKey,
  teamPaletteForCount,
} from "@/features/event-operations/team-palette";

describe("event team palette", () => {
  it("provides distinct stable palettes for each supported team count", () => {
    expect(teamPaletteForCount(2).map((entry) => entry.colourKey)).toEqual(["amber", "sage"]);
    expect(teamPaletteForCount(3).map((entry) => entry.colourKey)).toEqual([
      "amber",
      "sage",
      "plum",
    ]);
    expect(teamPaletteForCount(4).map((entry) => entry.colourKey)).toEqual([
      "amber",
      "sage",
      "plum",
      "sky",
    ]);
  });

  it("rejects unsupported counts and colour names", () => {
    expect(isTeamCount(2)).toBe(true);
    expect(isTeamCount(5)).toBe(false);
    expect(isTeamColourKey("sky")).toBe(true);
    expect(isTeamColourKey("red")).toBe(false);
    expect(fallbackTeamColour(5)).toBe("sage");
  });
});
