import { afterAll, beforeAll, expect, it } from "vitest";

import { closeDatabase, applySchema, describeWithDatabase } from "../helpers/postgres";

describeWithDatabase("migration ledger integrity", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  it("baselines a pre-checksum ledger without reapplying migrations", async () => {
    const { query } = await import("@/lib/platform/postgres.server");
    const { runMigrations } = await import("@/lib/platform/migrations.server");
    await query(
      "alter table schema_migrations drop column sql_sha256, drop column checksum_origin",
    );

    const result = await runMigrations();
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(99);
    const rows = await query<{ count: string }>(
      "select count(*)::text as count from schema_migrations where sql_sha256 is not null and checksum_origin = 'source-baseline'",
    );
    expect(rows[0]?.count).toBe("99");
  });

  it("verifies the complete ledger without applying migrations", async () => {
    const { verifyMigrations } = await import("@/lib/platform/migrations.server");
    const result = await verifyMigrations();
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toBe(99);
  });

  it("rejects a changed applied checksum", async () => {
    const { query } = await import("@/lib/platform/postgres.server");
    const { runMigrations, verifyMigrations } = await import("@/lib/platform/migrations.server");
    const id = "0095_intentional_survey_identity";
    const original = await query<{ sql_sha256: string }>(
      "select sql_sha256 from schema_migrations where id = $1",
      [id],
    );
    expect(original[0]?.sql_sha256).toMatch(/^[a-f0-9]{64}$/);
    try {
      await query("update schema_migrations set sql_sha256 = $2 where id = $1", [
        id,
        "a".repeat(64),
      ]);
      await expect(runMigrations()).rejects.toThrow("Applied migration checksum mismatch");
      await expect(verifyMigrations()).rejects.toThrow("Applied migration checksum mismatch");
    } finally {
      await query("update schema_migrations set sql_sha256 = $2 where id = $1", [
        id,
        original[0]?.sql_sha256,
      ]);
    }
  });

  it("rejects an unknown applied migration", async () => {
    const { query } = await import("@/lib/platform/postgres.server");
    const { runMigrations } = await import("@/lib/platform/migrations.server");
    try {
      await query("insert into schema_migrations (id) values ('unknown_production_migration')");
      await expect(runMigrations()).rejects.toThrow("Unknown applied migration");
    } finally {
      await query("delete from schema_migrations where id = 'unknown_production_migration'");
    }
  });

  it("accepts the verified production-only site-settings ledger entry", async () => {
    const { query } = await import("@/lib/platform/postgres.server");
    const { runMigrations } = await import("@/lib/platform/migrations.server");
    try {
      await query("insert into schema_migrations (id) values ('0025_site_settings')");
      const result = await runMigrations();
      expect(result.applied).toEqual([]);
      expect(result.alreadyApplied).toBe(99);
    } finally {
      await query("delete from schema_migrations where id = '0025_site_settings'");
    }
  });
});
