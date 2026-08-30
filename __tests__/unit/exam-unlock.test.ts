import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { unlockExamAnswers } from "@/features/exam/exam.server";
import { memoryWindows } from "@/lib/platform/rate-limit.server";

describe("private exam answer unlock", () => {
  const previousPin = process.env.EXAM_PIN;

  beforeEach(() => {
    memoryWindows.clear();
    process.env.EXAM_PIN = "2468";
  });

  afterEach(() => {
    memoryWindows.clear();
    if (previousPin === undefined) delete process.env.EXAM_PIN;
    else process.env.EXAM_PIN = previousPin;
  });

  it("should return the answer key only for the configured PIN", async () => {
    expect(await unlockExamAnswers("1111", "203.0.113.1")).toEqual({
      ok: false,
      error: "Incorrect PIN.",
    });

    const result = await unlockExamAnswers("2468", "203.0.113.1");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.answers)).toEqual(["1", "2", "3"]);
      expect(result.answers["1"]).toHaveLength(4);
    }
  });

  it("should stop repeated guesses from one network", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      const result = await unlockExamAnswers("wrong", "203.0.113.2");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe("Incorrect PIN.");
    }

    expect(await unlockExamAnswers("2468", "203.0.113.2")).toEqual({
      ok: false,
      error: "Too many attempts. Try again later.",
    });
  });
});
