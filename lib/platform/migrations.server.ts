import { log } from "./logger.server";
import { getPool, transaction } from "./postgres.server";

/**
 * Migrations.
 *
 * Deliberately a plain ordered list of SQL rather than a migration
 * framework: there is one database, one writer, and a handful of tables. A
 * tool would be more machinery than the problem has.
 *
 * Rules: migrations are append-only and never edited once deployed. Each runs
 * inside a transaction, and an advisory lock stops two booting replicas from
 * racing each other through the list.
 */

const ADVISORY_LOCK_KEY = 8_147_231;

type Migration = { id: string; sql: string };

const MIGRATIONS: Migration[] = [
  {
    id: "0001_events_and_tickets",
    sql: `
      create table if not exists events (
        slug              text primary key,
        title             text not null,
        tagline           text,
        status            text not null default 'draft',
        starts_at         timestamptz not null,
        ends_at           timestamptz,
        doors_at          timestamptz,
        last_entry_at     timestamptz,
        timezone          text not null default 'Europe/London',
        area              text,
        venue_name        text,
        address           text,
        door_code         text,
        three_word_hint   text,
        map_url           text,
        step_free_access  boolean,
        transport_note    text,
        description       text,
        lineup            jsonb not null default '[]'::jsonb,
        dress_code        text,
        age_limit         text,
        house_rules       text,
        hero_image        text,
        og_image          text,
        capacity          integer,
        waitlist_enabled  boolean not null default false,
        refund_policy     text,
        transferable      boolean not null default false,
        terms             text,
        check_in_opens_at timestamptz,
        staff_notes       text,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now()
      );

      create index if not exists events_starts_at_idx on events (starts_at desc);
      create index if not exists events_status_idx on events (status);

      create table if not exists ticket_types (
        event_slug       text not null references events (slug) on delete cascade,
        id               text not null,
        name             text not null,
        description      text,
        price_minor      integer not null default 0 check (price_minor >= 0),
        currency         text not null default 'GBP',
        quantity         integer not null default 0 check (quantity >= 0),
        per_person_limit integer not null default 4 check (per_person_limit >= 1),
        sales_start      timestamptz,
        sales_end        timestamptz,
        hidden           boolean not null default false,
        position         integer not null default 0,
        primary key (event_slug, id)
      );

      create table if not exists tickets (
        id                text primary key,
        event_slug        text not null,
        ticket_type_id    text not null,
        kind              text not null default 'free',
        status            text not null default 'valid',
        holder_name       text not null,
        email             text,
        email_hash        text,
        order_id          text not null,
        parent_ticket_id  text references tickets (id) on delete set null,
        issued_at         timestamptz not null default now(),
        redeemed_at       timestamptz,
        redeemed_by       text,
        redeemed_offline  boolean,
        payment_ref       text,
        checkout_ref      text,
        amount_paid_minor integer,
        currency          text,
        refunded_at       timestamptz,
        refund_ref        text,
        notes             text,
        -- Restrict, not cascade: deleting an event that sold tickets should
        -- fail loudly rather than silently destroy people's receipts.
        foreign key (event_slug, ticket_type_id)
          references ticket_types (event_slug, id) on delete restrict
      );

      create index if not exists tickets_event_idx on tickets (event_slug);
      create index if not exists tickets_event_type_idx on tickets (event_slug, ticket_type_id);
      create index if not exists tickets_email_idx on tickets (event_slug, email_hash);
      create index if not exists tickets_order_idx on tickets (order_id);

      -- Stripe may deliver the same webhook more than once. A unique index on
      -- the checkout session is what makes issuance idempotent.
      create unique index if not exists tickets_checkout_ref_idx
        on tickets (checkout_ref, id) where checkout_ref is not null;
    `,
  },
  {
    id: "0002_checkout_sessions",
    sql: `
      -- One row per Stripe Checkout session, claimed exactly once by the
      -- webhook. This is the idempotency guard for issuing paid tickets.
      create table if not exists checkout_sessions (
        id              text primary key,
        event_slug      text not null references events (slug) on delete cascade,
        ticket_type_id  text not null,
        quantity        integer not null check (quantity >= 1),
        holder_name     text not null,
        email           text not null,
        email_hash      text not null,
        amount_minor    integer not null,
        currency        text not null,
        status          text not null default 'pending',
        created_at      timestamptz not null default now(),
        fulfilled_at    timestamptz,
        order_id        text
      );

      create index if not exists checkout_sessions_event_idx
        on checkout_sessions (event_slug, status);
    `,
  },
];

export type MigrationResult = { applied: string[]; alreadyApplied: number };

/**
 * Apply any migrations this database has not seen.
 *
 * Safe to call on every boot and from every replica.
 */
export async function runMigrations(): Promise<MigrationResult> {
  if (!getPool()) return { applied: [], alreadyApplied: 0 };

  await transaction(async (client) => {
    await client.query(`
      create table if not exists schema_migrations (
        id         text primary key,
        applied_at timestamptz not null default now()
      );
    `);
  });

  const applied: string[] = [];
  let alreadyApplied = 0;

  for (const migration of MIGRATIONS) {
    await transaction(async (client) => {
      // Serialise replicas booting at the same time. The lock is released
      // when the transaction ends, so a crash cannot wedge it.
      await client.query("select pg_advisory_xact_lock($1)", [ADVISORY_LOCK_KEY]);

      const { rows } = await client.query<{ id: string }>(
        "select id from schema_migrations where id = $1",
        [migration.id],
      );
      if (rows.length > 0) {
        alreadyApplied += 1;
        return;
      }

      await client.query(migration.sql);
      await client.query("insert into schema_migrations (id) values ($1)", [migration.id]);
      applied.push(migration.id);
      log.info("postgres.migrate", "Applied migration", { id: migration.id });
    });
  }

  return { applied, alreadyApplied };
}

/** Test helper — the migration list, so tests can build a schema. */
export function __migrationsForTesting(): readonly Migration[] {
  return MIGRATIONS;
}
