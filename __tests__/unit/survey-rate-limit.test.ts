import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { reserveSurveySubmission } from "@/features/surveys/surveys.server";
import { memoryWindows } from "@/lib/platform/rate-limit.server";

vi.mock("@/lib/platform/redis.server", () => ({
  getRedis: () => null,
  getRedisRestConfig: () => null,
}));

describe("public survey rate limiting", () => {
  beforeEach(() => {
    memoryWindows.clear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("supports a shared event network but bounds anonymous writes per survey", async () => {
    for (let attempt = 0; attempt < 300; attempt += 1) {
      expect((await reserveSurveySubmission("after-party", "203.0.113.10")).allowed).toBe(true);
    }

    expect((await reserveSurveySubmission("after-party", "203.0.113.10")).allowed).toBe(false);
    expect((await reserveSurveySubmission("another-survey", "203.0.113.10")).allowed).toBe(true);
  });

  it("fails closed in production when the limiter backend is unavailable", async () => {
    vi.stubEnv("NODE_ENV", "production");

    expect((await reserveSurveySubmission("after-party", "203.0.113.10")).allowed).toBe(false);
  });
});
