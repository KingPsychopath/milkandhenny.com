import { afterEach, describe, expect, it, vi } from "vitest";

import { getPitchEnvironmentMode } from "@/features/things/pitches/config.server";
import {
  __pitchOperationalTesting,
  assertPitchOperationAllowed,
  getPitchOperationalStatus,
} from "@/features/things/pitches/operational.server";

describe("Pitch Night Studio operating mode", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses the most restrictive environment or admin mode", () => {
    expect(__pitchOperationalTesting.mostRestrictive("enabled", "read-only")).toBe("read-only");
    expect(__pitchOperationalTesting.mostRestrictive("off", "enabled")).toBe("off");
    expect(__pitchOperationalTesting.mostRestrictive("read-only", "off")).toBe("off");
  });

  it("fails closed when PITCHES_MODE is invalid", () => {
    vi.stubEnv("PITCHES_MODE", "paused");
    expect(getPitchEnvironmentMode()).toEqual({ mode: "off", valid: false });
  });

  it("defaults to enabled and accepts read-only", () => {
    vi.stubEnv("PITCHES_MODE", "");
    expect(getPitchEnvironmentMode()).toEqual({ mode: "enabled", valid: true });
    vi.stubEnv("PITCHES_MODE", "read-only");
    expect(getPitchEnvironmentMode()).toEqual({ mode: "read-only", valid: true });
  });

  it("enforces the environment switch without needing settings storage", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PITCHES_MODE", "off");
    await expect(getPitchOperationalStatus()).resolves.toMatchObject({
      effectiveMode: "off",
      source: "environment",
    });

    vi.stubEnv("PITCHES_MODE", "read-only");
    await expect(assertPitchOperationAllowed("write")).rejects.toThrow("Server saving is paused");
  });
});
