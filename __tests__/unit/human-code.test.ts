import { describe, expect, it } from "vitest";

import { generateHumanCode, type HumanCodeLength } from "@/lib/server/human-code";

describe("human-readable access codes", () => {
  it.each([
    { words: 1 as HumanCodeLength, segments: 1 },
    { words: 2 as HumanCodeLength, segments: 2 },
    { words: 3 as HumanCodeLength, segments: 3 },
  ])("generates $words safe lowercase word segments", ({ words, segments }) => {
    for (let sample = 0; sample < 100; sample += 1) {
      const code = generateHumanCode(words);

      expect(code).toMatch(/^[a-z]+(?:-[a-z]+)*$/);
      expect(code.split("-")).toHaveLength(segments);
    }
  });
});
