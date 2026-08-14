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

  it("keeps migration failures safe and unhealthy", () => {
    markDatabaseFailed(new TypeError("postgres://secret@host/schema details"));
    expect(getDatabaseBootState()).toEqual({ status: "failed", reason: "TypeError" });
  });
});
