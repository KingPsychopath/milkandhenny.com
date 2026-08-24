import type { QueryResultRow } from "pg";

import type { PitchDocumentSchemaInventory } from "./database-readiness.server";
import { log } from "./logger.server";
import { getPool, query, transaction } from "./postgres.server";

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
        hero_image_width  integer check (hero_image_width > 0),
        hero_image_height integer check (hero_image_height > 0),
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
                      check (kind in ('image', 'audio', 'thumbnail')),
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
  {
    id: "0011_checkout_payment_state",
    sql: `
      alter table checkout_sessions
        add column if not exists reference text,
        add column if not exists payment_ref text,
        add column if not exists refund_ref text,
        add column if not exists processing_started_at timestamptz,
        add column if not exists updated_at timestamptz not null default now();

      create unique index if not exists checkout_sessions_reference_idx
        on checkout_sessions (reference) where reference is not null;
      create index if not exists checkout_sessions_payment_ref_idx
        on checkout_sessions (payment_ref) where payment_ref is not null;
    `,
  },
  {
    id: "0012_email_outbox",
    sql: `
      create table email_outbox (
        id                  uuid primary key,
        idempotency_key     text not null unique,
        channel             text not null check (channel in ('tickets', 'studio')),
        recipient_hash      text not null check (char_length(recipient_hash) = 64),
        message             jsonb,
        status              text not null default 'pending'
                            check (status in ('pending', 'processing', 'accepted', 'failed')),
        attempts            integer not null default 0 check (attempts >= 0),
        next_attempt_at     timestamptz not null default now(),
        locked_until        timestamptz,
        provider_message_id text,
        provider_status     integer,
        last_error          text,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now(),
        accepted_at         timestamptz,
        failed_at           timestamptz,
        constraint email_outbox_message_state check (
          (status in ('pending', 'processing') and message is not null)
          or (status in ('accepted', 'failed') and message is null)
        ),
        constraint email_outbox_message_size check (
          message is null or octet_length(message::text) <= 6291456
        )
      );

      create index email_outbox_delivery_idx
        on email_outbox (next_attempt_at, created_at)
        where status in ('pending', 'processing');
      create index email_outbox_status_idx on email_outbox (status, created_at desc);
    `,
  },
  {
    id: "0013_email_delivery_feedback",
    sql: `
      create table email_feedback_events (
        event_id            text not null,
        event_type          text not null
                            check (event_type in (
                              'cf.email.sending.message.bounced',
                              'cf.email.sending.message.complained'
                            )),
        provider_message_id text not null,
        recipient_hash      text not null check (char_length(recipient_hash) = 64),
        occurred_at         timestamptz not null,
        received_at         timestamptz not null default now(),
        primary key (event_id, recipient_hash)
      );

      create table email_suppressions (
        recipient_hash      text primary key check (char_length(recipient_hash) = 64),
        reason              text not null
                            check (reason in ('bounced', 'complained')),
        provider_message_id text not null,
        first_occurred_at   timestamptz not null,
        last_occurred_at    timestamptz not null,
        updated_at          timestamptz not null default now()
      );

      create index email_feedback_message_idx
        on email_feedback_events (provider_message_id, occurred_at desc);
    `,
  },
  {
    id: "0014_event_hero_height",
    sql: `
      -- How much of the first screen the hero image may claim. Null keeps the
      -- image's natural height, which is what every existing event already had.
      alter table events
        add column if not exists hero_height text
          check (hero_height is null or hero_height in ('natural', 'tall', 'medium', 'short'));
    `,
  },
  {
    id: "0015_game_night_pools",
    sql: `
      create table if not exists game_pool_entrances (
        id                text primary key
                          check (id ~ '^gpe_[A-Za-z0-9_-]{22}$'),
        token             text not null unique
                          check (token ~ '^play_[A-Za-z0-9_-]{26,}$'),
        label             text not null check (char_length(label) between 1 and 80),
        game              text not null
                          check (game in ('same-brain', 'liars', 'centre', 'twin', 'draw-country')),
        is_default        boolean not null default false,
        preset            jsonb not null,
        target_size       integer not null check (target_size between 2 and 16),
        allow_room_choice boolean not null default true,
        allow_new_rooms   boolean not null default true,
        name_visibility   text not null default 'first-names'
                          check (name_visibility in ('first-names', 'initials', 'counts')),
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now(),
        retired_at        timestamptz
      );

      create unique index if not exists game_pool_entrances_one_default_idx
        on game_pool_entrances (game)
        where is_default = true and retired_at is null;

      create table if not exists game_pool_runs (
        id                text primary key
                          check (id ~ '^gpr_[A-Za-z0-9_-]{22}$'),
        entrance_id       text not null references game_pool_entrances (id) on delete cascade,
        status            text not null default 'open'
                          check (status in ('open', 'paused', 'closed')),
        preset            jsonb not null,
        target_size       integer not null check (target_size between 2 and 16),
        allow_room_choice boolean not null,
        allow_new_rooms   boolean not null,
        name_visibility   text not null
                          check (name_visibility in ('first-names', 'initials', 'counts')),
        opened_at         timestamptz not null default now(),
        closes_at         timestamptz,
        closed_at         timestamptz,
        updated_at        timestamptz not null default now()
      );

      create unique index if not exists game_pool_runs_one_live_idx
        on game_pool_runs (entrance_id)
        where status in ('open', 'paused');
      create index if not exists game_pool_runs_entrance_idx
        on game_pool_runs (entrance_id, opened_at desc);

      create table if not exists game_pool_rooms (
        run_id       text not null references game_pool_runs (id) on delete cascade,
        room_id      text not null,
        status       text not null default 'open'
                     check (status in ('open', 'started', 'closed')),
        player_count integer not null default 0 check (player_count >= 0),
        capacity     integer not null check (capacity between 1 and 100),
        created_at   timestamptz not null default now(),
        updated_at   timestamptz not null default now(),
        primary key (run_id, room_id)
      );

      create index if not exists game_pool_rooms_assignment_idx
        on game_pool_rooms (run_id, status, created_at);

      create table if not exists game_pool_assignments (
        id          text primary key check (id ~ '^gpa_[A-Za-z0-9_-]{22}$'),
        run_id      text not null references game_pool_runs (id) on delete cascade,
        room_id     text not null,
        client_id   text not null check (char_length(client_id) between 12 and 120),
        player_id   text not null,
        display_name text not null check (char_length(display_name) between 1 and 32),
        status      text not null default 'active'
                    check (status in ('active', 'left', 'removed')),
        created_at  timestamptz not null default now(),
        ended_at    timestamptz,
        foreign key (run_id, room_id)
          references game_pool_rooms (run_id, room_id) on delete cascade
      );

      create unique index if not exists game_pool_assignments_one_active_idx
        on game_pool_assignments (run_id, client_id)
        where status = 'active';
      create index if not exists game_pool_assignments_room_idx
        on game_pool_assignments (run_id, room_id, status);
    `,
  },
  {
    id: "0016_game_night_pool_operations",
    sql: `
      alter table game_pool_assignments
        drop constraint if exists game_pool_assignments_status_check;
      alter table game_pool_assignments
        add constraint game_pool_assignments_status_check
        check (status in ('active', 'left', 'removed', 'session_ended'));

      alter table game_pool_runs
        add column if not exists operator_token_hash text;
      alter table game_pool_runs
        add column if not exists opening_action_id text;
      alter table game_pool_entrances
        add column if not exists create_action_id text;
      create unique index if not exists game_pool_runs_operator_token_idx
        on game_pool_runs (operator_token_hash)
        where operator_token_hash is not null;
      create unique index if not exists game_pool_runs_open_action_idx
        on game_pool_runs (entrance_id, opening_action_id)
        where opening_action_id is not null;
      create unique index if not exists game_pool_entrances_create_action_idx
        on game_pool_entrances (create_action_id)
        where create_action_id is not null;

      create table if not exists game_pool_moderation_events (
        id            text primary key,
        run_id        text not null references game_pool_runs (id) on delete cascade,
        room_id       text,
        assignment_id text references game_pool_assignments (id) on delete set null,
        action_id     text not null,
        actor         text not null check (actor in ('server', 'room_lead', 'pool_operator')),
        action        text not null check (action in ('player_removed', 'room_closed')),
        created_at    timestamptz not null default now(),
        unique (run_id, action_id)
      );

      create index if not exists game_pool_moderation_run_idx
        on game_pool_moderation_events (run_id, created_at desc);
    `,
  },
  {
    id: "0017_pitch_version_history",
    sql: `
      alter table pitch_deck_backups drop constraint if exists pitch_deck_backups_reason_check;
      update pitch_deck_backups set reason = 'autosave' where reason = 'periodic';
      update pitch_deck_backups set reason = 'restore' where reason = 'admin';
      alter table pitch_deck_backups
        add constraint pitch_deck_backups_reason_check
        check (reason in ('autosave', 'safety', 'conflict', 'publish', 'restore'));
    `,
  },
  {
    id: "0018_game_pool_portable_settings",
    sql: `
      alter table game_pool_entrances
        add column if not exists auto_join boolean not null default true;
      alter table game_pool_runs
        add column if not exists auto_join boolean not null default true;

      alter table game_pool_entrances
        alter column name_visibility set default 'initials';
      update game_pool_entrances
        set name_visibility = 'initials'
        where name_visibility = 'first-names';
      update game_pool_runs
        set name_visibility = 'initials'
        where name_visibility = 'first-names';
    `,
  },
  {
    id: "0019_pitch_command_journal_editions_and_trash",
    sql: `
      alter table pitch_decks drop constraint if exists pitch_decks_lifecycle_check;
      alter table pitch_decks
        add constraint pitch_decks_lifecycle_check
        check (lifecycle in ('active', 'archived', 'trashed', 'deleting'));
      alter table pitch_decks
        add column if not exists trashed_at timestamptz,
        add column if not exists purge_after timestamptz,
        add column if not exists current_edition_number integer;
      alter table pitch_decks drop column if exists last_mutation_id;
      create index if not exists pitch_decks_purge_idx
        on pitch_decks (purge_after, id)
        where lifecycle = 'trashed';

      alter table pitch_deck_backups
        add column if not exists title text,
        add column if not exists metadata jsonb not null default '{}'::jsonb;
      update pitch_deck_backups backup
        set title = deck.title
        from pitch_decks deck
        where backup.deck_id = deck.id and backup.title is null;
      alter table pitch_deck_backups alter column title set not null;

      create table if not exists pitch_editions (
        deck_id             text not null references pitch_decks (id) on delete cascade,
        edition_number      integer not null check (edition_number >= 1),
        draft_version       bigint not null check (draft_version >= 1),
        title               text not null check (char_length(title) between 1 and 120),
        owner_name          text not null check (char_length(owner_name) between 1 and 120),
        document            jsonb not null,
        thumbnail_asset_id  text,
        published_at        timestamptz not null default now(),
        primary key (deck_id, edition_number),
        constraint pitch_editions_document_size
          check (octet_length(document::text) <= 3145728)
      );
      create index if not exists pitch_editions_published_idx
        on pitch_editions (published_at desc, deck_id, edition_number desc);

      insert into pitch_editions (
        deck_id, edition_number, draft_version, title, owner_name, document,
        thumbnail_asset_id, published_at
      )
      select id, 1, published_version, published_title, owner_name, published_document,
             thumbnail_asset_id, published_at
        from pitch_decks
       where published_at is not null
      on conflict (deck_id, edition_number) do nothing;
      update pitch_decks
        set current_edition_number = 1
        where published_at is not null and current_edition_number is null;

      create table if not exists pitch_commands (
        deck_id          text not null references pitch_decks (id) on delete cascade,
        command_id       text not null,
        device_id        text not null,
        first_sequence   bigint not null check (first_sequence >= 1),
        last_sequence    bigint not null check (last_sequence >= first_sequence),
        base_version     bigint not null check (base_version >= 1),
        result_version   bigint not null check (result_version >= 1),
        operations       jsonb not null,
        result_title     text not null,
        result_document  jsonb not null,
        created_at       timestamptz not null default now(),
        primary key (deck_id, command_id),
        unique (deck_id, device_id, first_sequence, last_sequence),
        constraint pitch_commands_result_document_size
          check (octet_length(result_document::text) <= 3145728)
      );
      create index if not exists pitch_commands_created_idx
        on pitch_commands (created_at, deck_id);

      drop table if exists pitch_mutations;
    `,
  },
  {
    id: "0020_game_pool_default_entrances",
    sql: `
      alter table game_pool_entrances
        add column if not exists is_default boolean not null default false;

      create unique index if not exists game_pool_entrances_one_default_idx
        on game_pool_entrances (game)
        where is_default = true and retired_at is null;
    `,
  },
  {
    id: "0021_pitch_media_assets",
    sql: `
      alter table pitch_assets drop constraint if exists pitch_assets_kind_check;
      alter table pitch_assets
        add constraint pitch_assets_kind_check
        check (kind in ('image', 'audio', 'video', 'thumbnail'));
    `,
  },
  {
    id: "0022_pitch_operational_mode",
    sql: `
      create table if not exists pitch_platform_settings (
        singleton  boolean primary key default true check (singleton = true),
        mode       text not null default 'enabled'
          check (mode in ('enabled', 'read-only', 'off')),
        updated_at timestamptz not null default now()
      );
      insert into pitch_platform_settings (singleton, mode)
        values (true, 'enabled')
        on conflict (singleton) do nothing;
    `,
  },
  {
    id: "0023_pitch_document_media_frames",
    sql: `
      create function pitch_upgrade_document_media_frames(input_document jsonb)
      returns jsonb
      language plpgsql
      immutable
      as $migration$
      declare
        slide jsonb;
        clip jsonb;
        upgraded_slides jsonb := '[]'::jsonb;
        upgraded_clips jsonb;
        video_layer integer;
      begin
        if input_document is null then return null; end if;
        for slide in select value from jsonb_array_elements(input_document->'slides') loop
          upgraded_clips := '[]'::jsonb;
          video_layer := 0;
          for clip in
            select value from jsonb_array_elements(coalesce(slide->'mediaClips', '[]'::jsonb))
          loop
            if clip->>'kind' = 'video' and not clip ? 'videoPlacement' then
              clip := clip || jsonb_build_object(
                'videoPlacement',
                jsonb_build_object(
                  'x', 80,
                  'y', 45,
                  'width', 800,
                  'height', 450,
                  'layer', video_layer
                )
              );
            end if;
            if clip->>'kind' = 'video' then video_layer := video_layer + 1; end if;
            upgraded_clips := upgraded_clips || jsonb_build_array(clip);
          end loop;
          slide := jsonb_set(slide, '{mediaClips}', upgraded_clips, true);
          upgraded_slides := upgraded_slides || jsonb_build_array(slide);
        end loop;
        return jsonb_set(
          jsonb_set(input_document, '{schemaVersion}', '2'::jsonb, true),
          '{slides}',
          upgraded_slides,
          true
        );
      end;
      $migration$;

      update pitch_decks
        set draft_document = pitch_upgrade_document_media_frames(draft_document),
            published_document = case
              when published_document is null then null
              else pitch_upgrade_document_media_frames(published_document)
            end;
      update pitch_deck_backups
        set document = pitch_upgrade_document_media_frames(document);
      update pitch_editions
        set document = pitch_upgrade_document_media_frames(document);
      update pitch_commands
        set result_document = pitch_upgrade_document_media_frames(result_document);

      drop function pitch_upgrade_document_media_frames(jsonb);
    `,
  },
  {
    id: "0024_pitch_media_looping",
    sql: `
      create function pitch_add_media_loop_setting(input_document jsonb)
      returns jsonb
      language plpgsql
      immutable
      as $migration$
      declare
        slide jsonb;
        clip jsonb;
        upgraded_slides jsonb := '[]'::jsonb;
        upgraded_clips jsonb;
      begin
        if input_document is null then return null; end if;
        for slide in select value from jsonb_array_elements(input_document->'slides') loop
          upgraded_clips := '[]'::jsonb;
          for clip in
            select value from jsonb_array_elements(coalesce(slide->'mediaClips', '[]'::jsonb))
          loop
            if not clip ? 'loop' then clip := clip || jsonb_build_object('loop', false); end if;
            upgraded_clips := upgraded_clips || jsonb_build_array(clip);
          end loop;
          slide := jsonb_set(slide, '{mediaClips}', upgraded_clips, true);
          upgraded_slides := upgraded_slides || jsonb_build_array(slide);
        end loop;
        return jsonb_set(input_document, '{slides}', upgraded_slides, true);
      end;
      $migration$;

      update pitch_decks
        set draft_document = pitch_add_media_loop_setting(draft_document),
            published_document = case
              when published_document is null then null
              else pitch_add_media_loop_setting(published_document)
            end;
      update pitch_deck_backups
        set document = pitch_add_media_loop_setting(document);
      update pitch_editions
        set document = pitch_add_media_loop_setting(document);
      update pitch_commands
        set result_document = pitch_add_media_loop_setting(result_document);

      drop function pitch_add_media_loop_setting(jsonb);
    `,
  },
  {
    id: "0025_event_hero_dimensions",
    sql: `
      alter table events
        add column if not exists hero_image_width integer check (hero_image_width > 0),
        add column if not exists hero_image_height integer check (hero_image_height > 0);
    `,
  },
  {
    id: "0026_pitch_document_schema_contract",
    sql: `
      create function pitch_repair_document_audio_cues(input_document jsonb)
      returns jsonb
      language plpgsql
      immutable
      as $migration$
      declare
        slide jsonb;
        cue jsonb;
        upgraded_slides jsonb := '[]'::jsonb;
        upgraded_clips jsonb;
        slide_duration integer;
        source_duration integer;
        source_start integer;
        requested_duration integer;
        available_duration integer;
        timeline_start integer;
        clip_duration integer;
      begin
        if input_document is null then return null; end if;
        for slide in select value from jsonb_array_elements(input_document->'slides') loop
          upgraded_clips := coalesce(slide->'mediaClips', '[]'::jsonb);
          if jsonb_typeof(slide->'audioCues') = 'array'
             and jsonb_array_length(upgraded_clips) = 0 then
            slide_duration := coalesce((slide->>'durationMs')::integer, 15000);
            for cue in select value from jsonb_array_elements(slide->'audioCues') loop
              source_duration := (cue->>'sourceDurationMs')::integer;
              source_start := (cue->>'startAtMs')::integer;
              requested_duration := (cue->>'playForMs')::integer;
              available_duration := least(
                requested_duration,
                source_duration - source_start,
                slide_duration
              );
              if cue->>'trigger' = 'exit' then
                timeline_start := greatest(0, slide_duration - available_duration);
              else
                timeline_start := least((cue->>'delayMs')::integer, slide_duration);
              end if;
              clip_duration := least(available_duration, slide_duration - timeline_start);
              if clip_duration > 0 then
                upgraded_clips := upgraded_clips || jsonb_build_array(jsonb_build_object(
                  'id', cue->>'id',
                  'assetId', cue->>'assetId',
                  'kind', 'audio',
                  'timelineStartMs', timeline_start,
                  'sourceDurationMs', source_duration,
                  'sourceStartMs', source_start,
                  'durationMs', clip_duration,
                  'volume', cue->'volume',
                  'muted', false,
                  'loop', false,
                  'locked', false
                ));
              end if;
            end loop;
          end if;
          slide := jsonb_set(slide - 'audioCues', '{mediaClips}', upgraded_clips, true);
          upgraded_slides := upgraded_slides || jsonb_build_array(slide);
        end loop;
        return jsonb_set(
          jsonb_set(input_document, '{schemaVersion}', '2'::jsonb, true),
          '{slides}',
          upgraded_slides,
          true
        );
      end;
      $migration$;

      update pitch_decks
        set draft_document = pitch_repair_document_audio_cues(draft_document),
            published_document = case
              when published_document is null then null
              else pitch_repair_document_audio_cues(published_document)
            end;
      update pitch_deck_backups
        set document = pitch_repair_document_audio_cues(document);
      update pitch_editions
        set document = pitch_repair_document_audio_cues(document);
      update pitch_commands
        set result_document = pitch_repair_document_audio_cues(result_document);

      drop function pitch_repair_document_audio_cues(jsonb);

      do $migration$
      declare
        unsupported bigint;
      begin
        select count(*) into unsupported
          from (
            select draft_document as document from pitch_decks
            union all
            select published_document from pitch_decks where published_document is not null
            union all
            select document from pitch_deck_backups
            union all
            select document from pitch_editions
            union all
            select result_document from pitch_commands
          ) stored_documents
         where document->>'schemaVersion' is distinct from '2';

        if unsupported > 0 then
          raise exception 'Unsupported pitch document schemas remain after migration: %', unsupported;
        end if;
      end;
      $migration$;
    `,
  },
  {
    id: "0025_site_settings",
    sql: `
      create table if not exists site_settings (
        singleton          boolean primary key default true check (singleton = true),
        footer_party_path  text,
        updated_at         timestamptz not null default now(),
        check (
          footer_party_path is null
          or (
            char_length(footer_party_path) between 1 and 200
            and left(footer_party_path, 1) = '/'
            and left(footer_party_path, 2) <> '//'
          )
        )
      );

      insert into site_settings (singleton, footer_party_path)
        values (true, null)
        on conflict (singleton) do nothing;
    `,
  },
  {
    id: "0027_pitch_reminders",
    sql: `
      create table if not exists pitch_reminder_settings (
        singleton             boolean primary key default true check (singleton = true),
        enabled               boolean not null default false,
        inactivity_days       integer not null default 10
                              check (inactivity_days between 1 and 90),
        gap_days              integer not null default 14
                              check (gap_days between 1 and 90),
        max_automatic         integer not null default 3
                              check (max_automatic between 1 and 5),
        last_run_at           timestamptz,
        updated_at            timestamptz not null default now()
      );

      insert into pitch_reminder_settings (singleton)
        values (true)
        on conflict (singleton) do nothing;

      create table if not exists pitch_reminder_state (
        deck_id               text primary key references pitch_decks (id) on delete cascade,
        automatic_count       integer not null default 0 check (automatic_count >= 0),
        last_sent_at          timestamptz,
        last_template         text check (last_template in ('resume', 'finish', 'final')),
        paused_at             timestamptz,
        updated_at            timestamptz not null default now()
      );

      create index if not exists pitch_reminder_state_sent_idx
        on pitch_reminder_state (last_sent_at, deck_id);
    `,
  },
  {
    id: "0028_communications",
    sql: `
      alter table email_outbox
        add column if not exists communication_id uuid,
        add column if not exists cancelled_at timestamptz;

      alter table email_outbox drop constraint if exists email_outbox_channel_check;
      alter table email_outbox
        add constraint email_outbox_channel_check
        check (channel in ('tickets', 'studio', 'communications'));

      alter table email_outbox drop constraint if exists email_outbox_status_check;
      alter table email_outbox
        add constraint email_outbox_status_check
        check (status in ('pending', 'processing', 'accepted', 'failed', 'cancelled'));

      alter table email_outbox drop constraint if exists email_outbox_message_state;
      alter table email_outbox
        add constraint email_outbox_message_state
        check (
          (status in ('pending', 'processing') and message is not null)
          or (status in ('accepted', 'failed', 'cancelled') and message is null)
        );

      create index if not exists email_outbox_communication_idx
        on email_outbox (communication_id, status, next_attempt_at)
        where communication_id is not null;

      create table if not exists communication_contacts (
        email_hash          text primary key check (char_length(email_hash) = 64),
        email               text not null,
        display_name        text,
        sources             text[] not null default '{}',
        marketing_opted_in boolean not null default false,
        opted_in_at         timestamptz,
        opted_out_at        timestamptz,
        unsubscribe_token   uuid not null unique,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now()
      );

      create index if not exists communication_contacts_marketing_idx
        on communication_contacts (marketing_opted_in, updated_at desc);

      create table if not exists communication_messages (
        id                      uuid primary key,
        kind                    text not null check (kind in ('newsletter', 'event_update', 'pitch_nudge')),
        audience                text not null check (audience in ('marketing_opted_in', 'event_attendees', 'pitch_owners', 'selected')),
        event_slug              text references events (slug) on delete set null,
        subject                 text not null check (char_length(subject) between 1 and 150),
        body                    text not null check (char_length(body) between 1 and 8000),
        media                   jsonb not null default '[]'::jsonb,
        selected_contact_hashes text[] not null default '{}',
        scheduled_at            timestamptz,
        status                  text not null default 'draft' check (status in ('draft', 'scheduled', 'queued', 'cancelled', 'failed')),
        recipient_count         integer not null default 0 check (recipient_count >= 0),
        queued_count            integer not null default 0 check (queued_count >= 0),
        last_error              text,
        created_at              timestamptz not null default now(),
        updated_at              timestamptz not null default now(),
        queued_at               timestamptz,
        check (status = 'draft' or scheduled_at is not null)
      );

      create index if not exists communication_messages_schedule_idx
        on communication_messages (status, scheduled_at);
      create index if not exists communication_messages_event_idx
        on communication_messages (event_slug, created_at desc);
    `,
  },
  {
    id: "0029_communication_plans_and_surveys",
    sql: `
      alter table communication_messages
        drop constraint if exists communication_messages_kind_check;
      alter table communication_messages
        add constraint communication_messages_kind_check
        check (kind in ('newsletter', 'event_update', 'pitch_nudge', 'event_service', 'feedback'));

      create table if not exists communication_templates (
        id                  uuid primary key,
        name                text not null check (char_length(name) between 1 and 120),
        kind                text not null check (kind in ('newsletter', 'event_update', 'pitch_nudge', 'event_service', 'feedback')),
        subject             text not null check (char_length(subject) between 1 and 150),
        body                text not null check (char_length(body) between 1 and 8000),
        media               jsonb not null default '[]'::jsonb,
        is_default          boolean not null default false,
        archived_at         timestamptz,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now()
      );

      create index if not exists communication_templates_kind_idx
        on communication_templates (kind, archived_at, updated_at desc);

      create table if not exists communication_plans (
        id                  uuid primary key,
        event_slug          text not null references events (slug) on delete cascade,
        name                text not null check (char_length(name) between 1 and 160),
        status              text not null default 'draft'
                            check (status in ('draft', 'scheduled', 'paused', 'completed', 'cancelled')),
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now()
      );

      create index if not exists communication_plans_event_idx
        on communication_plans (event_slug, status, updated_at desc);

      create table if not exists communication_plan_stages (
        id                  uuid primary key,
        plan_id             uuid not null references communication_plans (id) on delete cascade,
        stage_key           text not null check (stage_key ~ '^[a-z0-9][a-z0-9_-]{1,60}$'),
        label               text not null check (char_length(label) between 1 and 120),
        position            integer not null check (position >= 0),
        kind                text not null check (kind in ('event_update', 'pitch_nudge', 'event_service', 'feedback')),
        audience            text not null default 'event_attendees'
                            check (audience in ('event_attendees', 'marketing_opted_in', 'selected')),
        subject             text not null check (char_length(subject) between 1 and 150),
        body                text not null check (char_length(body) between 1 and 8000),
        media               jsonb not null default '[]'::jsonb,
        template_id         uuid references communication_templates (id) on delete set null,
        survey_id           uuid,
        send_at             timestamptz,
        late_join_hours     integer not null default 0 check (late_join_hours between 0 and 720),
        status              text not null default 'draft'
                            check (status in ('draft', 'scheduled', 'fanout', 'queued', 'complete', 'paused', 'cancelled', 'failed')),
        recipient_count     integer not null default 0 check (recipient_count >= 0),
        queued_count        integer not null default 0 check (queued_count >= 0),
        last_error          text,
        queued_at           timestamptz,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now(),
        unique (plan_id, stage_key)
      );

      create index if not exists communication_plan_stages_due_idx
        on communication_plan_stages (status, send_at, position);

      create table if not exists communication_stage_deliveries (
        stage_id            uuid not null references communication_plan_stages (id) on delete cascade,
        email_hash          text not null references communication_contacts (email_hash) on delete cascade,
        email               text not null,
        status              text not null default 'queued'
                            check (status in ('queued', 'accepted', 'failed', 'skipped')),
        outbox_id            uuid,
        created_at           timestamptz not null default now(),
        updated_at           timestamptz not null default now(),
        primary key (stage_id, email_hash)
      );

      create table if not exists surveys (
        id                  uuid primary key,
        slug                text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]{1,80}$'),
        event_slug          text references events (slug) on delete set null,
        title               text not null check (char_length(title) between 1 and 160),
        intro               text not null default '' check (char_length(intro) <= 2000),
        questions           jsonb not null default '[]'::jsonb,
        status              text not null default 'draft'
                            check (status in ('draft', 'open', 'closed', 'archived')),
        response_count      integer not null default 0 check (response_count >= 0),
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now()
      );

      create index if not exists surveys_event_idx
        on surveys (event_slug, status, updated_at desc);

      create table if not exists survey_responses (
        id                  uuid primary key,
        survey_id           uuid not null references surveys (id) on delete cascade,
        respondent_email    text,
        email_hash          text,
        respondent_name     text,
        answers             jsonb not null default '{}'::jsonb,
        submitted_at        timestamptz not null default now(),
        check (respondent_email is null or char_length(respondent_email) <= 254),
        check (respondent_name is null or char_length(respondent_name) <= 160)
      );

      create unique index if not exists survey_responses_email_idx
        on survey_responses (survey_id, email_hash)
        where email_hash is not null;

      create index if not exists survey_responses_survey_idx
        on survey_responses (survey_id, submitted_at desc);
    `,
  },
  {
    id: "0030_game_pool_assignment_leases",
    sql: `
      alter table game_pool_assignments
        add column if not exists last_seen_at timestamptz not null default now();
      create index if not exists game_pool_assignments_lease_idx
        on game_pool_assignments (status, last_seen_at);
    `,
  },
  {
    id: "0031_email_engagement",
    sql: `
      alter table email_feedback_events rename to email_delivery_events;
      alter table email_delivery_events
        drop constraint if exists email_feedback_events_event_type_check;
      update email_delivery_events
         set event_type = case event_type
           when 'cf.email.sending.message.delivered' then 'delivered'
           when 'cf.email.sending.message.deferred' then 'deferred'
           when 'cf.email.sending.message.bounced' then 'bounced'
           when 'cf.email.sending.message.failed' then 'failed'
           when 'cf.email.sending.message.rejected' then 'rejected'
           when 'cf.email.sending.message.complained' then 'complained'
           else event_type
         end;
      alter table email_delivery_events
        add constraint email_delivery_events_event_type_check
        check (event_type in ('delivered', 'deferred', 'bounced', 'failed', 'rejected', 'complained'));
      alter index email_feedback_message_idx rename to email_delivery_message_idx;

      alter table email_outbox
        add column if not exists provider_delivery_status text,
        add column if not exists delivered_at timestamptz;

      alter table communication_stage_deliveries
        drop constraint if exists communication_stage_deliveries_status_check;
      alter table communication_stage_deliveries
        add constraint communication_stage_deliveries_status_check
        check (status in (
          'queued', 'accepted', 'delivered', 'deferred', 'failed',
          'bounced', 'rejected', 'complained', 'skipped'
        ));
      create index if not exists communication_stage_deliveries_outbox_idx
        on communication_stage_deliveries (outbox_id)
        where outbox_id is not null;

      create table communication_links (
        token_id          uuid primary key,
        source_type       text not null check (source_type in ('message', 'stage', 'test')),
        source_id         uuid not null,
        recipient_hash    text not null check (char_length(recipient_hash) = 64),
        link_key          text not null check (char_length(link_key) between 1 and 160),
        destination       text not null check (char_length(destination) between 1 and 2048),
        click_count       integer not null default 0 check (click_count >= 0),
        first_clicked_at  timestamptz,
        last_clicked_at   timestamptz,
        expires_at        timestamptz not null,
        created_at        timestamptz not null default now(),
        unique (source_type, source_id, recipient_hash, link_key)
      );

      create index communication_links_source_idx
        on communication_links (source_type, source_id, link_key)
        where click_count > 0;
      create index communication_links_expiry_idx
        on communication_links (expires_at);
    `,
  },
];

interface PitchDocumentSchemaRow extends QueryResultRow {
  version: string;
  count: string | number;
}

export async function readPitchDocumentSchemaInventory(): Promise<PitchDocumentSchemaInventory> {
  const rows = await query<PitchDocumentSchemaRow>(`
    select coalesce(document->>'schemaVersion', 'missing') as version, count(*) as count
      from (
        select draft_document as document from pitch_decks
        union all
        select published_document from pitch_decks where published_document is not null
        union all
        select document from pitch_deck_backups
        union all
        select document from pitch_editions
        union all
        select result_document from pitch_commands
      ) stored_documents
     group by coalesce(document->>'schemaVersion', 'missing')
     order by version
  `);
  const versions = Object.fromEntries(rows.map((row) => [row.version, Number(row.count)]));
  const total = Object.values(versions).reduce((sum, count) => sum + count, 0);
  const current = versions["2"] ?? 0;
  return {
    currentVersion: 2,
    total,
    current,
    unsupported: total - current,
    versions,
  };
}

export type MigrationResult = {
  applied: string[];
  alreadyApplied: number;
  pitchDocuments?: PitchDocumentSchemaInventory;
};

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

  const pitchDocuments = await readPitchDocumentSchemaInventory();
  if (pitchDocuments.unsupported > 0) {
    throw new Error(
      `Unsupported pitch document schemas remain: ${JSON.stringify(pitchDocuments.versions)}`,
    );
  }
  return { applied, alreadyApplied, pitchDocuments };
}

/** Test helper — the migration list, so tests can build a schema. */
export function __migrationsForTesting(): readonly Migration[] {
  return MIGRATIONS;
}
