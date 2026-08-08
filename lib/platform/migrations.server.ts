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
  {
    id: "0003_ticket_terms_acceptance",
    sql: `
      alter table checkout_sessions
        add column if not exists terms_accepted_at timestamptz,
        add column if not exists terms_snapshot jsonb;
    `,
  },
  {
    id: "0004_pitch_night_platform",
    sql: `
      alter table events
        add column if not exists marketing_path text;

      create table if not exists pitch_decks (
        id                    text primary key
                              check (id ~ '^p_[A-Za-z0-9_-]{22}$'),
        create_request_id     text not null unique,
        owner_name            text not null
                              check (char_length(owner_name) between 1 and 120),
        owner_email           text not null,
        owner_email_hash      text not null
                              check (char_length(owner_email_hash) = 64),
        title                 text not null
                              check (char_length(title) between 1 and 120),
        lifecycle             text not null default 'active'
                              check (lifecycle in ('active', 'archived', 'deleting')),
        draft_document        jsonb not null,
        draft_version         bigint not null default 1
                              check (draft_version >= 1),
        published_document    jsonb,
        published_version     bigint,
        published_title       text,
        thumbnail_asset_id    text,
        last_mutation_id      text,
        last_backup_at        timestamptz,
        draft_expires_at      timestamptz not null,
        created_at            timestamptz not null default now(),
        updated_at            timestamptz not null default now(),
        published_at          timestamptz,
        archived_at           timestamptz,
        constraint pitch_decks_document_size
          check (octet_length(draft_document::text) <= 3145728),
        constraint pitch_decks_published_document_size
          check (
            published_document is null
            or octet_length(published_document::text) <= 3145728
          ),
        constraint pitch_decks_published_pair
          check (
            (
              published_document is null
              and published_version is null
              and published_title is null
              and published_at is null
            )
            or
            (
              published_document is not null
              and published_version is not null
              and published_title is not null
              and published_at is not null
            )
          )
      );

      create index if not exists pitch_decks_public_idx
        on pitch_decks (published_at desc, id)
        where published_at is not null and lifecycle = 'active';
      create index if not exists pitch_decks_owner_email_idx
        on pitch_decks (owner_email_hash, updated_at desc)
        where lifecycle = 'active';
      create index if not exists pitch_decks_expiry_idx
        on pitch_decks (draft_expires_at, id)
        where published_at is null and lifecycle in ('active', 'deleting');

      create table if not exists pitch_access_tokens (
        id            text primary key,
        deck_id       text not null references pitch_decks (id) on delete cascade,
        token_hash    text not null unique check (char_length(token_hash) = 64),
        label         text not null default 'device',
        created_at    timestamptz not null default now(),
        last_used_at  timestamptz,
        revoked_at    timestamptz
      );

      create index if not exists pitch_access_tokens_deck_idx
        on pitch_access_tokens (deck_id, created_at desc);

      create table if not exists pitch_assets (
        id            text primary key,
        deck_id       text not null references pitch_decks (id) on delete cascade,
        object_key    text not null unique,
        file_id       text,
        kind          text not null
                      check (kind in ('image', 'audio', 'thumbnail', 'import')),
        state         text not null default 'pending'
                      check (state in ('pending', 'ready')),
        file_name     text not null,
        mime_type     text not null,
        bytes         bigint not null check (bytes >= 0),
        created_at    timestamptz not null default now(),
        ready_at      timestamptz,
        published_at  timestamptz
      );

      create index if not exists pitch_assets_deck_idx
        on pitch_assets (deck_id, created_at);
      create unique index if not exists pitch_assets_file_idx
        on pitch_assets (deck_id, file_id)
        where file_id is not null and state = 'ready';

      create table if not exists pitch_deck_backups (
        id          bigint generated always as identity primary key,
        deck_id     text not null references pitch_decks (id) on delete cascade,
        version     bigint not null,
        reason      text not null
                    check (reason in ('periodic', 'conflict', 'publish', 'admin')),
        document    jsonb not null,
        created_at  timestamptz not null default now()
      );

      create index if not exists pitch_deck_backups_deck_idx
        on pitch_deck_backups (deck_id, created_at desc);

      create table if not exists pitch_mutations (
        deck_id      text not null references pitch_decks (id) on delete cascade,
        mutation_id  text not null,
        version      bigint not null,
        created_at   timestamptz not null default now(),
        primary key (deck_id, mutation_id)
      );

      create index if not exists pitch_mutations_created_idx
        on pitch_mutations (created_at);

      create table if not exists pitch_audit_events (
        id          bigint generated always as identity primary key,
        deck_id     text references pitch_decks (id) on delete set null,
        action      text not null,
        actor       text not null,
        metadata    jsonb not null default '{}'::jsonb,
        created_at  timestamptz not null default now()
      );

      create index if not exists pitch_audit_events_deck_idx
        on pitch_audit_events (deck_id, created_at desc);
    `,
  },
  {
    id: "0005_checkpoints_and_scanner_links",
    sql: `
      -- Scan stations beyond the door: catering, merch, cloakroom. The door
      -- itself stays on tickets.redeemed_at and is not a row here.
      create table if not exists checkpoints (
        event_slug         text not null references events (slug) on delete cascade,
        id                 text not null check (id ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
        name               text not null check (char_length(name) between 1 and 60),
        -- Units a valid ticket may consume here unless its type says otherwise.
        default_allowance  integer not null default 1 check (default_allowance >= 0),
        -- Per-ticket-type overrides: { "<ticketTypeId>": units }. 0 = not included.
        allowances         jsonb not null default '{}'::jsonb,
        position           integer not null default 0,
        created_at         timestamptz not null default now(),
        primary key (event_slug, id)
      );

      -- Counted consumption per ticket per checkpoint. One row per pair; the
      -- guarded upsert in the engine is what makes double-scans safe.
      create table if not exists checkpoint_usage (
        event_slug    text not null,
        checkpoint_id text not null,
        ticket_id     text not null references tickets (id) on delete cascade,
        used          integer not null default 0 check (used >= 0),
        updated_at    timestamptz not null default now(),
        last_used_by  text,
        primary key (event_slug, checkpoint_id, ticket_id),
        foreign key (event_slug, checkpoint_id)
          references checkpoints (event_slug, id) on delete cascade
      );

      create index if not exists checkpoint_usage_ticket_idx
        on checkpoint_usage (ticket_id);

      -- Bearer scanner links: one URL hands one named person one station.
      -- Plaintext like ticket ids (also bearer credentials) so the admin can
      -- re-copy a link mid-event; revocation is the kill switch.
      create table if not exists scanner_links (
        token         text primary key check (token ~ '^scn_[A-Za-z0-9_-]{26,}$'),
        label         text not null check (char_length(label) between 1 and 60),
        event_slug    text not null references events (slug) on delete cascade,
        -- null scans the door; otherwise a checkpoint on the same event.
        checkpoint_id text,
        created_at    timestamptz not null default now(),
        expires_at    timestamptz,
        revoked_at    timestamptz,
        last_used_at  timestamptz,
        foreign key (event_slug, checkpoint_id)
          references checkpoints (event_slug, id) on delete cascade
      );

      create index if not exists scanner_links_event_idx
        on scanner_links (event_slug, created_at desc);
    `,
  },
  {
    id: "0006_scanner_link_devices",
    sql: `
      -- Which phones have opened a scanner link. A link is meant for one
      -- person; seeing two devices on it tells the organiser it leaked.
      create table if not exists scanner_link_devices (
        token       text not null references scanner_links (token) on delete cascade,
        device_id   text not null,
        first_seen  timestamptz not null default now(),
        last_seen   timestamptz not null default now(),
        primary key (token, device_id)
      );
    `,
  },
  {
    id: "0007_scanner_roles_and_guest_requests",
    sql: `
      -- A link's level. 'scanner' works a station; 'manager' can also add
      -- guests directly and decide other scanners' guest requests — an
      -- on-the-ground orchestrator without admin access.
      alter table scanner_links
        add column if not exists role text not null default 'scanner';

      -- A scanner's "can we add this person?" — pending until the organiser
      -- or a manager decides. Approval issues a comp ticket.
      create table if not exists guest_requests (
        id           bigint generated always as identity primary key,
        event_slug   text not null references events (slug) on delete cascade,
        -- The link that asked. Kept after revocation so history survives.
        token        text references scanner_links (token) on delete set null,
        requested_by text not null,
        name         text not null check (char_length(name) between 1 and 120),
        note         text,
        status       text not null default 'pending'
                     check (status in ('pending', 'approved', 'declined', 'cancelled')),
        ticket_id    text,
        created_at   timestamptz not null default now(),
        decided_at   timestamptz,
        decided_by   text
      );

      create index if not exists guest_requests_event_idx
        on guest_requests (event_slug, status, created_at desc);
      create index if not exists guest_requests_token_idx
        on guest_requests (token, created_at desc);
    `,
  },
  {
    id: "0008_scanner_link_permission_overrides",
    sql: `
      -- Per-link ability overrides on top of the role's defaults:
      -- { "addGuests": true, "approveRequests": false, ... }.
      alter table scanner_links
        add column if not exists permissions jsonb not null default '{}'::jsonb;
    `,
  },
  {
    id: "0009_checkpoint_multi_scan",
    sql: `
      -- Whether one scan may hand out several units (the +/- control).
      -- Off forces exactly one per scan, however big the allowance.
      alter table checkpoints
        add column if not exists multi_scan boolean not null default true;
    `,
  },
  {
    id: "0010_event_drops",
    sql: `
      -- Guest media drops: one shared album per event, uploaded into by
      -- anyone holding the bearer link. The media itself lives in the
      -- transfer system (Redis + R2); this row is the event's pointer to it.
      create table if not exists event_drops (
        event_slug   text primary key references events (slug) on delete cascade,
        token        text not null unique check (token ~ '^drp_[A-Za-z0-9_-]{26,}$'),
        transfer_id  text not null,
        created_at   timestamptz not null default now(),
        expires_at   timestamptz not null,
        disabled_at  timestamptz
      );
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
