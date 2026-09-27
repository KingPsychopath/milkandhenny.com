import fs from "node:fs";
import { afterAll, beforeAll, expect, it } from "vitest";

import { transaction } from "@/lib/platform/postgres.server";
import { applySchema, closeDatabase, describeWithDatabase } from "../helpers/postgres";

const roleSql = fs.readFileSync(
  new URL("../../ops/postgres-media-worker-role.sql", import.meta.url),
  "utf8",
);

describeWithDatabase("media worker database role", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  it("can verify the ledger and process transfer work without reading identity or finance", async () => {
    await expect(
      transaction(async (client) => {
        await client.query(roleSql);
        const privileges = await client.query<{
          ledger: boolean;
          media_jobs: boolean;
          token_sessions: boolean;
          checkout_sessions: boolean;
          tickets: boolean;
          schema_create: boolean;
        }>(`
          select has_table_privilege('mah_media_worker','schema_migrations','SELECT') as ledger,
                 has_table_privilege('mah_media_worker','transfer_media_jobs','UPDATE') as media_jobs,
                 has_table_privilege('mah_media_worker','auth_token_sessions','SELECT') as token_sessions,
                 has_table_privilege('mah_media_worker','checkout_sessions','SELECT') as checkout_sessions,
                 has_table_privilege('mah_media_worker','tickets','SELECT') as tickets,
                 has_schema_privilege('mah_media_worker','public','CREATE') as schema_create
        `);
        expect(privileges.rows[0]).toEqual({
          ledger: true,
          media_jobs: true,
          token_sessions: false,
          checkout_sessions: false,
          tickets: false,
          schema_create: false,
        });
        await client.query("set local role mah_media_worker");
        const ledger = await client.query("select id from schema_migrations limit 1");
        expect(ledger.rows).toHaveLength(1);
        throw new Error("rollback-media-worker-role-fixture");
      }),
    ).rejects.toThrow("rollback-media-worker-role-fixture");
  });
});
