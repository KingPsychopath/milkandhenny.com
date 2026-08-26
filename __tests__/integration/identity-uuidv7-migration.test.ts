import { afterAll, beforeAll, expect, it } from "vitest";

import { applySchema, closeDatabase, describeWithDatabase } from "@/__tests__/helpers/postgres";
import { __migrationsForTesting } from "@/lib/platform/migrations.server";
import { transaction } from "@/lib/platform/postgres.server";

describeWithDatabase("identity UUIDv7 migration", () => {
  beforeAll(applySchema);
  afterAll(closeDatabase);

  it("preserves identities, dependent references, and anonymous business rows", async () => {
    const migrations = __migrationsForTesting();
    const uuidMigrationIndex = migrations.findIndex(
      (migration) => migration.id === "0062_uuidv7_people_and_passkeys",
    );
    const uuidMigration = migrations[uuidMigrationIndex];

    expect(uuidMigrationIndex).toBeGreaterThan(0);
    expect(uuidMigration).toBeDefined();

    await transaction(async (client) => {
      await client.query(`drop schema if exists identity_uuid_contract cascade`);
      await client.query(`create schema identity_uuid_contract`);
      await client.query(`set local search_path to identity_uuid_contract, public`);
      for (const migration of migrations.slice(0, uuidMigrationIndex)) {
        await client.query(migration.sql);
      }

      await client.query(`
        insert into event_people (id, canonical_name)
        values ('person_provisional', 'Existing person');
        insert into event_person_identifiers (
          id, person_id, kind, value_hash, verified_at, display_hint
        ) values (
          'identifier_provisional', 'person_provisional', 'email',
          repeat('a', 64), now(), 'e…@example.com'
        );
        insert into event_person_login_challenges (
          id, email, email_hash, token_hash, code_hash, purpose, return_to,
          expires_at, consumed_at, consumed_person_id, consumed_session_hash
        ) values (
          'challenge_provisional', 'existing@example.com', repeat('a', 64),
          repeat('b', 64), repeat('c', 64), 'sign-in', '/my',
          now() + interval '10 minutes', now(), 'person_provisional', repeat('d', 64)
        );
        insert into attendee_action_links (
          id, token_hash, purpose, intended_email_hash, intended_email_hint,
          entity_type, entity_id, issued_by_type, expires_at
        ) values (
          'anonymous_link', repeat('e', 64), 'ticket-assignment', repeat('f', 64),
          'a…@example.com', 'ticket', 'ticket_1', 'system', now() + interval '1 hour'
        );
      `);

      await client.query(uuidMigration?.sql ?? "");

      const identity = await client.query<{
        person_id: string;
        identifier_id: string;
        referenced_person_id: string;
      }>(`
        select person.id::text as person_id,
               identifier.id::text as identifier_id,
               challenge.consumed_person_id::text as referenced_person_id
          from event_people person
          join event_person_identifiers identifier on identifier.person_id = person.id
          join event_person_login_challenges challenge
            on challenge.consumed_person_id = person.id
      `);
      const anonymousRows = await client.query<{ count: number }>(`
        select count(*)::int as count
          from attendee_action_links
         where id = 'anonymous_link' and consumed_by is null
      `);
      const columnTypes = await client.query<{ data_type: string }>(`
        select data_type
          from information_schema.columns
         where table_schema = 'identity_uuid_contract'
           and table_name = 'event_person_login_challenges'
           and column_name = 'consumed_person_id'
      `);

      expect(identity.rows).toHaveLength(1);
      expect(identity.rows[0]?.person_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(identity.rows[0]?.identifier_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(identity.rows[0]?.referenced_person_id).toBe(identity.rows[0]?.person_id);
      expect(anonymousRows.rows[0]?.count).toBe(1);
      expect(columnTypes.rows[0]?.data_type).toBe("uuid");

      await client.query(`drop schema identity_uuid_contract cascade`);
    });
  });
});
