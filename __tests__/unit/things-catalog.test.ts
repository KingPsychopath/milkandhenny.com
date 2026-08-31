import { describe, expect, it } from "vitest";

import { THINGS } from "@/features/things/catalog";
import { liarsSetupPath } from "@/features/things/liars/liars-invite";

describe("things catalogue", () => {
  it("presents Mafia and Imposter as separate games", () => {
    expect(THINGS.find((thing) => thing.slug === "mafia")).toMatchObject({
      name: "mafia",
      href: "/things/mafia",
      eyebrow: "social deduction · 5–16 people",
    });
    expect(THINGS.find((thing) => thing.slug === "imposter")).toMatchObject({
      name: "imposter",
      href: "/things/imposter",
      eyebrow: "social deduction · 4–16 people",
    });
    expect(THINGS.some((thing) => (thing.slug as string) === "liars")).toBe(false);
  });

  it("uses lower-case naming and a recognisable answer-board mark for family feud", () => {
    expect(THINGS.find((thing) => thing.slug === "family-feud")).toMatchObject({
      name: "family feud",
      mark: { kind: "icon", value: "feud" },
    });
  });
});

describe("liars setup paths", () => {
  it("returns the distinct public journey for each shared-engine mode", () => {
    expect(liarsSetupPath("mafia")).toBe("/things/mafia");
    expect(liarsSetupPath("imposter")).toBe("/things/imposter");
  });
});
