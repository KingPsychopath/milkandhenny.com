import { beforeEach, describe, expect, it } from "vitest";

import {
  getDatabaseBootState,
  markDatabaseFailed,
  markDatabaseMigrationsStarted,
  markDatabaseReady,
  resetDatabaseBootStateForTests,
} from "@/lib/platform/database-readiness.server";

describe("database boot readiness", () => {
  beforeEach(() => resetDatabaseBootStateForTests());

  it("does not report ready before migrations finish", () => {
    expect(getDatabaseBootState()).toEqual({ status: "pending" });
    markDatabaseMigrationsStarted();
    expect(getDatabaseBootState()).toEqual({ status: "migrating" });
  });

  it("reports ready only after a successful migration", () => {
    markDatabaseMigrationsStarted();
    markDatabaseReady();
    expect(getDatabaseBootState()).toEqual({ status: "ready" });
  });

  it("keeps the verified pitch schema inventory with readiness", () => {
    markDatabaseReady({
      currentVersion: 2,
      total: 7,
      current: 7,
      unsupported: 0,
      versions: { "2": 7 },
    });
    expect(getDatabaseBootState()).toMatchObject({
      status: "ready",
      pitchDocuments: { total: 7, unsupported: 0 },
    });
  });

  it("keeps migration failures safe and unhealthy", () => {
    markDatabaseFailed(new TypeError("postgres://secret@host/schema details"));
    expect(getDatabaseBootState()).toEqual({ status: "failed", reason: "TypeError" });
  });
});
