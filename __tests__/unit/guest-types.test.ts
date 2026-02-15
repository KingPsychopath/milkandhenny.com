import { describe, it, expect } from "vitest";
import { generateGuestId } from "@/lib/guests/types";

describe("generateGuestId", () => {
  it("lowercases and hyphenates spaces", () => {
    expect(generateGuestId("John Doe", 0)).toBe("john-doe-0");
  });

  it("collapses multiple spaces", () => {
    expect(generateGuestId("Jane   Smith", 5)).toBe("jane-smith-5");
  });

  it("uses numeric suffix", () => {
    const id = generateGuestId("Alice", 42);
    expect(id).toBe("alice-42");
  });

  it("uses string suffix", () => {
    const id = generateGuestId("Bob", "abc");
    expect(id).toBe("bob-abc");
  });

  it("defaults suffix to Date.now() when omitted", () => {
    const before = Date.now();
    const id = generateGuestId("Test User");
    const after = Date.now();

    const parts = id.split("-");
    const suffix = parseInt(parts[parts.length - 1], 10);
    expect(suffix).toBeGreaterThanOrEqual(before);
    expect(suffix).toBeLessThanOrEqual(after);
  });
});
