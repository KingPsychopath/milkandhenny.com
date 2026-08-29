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
    id: "0025_site_settings_v2",
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
  {
    id: "0032_marketing_consent",
    sql: `
      alter table checkout_sessions
        add column if not exists marketing_opted_in boolean not null default false,
        add column if not exists marketing_opted_in_at timestamptz;

      create table if not exists communication_contact_consent_events (
        id               uuid primary key,
        email_hash       text not null references communication_contacts (email_hash) on delete cascade,
        decision         text not null check (decision in ('granted', 'withdrawn')),
        source           text not null check (source in ('subscribe', 'ticket_purchase', 'admin', 'unsubscribe')),
        source_ref       text check (source_ref is null or char_length(source_ref) <= 240),
        consent_version  text not null check (char_length(consent_version) between 1 and 80),
        occurred_at      timestamptz not null default now(),
        created_at       timestamptz not null default now()
      );

      create index if not exists communication_consent_events_contact_idx
        on communication_contact_consent_events (email_hash, occurred_at desc);
      create unique index if not exists communication_consent_events_source_ref_idx
        on communication_contact_consent_events (source, source_ref, decision)
        where source_ref is not null;
    `,
  },
  {
    id: "0033_marketing_consent_policy_version",
    sql: `
      alter table communication_contact_consent_events
        add column if not exists privacy_version text;
    `,
  },
  {
    id: "0034_event_scoring",
    sql: `
      -- Event scoring is deliberately relational. The ledger is immutable;
      -- projections, pools and public aliases are rebuildable views of it.
      create table if not exists event_people (
        id              text primary key,
        canonical_name  text,
        created_at      timestamptz not null default now(),
        updated_at      timestamptz not null default now()
      );

      create table if not exists event_person_identifiers (
        id              text primary key,
        person_id       text not null references event_people (id) on delete cascade,
        kind            text not null check (kind in ('email', 'account', 'passkey')),
        value_hash      text not null check (char_length(value_hash) = 64),
        verified_at     timestamptz,
        historical_until timestamptz,
        created_at      timestamptz not null default now(),
        unique (kind, value_hash)
      );

      create table if not exists event_participants (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        person_id       text references event_people (id) on delete set null,
        ticket_id       text unique references tickets (id) on delete restrict,
        public_alias    text not null check (char_length(public_alias) between 1 and 80),
        display_name    text,
        status          text not null default 'active'
                        check (status in ('active', 'refunded', 'void', 'disqualified', 'merged')),
        checked_in_at   timestamptz,
        created_at      timestamptz not null default now(),
        updated_at      timestamptz not null default now()
      );

      create index if not exists event_participants_event_idx
        on event_participants (event_slug, status, id);
      create index if not exists event_participants_person_idx
        on event_participants (person_id, event_slug);

      create table if not exists event_scoring_settings (
        event_slug                 text primary key references events (slug) on delete cascade,
        state                      text not null default 'off'
                                   check (state in ('off', 'ready', 'live', 'frozen', 'closed')),
        leaderboard_visibility     text not null default 'hidden'
                                   check (leaderboard_visibility in ('hidden', 'preview', 'public-live', 'public-final')),
        scheduled_start            timestamptz,
        scheduled_end              timestamptz,
        allow_precheckin_online_points boolean not null default false,
        public_names               text not null default 'generated'
                                   check (public_names in ('generated', 'choice', 'canonical')),
        public_ranking_policy      text not null default 'exclude-refunded'
                                   check (public_ranking_policy in ('include', 'exclude-refunded', 'exclude-disqualified')),
        photo_consent_policy       text not null default 'ask'
                                   check (photo_consent_policy in ('ask', 'required', 'not-required')),
        revision                   bigint not null default 1 check (revision >= 1),
        updated_at                 timestamptz not null default now()
      );

      create table if not exists score_teams (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        name            text not null check (char_length(name) between 1 and 120),
        status          text not null default 'active'
                        check (status in ('active', 'archived')),
        created_at      timestamptz not null default now()
      );

      create table if not exists score_team_memberships (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        team_id         text not null references score_teams (id) on delete restrict,
        participant_id  text not null references event_participants (id) on delete restrict,
        starts_at       timestamptz not null default now(),
        ends_at         timestamptz,
        created_at      timestamptz not null default now(),
        check (ends_at is null or ends_at > starts_at)
      );

      create index if not exists score_team_memberships_lookup_idx
        on score_team_memberships (event_slug, participant_id, starts_at desc);

      create table if not exists score_activities (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        name            text not null check (char_length(name) between 1 and 160),
        template        text not null check (template in (
          'winner', 'placement', 'participation', 'completion', 'team-result',
          'audience-vote', 'scan-to-award', 'free-form', 'check-in', 'discovery'
        )),
        status          text not null default 'draft'
                        check (status in ('draft', 'scheduled', 'live', 'paused', 'exhausted', 'ended', 'cancelled')),
        rule            jsonb not null,
        rule_revision   integer not null default 1 check (rule_revision >= 1),
        starts_at       timestamptz,
        ends_at         timestamptz,
        created_by      text,
        created_at      timestamptz not null default now(),
        updated_at      timestamptz not null default now()
      );

      create index if not exists score_activities_event_idx
        on score_activities (event_slug, status, starts_at, id);

      create table if not exists score_pools (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        activity_id     text references score_activities (id) on delete restrict,
        owner_type      text not null check (owner_type in ('event', 'staff', 'station', 'activity')),
        owner_id        text,
        issued_points   integer not null default 0 check (issued_points >= 0),
        reserved_points integer not null default 0 check (reserved_points >= 0),
        spent_points    integer not null default 0 check (spent_points >= 0),
        held_points     integer not null default 0 check (held_points >= 0),
        created_at      timestamptz not null default now(),
        updated_at      timestamptz not null default now(),
        check (issued_points >= reserved_points + spent_points + held_points)
      );

      create unique index if not exists score_pools_activity_idx
        on score_pools (activity_id) where activity_id is not null;
      create index if not exists score_pools_owner_idx
        on score_pools (event_slug, owner_type, owner_id);

      create table if not exists score_transactions (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        activity_id     text references score_activities (id) on delete restrict,
        source_type     text not null check (source_type in ('manual', 'game', 'discovery', 'check-in', 'transfer', 'reversal', 'correction')),
        source_id       text not null,
        idempotency_key text not null,
        status          text not null check (status in ('accepted', 'held', 'rejected', 'reversed')),
        reason_code     text not null,
        note            text,
        rule_revision   integer,
        actor_type      text not null check (actor_type in ('system', 'admin', 'staff', 'attendee')),
        actor_id        text,
        station_id      text,
        device_id       text,
        original_transaction_id text references score_transactions (id) on delete restrict,
        metadata        jsonb not null default '{}'::jsonb,
        created_at      timestamptz not null default now(),
        unique (event_slug, idempotency_key)
      );

      create unique index if not exists score_transactions_source_idx
        on score_transactions (event_slug, source_type, source_id)
        where source_type in ('game', 'discovery', 'check-in');
      create unique index if not exists score_reversals_original_idx
        on score_transactions (original_transaction_id)
        where source_type = 'reversal' and original_transaction_id is not null;
      create index if not exists score_transactions_event_idx
        on score_transactions (event_slug, created_at desc, id);
      create index if not exists score_transactions_activity_idx
        on score_transactions (activity_id, created_at desc);

      create table if not exists score_postings (
        id              text primary key,
        transaction_id  text not null references score_transactions (id) on delete restrict,
        event_slug      text not null references events (slug) on delete restrict,
        participant_id  text not null references event_participants (id) on delete restrict,
        team_id         text references score_teams (id) on delete restrict,
        points          integer not null check (points <> 0),
        created_at      timestamptz not null default now()
      );

      create index if not exists score_postings_participant_idx
        on score_postings (participant_id, created_at, id);
      create index if not exists score_postings_event_idx
        on score_postings (event_slug, created_at, id);

      create table if not exists score_projections (
        participant_id  text primary key references event_participants (id) on delete restrict,
        event_slug      text not null references events (slug) on delete restrict,
        balance         integer not null default 0,
        revision        bigint not null default 0 check (revision >= 0),
        last_transaction_at timestamptz,
        updated_at      timestamptz not null default now()
      );

      create index if not exists score_projections_event_idx
        on score_projections (event_slug, balance desc, participant_id);

      create table if not exists score_game_receipts (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        activity_id     text not null references score_activities (id) on delete restrict,
        game_kind       text not null,
        game_instance_id text not null,
        round_id        text,
        status          text not null default 'pending'
                        check (status in ('pending', 'processed', 'held', 'rejected', 'cancelled', 'corrected')),
        participants    jsonb not null,
        result          jsonb not null,
        source_key      text not null,
        current_transaction_id text references score_transactions (id) on delete restrict,
        corrected_by    text,
        created_at      timestamptz not null default now(),
        processed_at    timestamptz,
        unique (event_slug, source_key)
      );

      create table if not exists score_discoveries (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        activity_id     text not null references score_activities (id) on delete restrict,
        name            text not null check (char_length(name) between 1 and 160),
        method          text not null check (method in ('qr', 'code', 'word', 'phrase', 'collected-clues')),
        status          text not null default 'draft'
                        check (status in ('draft', 'scheduled', 'live', 'paused', 'exhausted', 'ended', 'cancelled')),
        token_hash      text unique,
        code_hash       text unique,
        rule            jsonb not null,
        replacement_revision integer not null default 1,
        created_at      timestamptz not null default now(),
        updated_at      timestamptz not null default now()
      );

      create table if not exists score_discovery_claims (
        id              text primary key,
        discovery_id    text not null references score_discoveries (id) on delete restrict,
        event_slug      text not null references events (slug) on delete restrict,
        participant_id  text not null references event_participants (id) on delete restrict,
        command_id      text not null,
        state           text not null check (state in ('accepted', 'held', 'rejected')),
        points          integer not null default 0 check (points >= 0),
        clue_key        text,
        created_at      timestamptz not null default now(),
        unique (discovery_id, participant_id, clue_key)
      );

      create table if not exists score_staff_assignments (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        label           text not null check (char_length(label) between 1 and 120),
        assignment_type text not null check (assignment_type in ('personal', 'station')),
        token_hash      text not null unique,
        permissions     jsonb not null default '{}'::jsonb,
        scope           jsonb not null default '{}'::jsonb,
        status          text not null default 'active'
                        check (status in ('active', 'paused', 'revoked', 'expired')),
        person_id       text references event_people (id) on delete set null,
        expires_at      timestamptz,
        created_at      timestamptz not null default now(),
        revoked_at      timestamptz
      );

      create table if not exists score_staff_devices (
        assignment_id   text not null references score_staff_assignments (id) on delete cascade,
        device_id       text not null,
        last_seen_at    timestamptz not null default now(),
        revoked_at      timestamptz,
        primary key (assignment_id, device_id)
      );

      create table if not exists score_audit_events (
        id              bigint generated always as identity primary key,
        event_slug      text not null references events (slug) on delete restrict,
        action          text not null,
        actor_type      text not null,
        actor_id        text,
        assignment_id   text,
        station_id      text,
        device_id       text,
        entity_type     text not null,
        entity_id       text not null,
        metadata        jsonb not null default '{}'::jsonb,
        created_at      timestamptz not null default now()
      );

      create index if not exists score_audit_event_lookup_idx
        on score_audit_events (event_slug, created_at desc, entity_type, entity_id);

      create table if not exists score_notifications (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        participant_id  text not null references event_participants (id) on delete restrict,
        transaction_id  text not null references score_transactions (id) on delete restrict,
        kind            text not null check (kind in ('positive', 'negative', 'held', 'reversal')),
        points          integer not null,
        delivered_at    timestamptz,
        created_at      timestamptz not null default now(),
        unique (participant_id, transaction_id)
      );

      create table if not exists score_media_links (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        activity_id     text references score_activities (id) on delete restrict,
        transaction_id  text references score_transactions (id) on delete restrict,
        participant_id  text references event_participants (id) on delete restrict,
        staff_actor_id  text,
        storage_ref     text not null,
        visibility      text not null check (visibility in ('event-album', 'admin-evidence', 'discard')),
        consent_state   text not null check (consent_state in ('not-requested', 'requested', 'obtained', 'declined')),
        expires_at      timestamptz,
        deleted_at      timestamptz,
        created_at      timestamptz not null default now()
      );

      create table if not exists score_prize_finalizations (
        event_slug      text primary key references events (slug) on delete restrict,
        status          text not null check (status in ('provisional', 'final')),
        finalized_by    text not null,
        reason          text,
        resolved_ties   boolean not null default false,
        created_at      timestamptz not null default now(),
        updated_at      timestamptz not null default now()
      );

      -- Ticket issuance creates a participant placeholder in the same
      -- database transaction. It never creates attendee identity or a cookie.
      create or replace function event_scoring_ticket_participant() returns trigger
      language plpgsql as $$
      begin
        insert into event_participants (id, event_slug, ticket_id, public_alias, display_name)
        values (
          'ep_' || substr(md5(new.id || clock_timestamp()::text), 1, 24),
          new.event_slug,
          new.id,
          'guest-' || substr(md5(new.id), 1, 8),
          new.holder_name
        )
        on conflict (ticket_id) do nothing;
        return new;
      end;
      $$;

      drop trigger if exists tickets_create_event_participant on tickets;
      create trigger tickets_create_event_participant
        after insert on tickets
        for each row execute function event_scoring_ticket_participant();

      insert into event_participants (id, event_slug, ticket_id, public_alias, display_name)
      select
        'ep_' || substr(md5(t.id || ':backfill'), 1, 24),
        t.event_slug,
        t.id,
        'guest-' || substr(md5(t.id), 1, 8),
        t.holder_name
      from tickets t
      where not exists (select 1 from event_participants p where p.ticket_id = t.id);
    `,
  },
  {
    id: "0035_event_identity_history",
    sql: `
      -- Slugs are route labels. event_id is the immutable identity used by
      -- new identity and scoring workflows; the existing event-owned tables
      -- retain their route FKs until their next focused schema revision.
      alter table events add column if not exists event_id text;
      update events
         set event_id = 'evt_' || substr(md5(slug || ':identity'), 1, 24)
       where event_id is null;
      alter table events
        alter column event_id set default ('evt_' || substr(md5(random()::text || clock_timestamp()::text), 1, 24)),
        alter column event_id set not null;
      create unique index if not exists events_event_id_idx on events (event_id);

      create table if not exists event_participant_merges (
        id                    text primary key,
        event_slug            text not null references events (slug) on delete restrict,
        source_participant_id text not null references event_participants (id) on delete restrict,
        target_participant_id text not null references event_participants (id) on delete restrict,
        actor_id              text not null,
        evidence              jsonb not null,
        reason                text not null,
        created_at            timestamptz not null default now(),
        reversed_at           timestamptz,
        reversed_by           text,
        reversal_reason       text,
        check (source_participant_id <> target_participant_id)
      );

      create index if not exists event_participant_merges_source_idx
        on event_participant_merges (source_participant_id, created_at desc);

      create unique index if not exists score_discovery_claims_once_idx
        on score_discovery_claims (discovery_id, participant_id)
        where clue_key is null;

      alter table score_discovery_claims
        add column if not exists transaction_id text references score_transactions (id) on delete restrict;

      -- All event-owned route FKs participate in one atomic slug move. This
      -- keeps the public slug mutable without making it a durable identity.
      alter table ticket_types drop constraint if exists ticket_types_event_slug_fkey;
      alter table ticket_types add constraint ticket_types_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table tickets drop constraint if exists tickets_event_slug_ticket_type_id_fkey;
      alter table tickets add constraint tickets_event_slug_ticket_type_id_fkey
        foreign key (event_slug, ticket_type_id) references ticket_types(event_slug, id) on update cascade on delete restrict;
      alter table checkout_sessions drop constraint if exists checkout_sessions_event_slug_fkey;
      alter table checkout_sessions add constraint checkout_sessions_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table checkpoints drop constraint if exists checkpoints_event_slug_fkey;
      alter table checkpoints add constraint checkpoints_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table checkpoint_usage drop constraint if exists checkpoint_usage_event_slug_checkpoint_id_fkey;
      alter table checkpoint_usage add constraint checkpoint_usage_event_slug_checkpoint_id_fkey
        foreign key (event_slug, checkpoint_id) references checkpoints(event_slug, id) on update cascade on delete cascade;
      alter table scanner_links drop constraint if exists scanner_links_event_slug_checkpoint_id_fkey;
      alter table scanner_links add constraint scanner_links_event_slug_checkpoint_id_fkey
        foreign key (event_slug, checkpoint_id) references checkpoints(event_slug, id) on update cascade on delete cascade;
      alter table scanner_links drop constraint if exists scanner_links_event_slug_fkey;
      alter table scanner_links add constraint scanner_links_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table guest_requests drop constraint if exists guest_requests_event_slug_fkey;
      alter table guest_requests add constraint guest_requests_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table event_drops drop constraint if exists event_drops_event_slug_fkey;
      alter table event_drops add constraint event_drops_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table communication_messages drop constraint if exists communication_messages_event_slug_fkey;
      alter table communication_messages add constraint communication_messages_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete set null;
      alter table communication_plans drop constraint if exists communication_plans_event_slug_fkey;
      alter table communication_plans add constraint communication_plans_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table surveys drop constraint if exists surveys_event_slug_fkey;
      alter table surveys add constraint surveys_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete set null;
      alter table event_participants drop constraint if exists event_participants_event_slug_fkey;
      alter table event_participants add constraint event_participants_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table event_scoring_settings drop constraint if exists event_scoring_settings_event_slug_fkey;
      alter table event_scoring_settings add constraint event_scoring_settings_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete cascade;
      alter table score_teams drop constraint if exists score_teams_event_slug_fkey;
      alter table score_teams add constraint score_teams_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_team_memberships drop constraint if exists score_team_memberships_event_slug_fkey;
      alter table score_team_memberships add constraint score_team_memberships_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_activities drop constraint if exists score_activities_event_slug_fkey;
      alter table score_activities add constraint score_activities_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_pools drop constraint if exists score_pools_event_slug_fkey;
      alter table score_pools add constraint score_pools_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_transactions drop constraint if exists score_transactions_event_slug_fkey;
      alter table score_transactions add constraint score_transactions_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_postings drop constraint if exists score_postings_event_slug_fkey;
      alter table score_postings add constraint score_postings_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_projections drop constraint if exists score_projections_event_slug_fkey;
      alter table score_projections add constraint score_projections_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_game_receipts drop constraint if exists score_game_receipts_event_slug_fkey;
      alter table score_game_receipts add constraint score_game_receipts_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_discoveries drop constraint if exists score_discoveries_event_slug_fkey;
      alter table score_discoveries add constraint score_discoveries_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_discovery_claims drop constraint if exists score_discovery_claims_event_slug_fkey;
      alter table score_discovery_claims add constraint score_discovery_claims_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_staff_assignments drop constraint if exists score_staff_assignments_event_slug_fkey;
      alter table score_staff_assignments add constraint score_staff_assignments_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_audit_events drop constraint if exists score_audit_events_event_slug_fkey;
      alter table score_audit_events add constraint score_audit_events_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_notifications drop constraint if exists score_notifications_event_slug_fkey;
      alter table score_notifications add constraint score_notifications_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_media_links drop constraint if exists score_media_links_event_slug_fkey;
      alter table score_media_links add constraint score_media_links_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table score_prize_finalizations drop constraint if exists score_prize_finalizations_event_slug_fkey;
      alter table score_prize_finalizations add constraint score_prize_finalizations_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
      alter table event_participant_merges drop constraint if exists event_participant_merges_event_slug_fkey;
      alter table event_participant_merges add constraint event_participant_merges_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;
    `,
  },
  {
    id: "0036_event_scoring_integrity",
    sql: `
      create unique index if not exists score_discovery_claims_command_idx
        on score_discovery_claims (discovery_id, command_id);

      create or replace function prevent_score_ledger_mutation() returns trigger
      language plpgsql as $$
      begin
        if tg_table_name = 'score_transactions' then
          if tg_op = 'UPDATE'
             and old.status = 'held'
             and new.status = 'accepted'
             and (to_jsonb(old) - 'status') = (to_jsonb(new) - 'status') then
            return new;
          end if;
        end if;
        raise exception 'score ledger rows are immutable';
      end;
      $$;

      drop trigger if exists score_transactions_immutable on score_transactions;
      create trigger score_transactions_immutable
        before update or delete on score_transactions
        for each row execute function prevent_score_ledger_mutation();

      drop trigger if exists score_postings_immutable on score_postings;
      create trigger score_postings_immutable
        before update or delete on score_postings
        for each row execute function prevent_score_ledger_mutation();
    `,
  },
  {
    id: "0037_event_scoring_settlement",
    sql: `
      alter table score_game_receipts
        add column if not exists current_transaction_id text references score_transactions (id) on delete restrict;
      create unique index if not exists score_reversals_original_idx
        on score_transactions (original_transaction_id)
        where source_type = 'reversal' and original_transaction_id is not null;
    `,
  },
  {
    id: "0038_official_game_result_overlay",
    sql: `
      drop table if exists score_game_receipts cascade;

      create table event_game_score_bindings (
        channel_id       text primary key,
        event_id         text not null references events (event_id) on delete restrict,
        activity_id      text not null references score_activities (id) on delete restrict,
        game_kind        text not null check (game_kind in (
          'centre', 'twin', 'draw-country', 'same-brain', 'spelling-party'
        )),
        game_instance_id text,
        accepted_scope   text not null check (accepted_scope in ('round', 'match', 'game')),
        status           text not null default 'provisioning'
                         check (status in ('provisioning', 'active', 'paused', 'closed')),
        created_at       timestamptz not null default now(),
        updated_at       timestamptz not null default now(),
        unique (game_kind, game_instance_id)
      );

      create index event_game_score_bindings_event_idx
        on event_game_score_bindings (event_id, status, game_kind);

      create table event_game_player_links (
        channel_id       text not null references event_game_score_bindings (channel_id) on delete restrict,
        game_player_id   text not null,
        participant_id   text not null references event_participants (id) on delete restrict,
        created_at       timestamptz not null default now(),
        primary key (channel_id, game_player_id),
        unique (channel_id, participant_id)
      );

      create table official_game_results (
        id               text primary key,
        channel_id       text not null references event_game_score_bindings (channel_id) on delete restrict,
        game_kind        text not null,
        game_instance_id text not null,
        result_id        text not null,
        revision         integer not null check (revision >= 1),
        operation        text not null check (operation in ('record', 'cancel')),
        scope            text not null check (scope in ('round', 'match', 'game')),
        players          jsonb not null,
        payload_hash     text not null check (char_length(payload_hash) = 64),
        status           text not null default 'pending'
                         check (status in ('pending', 'processed', 'ignored', 'held')),
        held_reason      text,
        committed_at     timestamptz not null,
        ingested_at      timestamptz not null default now(),
        processed_at     timestamptz,
        unique (channel_id, result_id, revision)
      );

      create index official_game_results_pending_idx
        on official_game_results (status, ingested_at, id)
        where status in ('pending', 'held');

      create table score_game_receipts (
        id                   text primary key,
        official_result_id   text not null unique references official_game_results (id) on delete restrict,
        event_id             text not null references events (event_id) on delete restrict,
        activity_id          text not null references score_activities (id) on delete restrict,
        transaction_id       text references score_transactions (id) on delete restrict,
        reversal_transaction_id text references score_transactions (id) on delete restrict,
        status               text not null check (status in ('processed', 'ignored', 'held', 'cancelled', 'corrected')),
        reason               text,
        created_at           timestamptz not null default now(),
        updated_at           timestamptz not null default now()
      );
    `,
  },
  {
    id: "0039_discovery_collections",
    sql: `
      create table score_discovery_clues (
        id                   text primary key,
        discovery_id         text not null references score_discoveries (id) on delete cascade,
        clue_key             text not null check (char_length(clue_key) between 1 and 80),
        label                text not null check (char_length(label) between 1 and 160),
        token_hash           text not null unique check (char_length(token_hash) = 64),
        replacement_revision integer not null default 1 check (replacement_revision >= 1),
        created_at           timestamptz not null default now(),
        updated_at           timestamptz not null default now(),
        unique (discovery_id, clue_key)
      );

      create index score_discovery_clues_discovery_idx
        on score_discovery_clues (discovery_id, clue_key);
    `,
  },
  {
    id: "0040_event_scoring_public_identity",
    sql: `
      alter table event_participants
        add column display_mode text not null default 'alias'
          check (display_mode in ('alias', 'anonymous', 'hidden'));

      create unique index event_participants_public_alias_idx
        on event_participants (event_slug, lower(public_alias));
    `,
  },
  {
    id: "0041_event_scoring_offline_reservations",
    sql: `
      create table if not exists score_offline_reservations (
        id              text primary key,
        event_slug      text not null references events (slug) on delete restrict,
        assignment_id   text not null references score_staff_assignments (id) on delete restrict,
        device_id       text not null,
        activity_id     text not null references score_activities (id) on delete restrict,
        pool_id         text not null references score_pools (id) on delete restrict,
        issued_points   integer not null check (issued_points > 0),
        spent_points    integer not null default 0 check (spent_points >= 0),
        status          text not null default 'active' check (status in ('active', 'closed', 'expired')),
        expires_at      timestamptz not null,
        created_at      timestamptz not null default now(),
        closed_at       timestamptz,
        check (spent_points <= issued_points)
      );

      create unique index if not exists score_offline_reservations_device_idx
        on score_offline_reservations (assignment_id, device_id, activity_id)
        where status = 'active';

      create table if not exists score_offline_commands (
        command_id            text primary key,
        reservation_id        text not null references score_offline_reservations (id) on delete restrict,
        local_sequence        integer not null check (local_sequence >= 1),
        participant_proof_hash text not null check (char_length(participant_proof_hash) = 64),
        result                jsonb not null,
        device_time           timestamptz not null,
        state                 text not null check (state in ('accepted', 'held', 'rejected')),
        reason                text,
        transaction_id        text references score_transactions (id) on delete restrict,
        created_at            timestamptz not null default now(),
        unique (reservation_id, local_sequence)
      );
    `,
  },
  {
    id: "0042_event_scoring_anomaly_review",
    sql: `
      alter table event_scoring_settings
        add column allow_staff_self_awards boolean not null default false;

      create table score_anomaly_flags (
        id              bigint generated always as identity primary key,
        event_slug      text not null references events (slug) on delete restrict,
        transaction_id  text references score_transactions (id) on delete restrict,
        participant_id  text references event_participants (id) on delete restrict,
        activity_id     text references score_activities (id) on delete restrict,
        actor_id        text,
        assignment_id   text,
        station_id      text,
        device_id       text,
        signal          text not null,
        detail          jsonb not null default '{}'::jsonb,
        state           text not null default 'open' check (state in ('open', 'reviewed', 'dismissed')),
        created_at      timestamptz not null default now()
      );

      create index score_anomaly_flags_review_idx
        on score_anomaly_flags (event_slug, state, created_at desc);
    `,
  },
  {
    id: "0043_event_scoring_activity_templates",
    sql: `
      create table score_activity_templates (
        id                text primary key,
        name              text not null check (char_length(name) between 1 and 160),
        activity_template text not null check (activity_template in
          ('winner','placement','participation','completion','team-result','audience-vote',
           'scan-to-award','free-form','check-in','discovery')),
        rule              jsonb not null,
        created_by        text not null,
        created_at        timestamptz not null default now(),
        updated_at        timestamptz not null default now()
      );

      create index score_activity_templates_owner_idx
        on score_activity_templates (created_by, updated_at desc);
      create unique index score_activity_templates_name_idx
        on score_activity_templates (created_by, lower(name));
    `,
  },
  {
    id: "0044_event_scoring_operations",
    sql: `
      create table score_operational_events (
        id          bigint generated always as identity primary key,
        event_slug  text not null references events (slug) on delete restrict,
        kind        text not null check (kind in ('write-failure','session-failure','media-failure')),
        detail      jsonb not null default '{}'::jsonb,
        created_at  timestamptz not null default now()
      );
      create index score_operational_events_window_idx
        on score_operational_events (event_slug, kind, created_at desc);
    `,
  },
  {
    id: "0045_event_scoring_extended_games",
    sql: `
      alter table event_game_score_bindings
        drop constraint event_game_score_bindings_game_kind_check;
      alter table event_game_score_bindings
        add constraint event_game_score_bindings_game_kind_check check (game_kind in (
          'centre', 'twin', 'draw-country', 'same-brain', 'spelling-party',
          'liars', 'pitches', 'heads-up', 'spelling-bee', 'icebreaker'
        ));
    `,
  },
  {
    id: "0046_event_participant_public_names",
    sql: `
      alter table event_participants
        rename column public_alias to generated_alias;
      alter table event_participants
        add column chosen_alias text
          check (
            chosen_alias is null or (
              char_length(chosen_alias) between 2 and 40
              and chosen_alias !~* '^(guest|player|removed)-[0-9a-f]+$'
            )
          );

      drop index if exists event_participants_public_alias_idx;
      create unique index event_participants_generated_alias_idx
        on event_participants (event_slug, lower(generated_alias));
      create unique index event_participants_chosen_alias_idx
        on event_participants (event_slug, lower(chosen_alias))
        where chosen_alias is not null;

      create or replace function event_scoring_ticket_participant() returns trigger
      language plpgsql as $$
      begin
        insert into event_participants
          (id, event_slug, ticket_id, generated_alias, display_name)
        values (
          'ep_' || substr(md5(new.id || clock_timestamp()::text), 1, 24),
          new.event_slug,
          new.id,
          'guest-' || substr(md5(new.id), 1, 8),
          new.holder_name
        )
        on conflict (ticket_id) do nothing;
        return new;
      end;
      $$;
    `,
  },
  {
    id: "0047_ticket_exchanges",
    sql: `
      create table ticket_exchanges (
        id                 text primary key
                           check (id ~ '^tex_[A-Za-z0-9_-]{16,64}$'),
        event_slug         text not null references events (slug) on delete restrict,
        order_id           text not null,
        ticket_id          text not null references tickets (id) on delete restrict,
        from_ticket_type_id text not null,
        to_ticket_type_id  text not null,
        actor_type         text not null check (actor_type in ('purchaser', 'admin')),
        status             text not null
                           check (status in (
                             'processing', 'awaiting_payment', 'refund_pending',
                             'completed', 'failed', 'cancelled', 'expired'
                           )),
        amount_delta_minor integer not null,
        currency           text not null,
        checkout_ref       text unique,
        payment_ref        text unique,
        dispute_ref        text,
        error_message      text,
        created_at         timestamptz not null default now(),
        updated_at         timestamptz not null default now(),
        completed_at       timestamptz,
        foreign key (event_slug, from_ticket_type_id)
          references ticket_types (event_slug, id) on delete restrict,
        foreign key (event_slug, to_ticket_type_id)
          references ticket_types (event_slug, id) on delete restrict
      );

      create unique index ticket_exchanges_active_ticket_idx
        on ticket_exchanges (ticket_id)
        where status in ('processing', 'awaiting_payment', 'refund_pending');
      create index ticket_exchanges_order_idx
        on ticket_exchanges (order_id, created_at desc);
      create index ticket_exchanges_payment_idx
        on ticket_exchanges (payment_ref);

      create table ticket_exchange_refunds (
        exchange_id   text not null references ticket_exchanges (id) on delete restrict,
        payment_ref   text not null,
        amount_minor  integer not null check (amount_minor > 0),
        refund_ref    text unique,
        status        text not null
                      check (status in ('processing', 'pending', 'succeeded', 'failed')),
        updated_at    timestamptz not null default now(),
        primary key (exchange_id, payment_ref)
      );

      create index ticket_exchange_refunds_payment_idx
        on ticket_exchange_refunds (payment_ref, status);
    `,
  },
  {
    id: "0048_repeatable_discovery_cooldowns",
    sql: `
      update score_discoveries
         set rule = rule || '{"claimFrequency":"once"}'::jsonb
       where not (rule ? 'claimFrequency');

      drop index if exists score_discovery_claims_once_idx;

      create index if not exists score_discovery_claims_participant_recent_idx
        on score_discovery_claims (discovery_id, participant_id, created_at desc)
        where state in ('accepted', 'held');
    `,
  },
  {
    id: "0049_checkout_capacity_holds",
    sql: `
      alter table checkout_sessions
        add column checkout_url text,
        add column expires_at timestamptz not null default (now() + interval '30 minutes');

      create index checkout_sessions_capacity_idx
        on checkout_sessions (event_slug, ticket_type_id, status, expires_at);
      create index checkout_sessions_email_capacity_idx
        on checkout_sessions (event_slug, ticket_type_id, email_hash, status, expires_at);

      create or replace function enforce_event_capacity_floor() returns trigger
      language plpgsql as $$
      declare
        committed integer;
      begin
        if new.capacity is null then return new; end if;
        select
          (select count(*) from tickets
            where event_slug = old.slug and status = 'valid')
          +
          (select coalesce(sum(quantity), 0) from checkout_sessions
            where event_slug = old.slug
              and (
                (status in ('creating', 'pending') and expires_at > now())
                or status in ('payment_pending', 'fulfilling', 'payment_mismatch')
              ))
          into committed;
        if new.capacity < committed then
          raise exception 'Event capacity cannot be lower than % committed places', committed
            using errcode = '23514';
        end if;
        return new;
      end;
      $$;

      create trigger events_capacity_floor
        before update of capacity on events
        for each row execute function enforce_event_capacity_floor();

      create or replace function enforce_ticket_type_capacity_floor() returns trigger
      language plpgsql as $$
      declare
        committed integer;
        target_quantity integer;
      begin
        select
          (select count(*) from tickets
            where event_slug = old.event_slug and ticket_type_id = old.id and status = 'valid')
          +
          (select coalesce(sum(quantity), 0) from checkout_sessions
            where event_slug = old.event_slug and ticket_type_id = old.id
              and (
                (status in ('creating', 'pending') and expires_at > now())
                or status in ('payment_pending', 'fulfilling', 'payment_mismatch')
              ))
          +
          (select count(*) from ticket_exchanges
            where event_slug = old.event_slug and to_ticket_type_id = old.id
              and status in ('processing', 'awaiting_payment', 'refund_pending'))
          into committed;
        target_quantity := case when tg_op = 'DELETE' then 0 else new.quantity end;
        if target_quantity < committed then
          raise exception 'Ticket type % cannot be lower than % committed places', old.id, committed
            using errcode = '23514';
        end if;
        if tg_op = 'DELETE' then return old; end if;
        return new;
      end;
      $$;

      create trigger ticket_types_capacity_floor
        before update of quantity or delete on ticket_types
        for each row execute function enforce_ticket_type_capacity_floor();
    `,
  },
  {
    id: "0050_complete_event_slug_cascades",
    sql: `
      -- These event-owned tables were introduced after the original slug
      -- cascade migration. Keep a slug edit atomic across every newer child.
      alter table score_offline_reservations
        drop constraint score_offline_reservations_event_slug_fkey;
      alter table score_offline_reservations
        add constraint score_offline_reservations_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;

      alter table score_anomaly_flags
        drop constraint score_anomaly_flags_event_slug_fkey;
      alter table score_anomaly_flags
        add constraint score_anomaly_flags_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;

      alter table score_operational_events
        drop constraint score_operational_events_event_slug_fkey;
      alter table score_operational_events
        add constraint score_operational_events_event_slug_fkey
        foreign key (event_slug) references events(slug) on update cascade on delete restrict;

      alter table ticket_exchanges
        drop constraint ticket_exchanges_event_slug_fkey,
        drop constraint ticket_exchanges_event_slug_from_ticket_type_id_fkey,
        drop constraint ticket_exchanges_event_slug_to_ticket_type_id_fkey;
      alter table ticket_exchanges
        add constraint ticket_exchanges_event_slug_fkey
          foreign key (event_slug) references events(slug) on update cascade on delete restrict,
        add constraint ticket_exchanges_event_slug_from_ticket_type_id_fkey
          foreign key (event_slug, from_ticket_type_id)
          references ticket_types(event_slug, id) on update cascade on delete restrict,
        add constraint ticket_exchanges_event_slug_to_ticket_type_id_fkey
          foreign key (event_slug, to_ticket_type_id)
          references ticket_types(event_slug, id) on update cascade on delete restrict;
    `,
  },
  {
    id: "0051_attendee_person_access",
    sql: `
      -- Passwordless access upgrades the existing anonymous attendee session.
      -- Challenges are short-lived and one-use; only hashes of credentials are
      -- retained. The destination is constrained to a local path in the app.
      alter table event_person_identifiers
        add column display_hint text check (display_hint is null or char_length(display_hint) <= 254);

      create table event_person_login_challenges (
        id                    text primary key,
        email                 text not null check (char_length(email) between 3 and 254),
        email_hash            text not null check (char_length(email_hash) = 64),
        token_hash            text not null unique check (char_length(token_hash) = 64),
        code_hash             text not null check (char_length(code_hash) = 64),
        purpose               text not null default 'sign-in'
                              check (purpose in ('sign-in', 'add-email')),
        person_id_hint        text references event_people (id) on delete cascade,
        return_to             text not null default '/my'
                              check (return_to like '/%' and return_to not like '//%'),
        attempts              integer not null default 0 check (attempts between 0 and 6),
        expires_at            timestamptz not null,
        consumed_at           timestamptz,
        consumed_person_id    text references event_people (id) on delete set null,
        consumed_session_hash text check (
                                consumed_session_hash is null
                                or char_length(consumed_session_hash) = 64
                              ),
        created_at            timestamptz not null default now(),
        check (
          (purpose = 'sign-in' and person_id_hint is null)
          or (purpose = 'add-email' and person_id_hint is not null)
        )
      );

      create index event_person_login_challenges_email_idx
        on event_person_login_challenges (email_hash, created_at desc);
      create index event_person_login_challenges_expiry_idx
        on event_person_login_challenges (expires_at)
        where consumed_at is null;

      -- The participant remains the scoring identity. This table records why
      -- its optional person link exists and preserves release/dispute history.
      create table event_ticket_identity_claims (
        id              text primary key,
        event_slug      text not null references events (slug)
                        on update cascade on delete restrict,
        ticket_id       text not null references tickets (id) on delete restrict,
        participant_id  text not null references event_participants (id) on delete restrict,
        person_id       text not null references event_people (id) on delete restrict,
        identifier_id   text references event_person_identifiers (id) on delete set null,
        status          text not null default 'active'
                        check (status in ('active', 'released', 'disputed')),
        source          text not null check (source in ('ticket-and-email', 'admin-review')),
        claimed_at      timestamptz not null default now(),
        released_at     timestamptz,
        release_reason  text,
        check (
          (status = 'active' and released_at is null)
          or (status <> 'active' and released_at is not null)
        )
      );

      create unique index event_ticket_identity_claims_active_ticket_idx
        on event_ticket_identity_claims (ticket_id) where status = 'active';
      create unique index event_ticket_identity_claims_active_participant_idx
        on event_ticket_identity_claims (participant_id) where status = 'active';
      create index event_ticket_identity_claims_person_idx
        on event_ticket_identity_claims (person_id, claimed_at desc);

      -- Purchaser recovery is separate from attendee ownership. Verifying an
      -- order email may grant management, but never claims any child ticket.
      create table event_order_managers (
        id              text primary key,
        event_slug      text not null references events (slug)
                        on update cascade on delete restrict,
        order_id        text not null,
        person_id       text not null references event_people (id) on delete cascade,
        identifier_id   text references event_person_identifiers (id) on delete set null,
        role            text not null default 'owner' check (role in ('owner', 'manager')),
        source          text not null check (source in ('verified-purchaser-email', 'admin')),
        status          text not null default 'active' check (status in ('active', 'revoked')),
        created_at      timestamptz not null default now(),
        revoked_at      timestamptz,
        check (
          (status = 'active' and revoked_at is null)
          or (status = 'revoked' and revoked_at is not null)
        )
      );

      create unique index event_order_managers_active_idx
        on event_order_managers (order_id, person_id) where status = 'active';
      create index event_order_managers_person_idx
        on event_order_managers (person_id, event_slug, created_at desc);
    `,
  },
  {
    id: "0052_event_discovery_independence",
    sql: `
      alter table score_discoveries
        drop constraint score_discoveries_activity_id_fkey,
        alter column activity_id drop not null;

      alter table score_discoveries
        add constraint score_discoveries_activity_id_fkey
          foreign key (activity_id) references score_activities (id) on delete set null;
    `,
  },
  {
    id: "0053_email_operations_ledger",
    sql: `
      alter table email_outbox
        add column kind text,
        add column source text not null default 'system',
        add column context jsonb not null default '{}'::jsonb,
        add column recipient_hint text,
        add column subject_hint text,
        add column content_expires_at timestamptz not null default (now() + interval '7 days'),
        add column retain_until timestamptz not null default (now() + interval '120 days');

      update email_outbox
         set kind = case
           when idempotency_key like 'tickets:issued:%' then 'ticket-issued'
           when idempotency_key like 'tickets:admin-resend:%' then 'ticket-resend'
           when idempotency_key like 'tickets:resend:%' then 'ticket-resend'
           when idempotency_key like 'tickets:refund:%' then 'ticket-refund'
           when idempotency_key like 'tickets:exchange-payment:%' then 'ticket-exchange-payment'
           when idempotency_key like 'tickets:exchange:%' then 'ticket-exchange'
           when idempotency_key like 'attendee-access:%' then 'attendee-access'
           when idempotency_key like 'events:broadcast:%' then 'event-broadcast'
           when idempotency_key like 'communication-stage:%' then 'communication-stage'
           when idempotency_key like 'communication-test:%' then 'communication-test'
           when idempotency_key like 'communications:%' then 'communication'
           when idempotency_key like 'pitches:welcome:%' then 'pitch-welcome'
           when idempotency_key like 'pitches:published:%' then 'pitch-published'
           when idempotency_key like 'pitches:recovery:%' then 'pitch-recovery'
           when idempotency_key like 'pitches:%' then 'pitch-reminder'
           else case channel
             when 'tickets' then 'event-broadcast'
             when 'studio' then 'pitch-reminder'
             else 'communication'
           end
         end,
             subject_hint = left(message->>'subject', 200),
             recipient_hint = case
               when position('@' in coalesce(message->>'to', '')) > 1 then
                 left(message->>'to', 1) || '…@' || split_part(message->>'to', '@', 2)
               else null
             end;

      update email_outbox
         set subject_hint = coalesce(subject_hint, case kind
               when 'ticket-issued' then 'Ticket confirmation'
               when 'ticket-resend' then 'Ticket confirmation'
               when 'ticket-refund' then 'Refund confirmation'
               when 'ticket-exchange' then 'Ticket changed'
               when 'ticket-exchange-payment' then 'Complete ticket change'
               when 'attendee-access' then 'Access link'
               when 'event-broadcast' then 'Event message'
               when 'communication' then 'Communication'
               when 'communication-stage' then 'Scheduled communication'
               when 'communication-test' then 'Communication test'
               when 'pitch-welcome' then 'Pitch welcome'
               when 'pitch-published' then 'Pitch published'
               when 'pitch-recovery' then 'Pitch recovery'
               when 'pitch-reminder' then 'Pitch reminder'
             end),
             context = case
               when kind in ('ticket-issued', 'ticket-resend', 'ticket-refund')
                 then jsonb_build_object('orderId', split_part(idempotency_key, ':', 3))
               when kind in ('ticket-exchange', 'ticket-exchange-payment')
                 then jsonb_build_object('exchangeId', split_part(idempotency_key, ':', 3))
               when kind = 'event-broadcast'
                 then jsonb_build_object('eventSlug', split_part(idempotency_key, ':', 3))
               when kind in ('pitch-welcome', 'pitch-published')
                 then jsonb_build_object('deckId', split_part(idempotency_key, ':', 3))
               else context
             end;

      alter table email_outbox alter column kind set not null;
      alter table email_outbox
        add constraint email_outbox_kind_check check (kind in (
          'ticket-issued', 'ticket-resend', 'ticket-refund', 'ticket-exchange',
          'ticket-exchange-payment', 'attendee-access', 'event-broadcast',
          'communication', 'communication-stage', 'communication-test',
          'pitch-welcome', 'pitch-published', 'pitch-recovery', 'pitch-reminder'
        )),
        add constraint email_outbox_source_check
          check (source in ('system', 'admin', 'self-service', 'scheduled', 'test')),
        add constraint email_outbox_context_size_check
          check (octet_length(context::text) <= 4096),
        add constraint email_outbox_recipient_hint_check
          check (recipient_hint is null or char_length(recipient_hint) <= 254),
        add constraint email_outbox_subject_hint_check
          check (subject_hint is null or char_length(subject_hint) <= 200),
        add constraint email_outbox_retention_check
          check (retain_until >= created_at);

      create index email_outbox_ledger_idx on email_outbox (created_at desc, id desc);
      create index email_outbox_recipient_idx on email_outbox (recipient_hash, created_at desc);
      create index email_outbox_kind_idx on email_outbox (kind, created_at desc);
      create index email_outbox_retention_idx
        on email_outbox (retain_until) where status in ('accepted', 'failed', 'cancelled');

      alter table email_suppressions
        add column recipient_hint text
        check (recipient_hint is null or char_length(recipient_hint) <= 254);

      alter table communication_stage_deliveries
        add constraint communication_stage_deliveries_outbox_fk
        foreign key (outbox_id) references email_outbox (id) on delete set null;
    `,
  },
  {
    id: "0054_attendee_operations",
    sql: `
      -- Global gates and event snapshots are intentionally separate. Enabling
      -- a global capability never changes an existing event, and transfers
      -- remain unavailable until both levels explicitly allow them.
      create table attendee_operation_settings (
        id                  boolean primary key default true check (id),
        global_availability jsonb not null default '{
          "scoring": true,
          "publicLeaderboard": true,
          "manualStaffAwards": true,
          "discoveries": true,
          "guestPhotos": true,
          "transfers": false,
          "onwardTransfers": false,
          "complimentaryTransfers": false
        }'::jsonb,
        new_event_defaults  jsonb not null default '{
          "scoring": false,
          "publicLeaderboard": false,
          "manualStaffAwards": false,
          "discoveries": false,
          "guestPhotos": false,
          "transfers": false,
          "onwardTransfers": false,
          "complimentaryTransfers": false
        }'::jsonb,
        emergency_paused    jsonb not null default '{}'::jsonb,
        revision            bigint not null default 1 check (revision >= 1),
        updated_by          text not null default 'root-owner',
        update_reason       text,
        updated_at          timestamptz not null default now()
      );
      insert into attendee_operation_settings (id) values (true);

      create table event_operation_policies (
        event_slug          text primary key references events (slug)
                            on update cascade on delete cascade,
        capabilities        jsonb not null,
        transfer_opens_at   timestamptz,
        transfer_closes_at  timestamptz,
        policy_version      bigint not null default 1 check (policy_version >= 1),
        snapshotted_at      timestamptz not null default now(),
        updated_by          text not null,
        update_reason       text,
        updated_at          timestamptz not null default now(),
        check (transfer_closes_at is null or transfer_opens_at is null
               or transfer_closes_at > transfer_opens_at)
      );

      -- One standard for every emailed authority link. Raw credentials are
      -- never stored, and consumption is an atomic state transition.
      create table attendee_action_links (
        id                  text primary key,
        token_hash          text not null unique check (char_length(token_hash) = 64),
        purpose             text not null check (purpose in (
                              'ticket-assignment', 'ticket-transfer', 'ticket-return',
                              'refund-consent', 'staff-invitation', 'admin-invitation'
                            )),
        intended_email_hash text not null check (char_length(intended_email_hash) = 64),
        intended_email_hint text not null check (char_length(intended_email_hint) <= 254),
        entity_type         text not null,
        entity_id           text not null,
        payload             jsonb not null default '{}'::jsonb,
        issued_by_type      text not null check (issued_by_type in ('root-owner','admin','staff','attendee','system')),
        issued_by_id        text,
        expires_at          timestamptz not null,
        consumed_at         timestamptz,
        consumed_by         text references event_people (id) on delete set null,
        revoked_at          timestamptz,
        revoke_reason       text,
        created_at          timestamptz not null default now(),
        check (octet_length(payload::text) <= 8192),
        check (consumed_at is null or revoked_at is null)
      );
      create index attendee_action_links_expiry_idx
        on attendee_action_links (expires_at) where consumed_at is null and revoked_at is null;
      create index attendee_action_links_entity_idx
        on attendee_action_links (entity_type, entity_id, created_at desc);

      alter table tickets
        add column access_reference text check (
          access_reference is null or access_reference ~ '^[0-9A-HJKMNP-TV-Z]{16}$'
        ),
        add column authority_version integer not null default 1 check (authority_version >= 1);
      create unique index tickets_access_reference_idx
        on tickets (access_reference) where access_reference is not null;

      create table ticket_assignments (
        id                    text primary key,
        event_slug            text not null references events (slug)
                              on update cascade on delete restrict,
        ticket_id             text not null references tickets (id) on delete restrict,
        purchaser_person_id   text not null references event_people (id) on delete restrict,
        recipient_email       text not null check (char_length(recipient_email) between 3 and 254),
        recipient_email_hash  text not null check (char_length(recipient_email_hash) = 64),
        recipient_email_hint  text not null check (char_length(recipient_email_hint) <= 254),
        action_link_id        text references attendee_action_links (id) on delete set null,
        status                text not null default 'pending'
                              check (status in ('pending','claimed','cancelled','expired')),
        claimed_by_person_id  text references event_people (id) on delete restrict,
        expires_at            timestamptz not null,
        claimed_at            timestamptz,
        cancelled_at          timestamptz,
        created_at            timestamptz not null default now(),
        updated_at            timestamptz not null default now()
      );
      create unique index ticket_assignments_pending_ticket_idx
        on ticket_assignments (ticket_id) where status = 'pending';

      create table ticket_transfers (
        id                    text primary key,
        event_slug            text not null references events (slug)
                              on update cascade on delete restrict,
        ticket_id             text not null references tickets (id) on delete restrict,
        sender_person_id      text not null references event_people (id) on delete restrict,
        recipient_email       text not null check (char_length(recipient_email) between 3 and 254),
        recipient_email_hash  text not null check (char_length(recipient_email_hash) = 64),
        recipient_email_hint  text not null check (char_length(recipient_email_hint) <= 254),
        action_link_id        text references attendee_action_links (id) on delete set null,
        policy_version        bigint not null,
        status                text not null default 'pending' check (status in (
                                'pending','accepted','declined','cancelled','expired','invalidated'
                              )),
        accepted_by_person_id text references event_people (id) on delete restrict,
        expires_at            timestamptz not null,
        accepted_at           timestamptz,
        declined_at           timestamptz,
        cancelled_at          timestamptz,
        invalidated_at        timestamptz,
        invalidation_reason   text,
        created_at            timestamptz not null default now(),
        updated_at            timestamptz not null default now()
      );
      create unique index ticket_transfers_pending_ticket_idx
        on ticket_transfers (ticket_id) where status = 'pending';
      create index ticket_transfers_people_idx
        on ticket_transfers (sender_person_id, created_at desc);

      create table ticket_return_requests (
        id                    text primary key,
        event_slug            text not null references events (slug)
                              on update cascade on delete restrict,
        ticket_id             text not null references tickets (id) on delete restrict,
        purchaser_person_id   text not null references event_people (id) on delete restrict,
        holder_person_id      text not null references event_people (id) on delete restrict,
        initiated_by_person_id text not null references event_people (id) on delete restrict,
        action_link_id        text references attendee_action_links (id) on delete set null,
        status                text not null default 'awaiting-consent' check (status in (
                                'awaiting-consent','confirmed','declined','under-review',
                                'refund-pending','refunded','failed','cancelled'
                              )),
        amount_minor          integer check (amount_minor is null or amount_minor >= 0),
        currency              text,
        consented_at          timestamptz,
        resolved_at           timestamptz,
        resolution_reason     text,
        created_at            timestamptz not null default now(),
        updated_at            timestamptz not null default now()
      );
      create unique index ticket_return_requests_active_ticket_idx
        on ticket_return_requests (ticket_id)
        where status in ('awaiting-consent','confirmed','under-review','refund-pending');

      create table ticket_refund_allocations (
        id                  text primary key,
        ticket_id           text not null references tickets (id) on delete restrict,
        event_slug          text not null references events (slug)
                            on update cascade on delete restrict,
        payment_ref         text not null,
        refund_ref          text unique,
        amount_minor        integer not null check (amount_minor >= 0),
        currency            text not null,
        state               text not null default 'processing'
                            check (state in ('processing','pending','succeeded','failed','cancelled')),
        initiated_by_type   text not null check (initiated_by_type in ('attendee','admin','system')),
        initiated_by_id     text,
        failure_reason      text,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now(),
        completed_at        timestamptz
      );
      create unique index ticket_refund_allocations_active_ticket_idx
        on ticket_refund_allocations (ticket_id)
        where state in ('processing','pending','succeeded');
      create index ticket_refund_allocations_payment_idx
        on ticket_refund_allocations (payment_ref, created_at);

      create table global_admin_grants (
        id                  text primary key,
        person_id           text not null references event_people (id) on delete cascade,
        role_preset         text not null check (role_preset in (
                              'owner','admin','finance','support','communications','content','auditor'
                            )),
        overrides           jsonb not null default '{}'::jsonb,
        status              text not null default 'pending'
                            check (status in ('pending','active','paused','revoked','expired')),
        starts_at           timestamptz not null default now(),
        expires_at          timestamptz,
        issued_by_type      text not null check (issued_by_type in ('root-owner','admin')),
        issued_by_id        text,
        invitation_link_id  text references attendee_action_links (id) on delete set null,
        created_at          timestamptz not null default now(),
        activated_at        timestamptz,
        revoked_at          timestamptz,
        audit_metadata      jsonb not null default '{}'::jsonb
      );
      create unique index global_admin_grants_active_person_role_idx
        on global_admin_grants (person_id, role_preset)
        where status in ('pending','active','paused');

      -- Durable domain facts feed both the customer and operator projections.
      create table attendee_domain_events (
        id                  text primary key,
        kind                text not null,
        deduplication_key   text not null unique,
        actor_type          text not null,
        actor_id            text,
        event_slug          text references events (slug) on update cascade on delete set null,
        entity_refs         jsonb not null default '{}'::jsonb,
        severity            text not null default 'info'
                            check (severity in ('info','prompt','warning','critical')),
        correlation_id      text not null,
        payload             jsonb not null default '{}'::jsonb,
        occurred_at         timestamptz not null default now(),
        created_at          timestamptz not null default now(),
        check (octet_length(entity_refs::text) <= 8192),
        check (octet_length(payload::text) <= 16384)
      );
      create index attendee_domain_events_kind_idx
        on attendee_domain_events (kind, occurred_at desc);

      create table admin_attention_cases (
        id                  text primary key,
        category            text not null,
        severity            text not null check (severity in ('prompt','warning','critical')),
        event_slug          text references events (slug) on update cascade on delete set null,
        related_entities    jsonb not null default '{}'::jsonb,
        status              text not null default 'new'
                            check (status in ('new','seen','in-progress','resolved','dismissed')),
        assignee_person_id  text references event_people (id) on delete set null,
        private_note        jsonb not null default '{}'::jsonb,
        resolution_reason   text,
        source_event_id     text references attendee_domain_events (id) on delete set null,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now(),
        resolved_at         timestamptz
      );
      create index admin_attention_cases_queue_idx
        on admin_attention_cases (status, severity, updated_at desc);

      create table admin_notifications (
        id                  text primary key,
        source_event_id     text not null references attendee_domain_events (id) on delete cascade,
        case_id             text references admin_attention_cases (id) on delete set null,
        category            text not null,
        title               text not null check (char_length(title) <= 200),
        body                text not null check (char_length(body) <= 1000),
        event_slug          text references events (slug) on update cascade on delete set null,
        deep_link           text not null check (deep_link like '/%' and deep_link not like '//%'),
        status              text not null default 'new'
                            check (status in ('new','seen','in-progress','resolved','dismissed')),
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now(),
        resolved_at         timestamptz,
        unique (source_event_id)
      );
      create index admin_notifications_inbox_idx
        on admin_notifications (status, created_at desc);

      create table admin_alert_recipients (
        id                  text primary key,
        person_id           text references event_people (id) on delete set null,
        email_hash          text not null check (char_length(email_hash) = 64),
        email_hint          text not null check (char_length(email_hint) <= 254),
        categories          text[] not null default array['critical']::text[],
        event_slugs         text[] not null default '{}'::text[],
        cadence             text not null default 'immediate'
                            check (cadence in ('immediate','digest')),
        digest_hour         integer check (digest_hour between 0 and 23),
        quiet_hours         jsonb not null default '{}'::jsonb,
        critical_override   boolean not null default true,
        fallback            boolean not null default false,
        status              text not null default 'active' check (status in ('active','paused','revoked')),
        verified_at         timestamptz not null,
        created_at          timestamptz not null default now(),
        updated_at          timestamptz not null default now()
      );

      create table attendee_operations_audit_events (
        id                  bigint generated always as identity primary key,
        action              text not null,
        actor_type          text not null,
        actor_id            text,
        event_slug          text references events (slug) on update cascade on delete set null,
        entity_type         text not null,
        entity_id           text not null,
        before_state        jsonb,
        after_state         jsonb,
        reason              text,
        affected_count      integer,
        correlation_id      text,
        created_at          timestamptz not null default now()
      );
      create index attendee_operations_audit_lookup_idx
        on attendee_operations_audit_events (entity_type, entity_id, created_at desc);

      -- Personal scoring/staff assignments become verified-person grants;
      -- station assignments retain a rotatable bearer credential. Scanner
      -- records can now point at that same station assignment.
      alter table score_staff_assignments
        alter column token_hash drop not null,
        add column role_preset text,
        add column invitation_state text not null default 'active'
          check (invitation_state in ('pending','active','declined','expired','revoked')),
        add column invited_email_hash text check (
          invited_email_hash is null or char_length(invited_email_hash) = 64
        ),
        add column invitation_link_id text references attendee_action_links (id) on delete set null,
        add column activated_at timestamptz,
        add column last_used_at timestamptz;

      alter table scanner_links
        add column staff_assignment_id text references score_staff_assignments (id) on delete set null;

      alter table email_outbox drop constraint if exists email_outbox_channel_check;
      alter table email_outbox add constraint email_outbox_channel_check
        check (channel in ('tickets','studio','communications','access','operations'));
      alter table email_outbox drop constraint if exists email_outbox_kind_check;
      alter table email_outbox add constraint email_outbox_kind_check check (kind in (
        'ticket-issued','ticket-resend','ticket-refund','ticket-exchange',
        'ticket-exchange-payment','attendee-access','ticket-assignment',
        'ticket-transfer','ticket-return','staff-access','admin-access',
        'operations-alert','operations-digest','event-broadcast','communication',
        'communication-stage','communication-test','pitch-welcome','pitch-published',
        'pitch-recovery','pitch-reminder'
      ));
    `,
  },
  {
    id: "0055_attendee_operations_authority",
    sql: `
      -- Personal staff bearer links are intentionally removed. No product has
      -- launched, so retaining ambiguous pre-identity grants would be riskier
      -- than asking an organiser to issue a verified invitation again.
      delete from score_staff_assignments where assignment_type = 'personal' and token_hash is not null;

      -- Alert recipients are not live data. Recreate them through verified
      -- setup so the durable delivery address and identity evidence agree.
      delete from admin_alert_recipients;
      alter table admin_alert_recipients
        add column email_address text not null check (email_address ~* '^[^@[:space:]]+@[^@[:space:]]+$');

      alter table admin_notifications
        add column if not exists category text not null default 'operations';

      alter table score_staff_assignments
        add constraint score_staff_assignments_authority_check check (
          (
            assignment_type = 'station'
            and token_hash is not null
            and person_id is null
            and invitation_state = 'active'
          )
          or
          (
            assignment_type = 'personal'
            and token_hash is null
            and person_id is not null
            and invited_email_hash is not null
          )
        );

      create unique index admin_alert_recipients_email_idx
        on admin_alert_recipients (email_hash)
        where status in ('active','paused');
      create unique index admin_alert_recipients_fallback_idx
        on admin_alert_recipients ((fallback))
        where fallback and status in ('active','paused');
    `,
  },
  {
    id: "0056_multi_payment_ticket_refunds",
    sql: `
      alter table ticket_refund_allocations add column request_id text;
      update ticket_refund_allocations set request_id = id where request_id is null;
      alter table ticket_refund_allocations alter column request_id set not null;

      drop index ticket_refund_allocations_active_ticket_idx;
      create unique index ticket_refund_allocations_active_payment_idx
        on ticket_refund_allocations (ticket_id, payment_ref)
        where state in ('processing','pending','succeeded');
      create index ticket_refund_allocations_request_idx
        on ticket_refund_allocations (request_id, created_at);
    `,
  },
  {
    id: "0057_ticket_return_expiry",
    sql: `
      alter table ticket_return_requests add column expires_at timestamptz;
      update ticket_return_requests set expires_at = created_at + interval '72 hours';
      alter table ticket_return_requests alter column expires_at set not null;
      alter table ticket_return_requests drop constraint ticket_return_requests_status_check;
      alter table ticket_return_requests add constraint ticket_return_requests_status_check
        check (status in (
          'awaiting-consent','confirmed','declined','under-review','refund-pending',
          'refunded','failed','cancelled','expired'
        ));
    `,
  },
  {
    id: "0058_attendee_identity_acquisition_status",
    sql: `
      alter table event_people
        add column acquisition_status text not null default 'active'
          check (acquisition_status in ('active','restricted')),
        add column acquisition_restricted_at timestamptz,
        add column acquisition_restricted_by text,
        add column acquisition_restriction_reason text;

      alter table event_people add constraint event_people_acquisition_restriction_check check (
        (acquisition_status = 'active'
          and acquisition_restricted_at is null
          and acquisition_restricted_by is null
          and acquisition_restriction_reason is null)
        or
        (acquisition_status = 'restricted'
          and acquisition_restricted_at is not null
          and acquisition_restricted_by is not null
          and char_length(acquisition_restriction_reason) between 3 and 500)
      );

      create index event_people_acquisition_restricted_idx
        on event_people (acquisition_restricted_at desc) where acquisition_status = 'restricted';
    `,
  },
  {
    id: "0059_game_pool_current_settings",
    sql: `
      alter table game_pool_entrances
        drop constraint game_pool_entrances_game_check;
      alter table game_pool_entrances
        add constraint game_pool_entrances_game_check check (game in (
          'same-brain','liars','centre','twin','draw-country','hot-and-cold'
        ));

      -- Same Brain's pre-launch semantic-matching settings are obsolete. Reset
      -- configured entrances and runs to the current deterministic game model.
      update game_pool_entrances
         set preset = '{"game":"same-brain","rounds":8,"sayItAloud":true,"eliminateOddOne":false,"revealAuthors":true}'::jsonb,
             updated_at = now()
       where game = 'same-brain';
      update game_pool_runs run
         set preset = '{"game":"same-brain","rounds":8,"sayItAloud":true,"eliminateOddOne":false,"revealAuthors":true}'::jsonb,
             updated_at = now()
        from game_pool_entrances entrance
       where entrance.id = run.entrance_id and entrance.game = 'same-brain';
    `,
  },
  {
    id: "0060_admin_notification_read_state",
    sql: `
      update admin_notifications set status = 'new' where status = 'seen';
      alter table admin_notifications drop constraint admin_notifications_status_check;
      alter table admin_notifications add constraint admin_notifications_status_check
        check (status in ('new','in-progress','resolved','dismissed'));

      update admin_attention_cases set status = 'new' where status = 'seen';
      alter table admin_attention_cases drop constraint admin_attention_cases_status_check;
      alter table admin_attention_cases add constraint admin_attention_cases_status_check
        check (status in ('new','in-progress','resolved','dismissed'));

      create table admin_notification_reads (
        notification_id  text not null references admin_notifications (id) on delete cascade,
        actor_type       text not null check (actor_type in ('root-owner','admin')),
        actor_id         text not null check (char_length(actor_id) between 1 and 200),
        read_at          timestamptz not null default now(),
        primary key (notification_id, actor_type, actor_id)
      );
      create index admin_notification_reads_actor_idx
        on admin_notification_reads (actor_type, actor_id, read_at desc);
    `,
  },
  {
    id: "0061_person_game_history",
    sql: `
      create table person_game_sessions (
        id             text primary key,
        person_id      text not null references event_people (id) on delete cascade,
        game           text not null check (char_length(game) between 1 and 80),
        mode           text not null check (mode in ('daily','room','event')),
        external_ref   text not null check (char_length(external_ref) between 1 and 200),
        display_name   text check (display_name is null or char_length(display_name) between 1 and 120),
        status         text not null default 'active'
                         check (status in ('active','completed','abandoned')),
        outcome        text check (outcome is null or char_length(outcome) between 1 and 40),
        score          integer,
        summary        jsonb not null default '{}'::jsonb,
        started_at     timestamptz not null default now(),
        last_played_at timestamptz not null default now(),
        completed_at   timestamptz,
        unique (person_id, game, mode, external_ref)
      );
      create index person_game_sessions_person_idx
        on person_game_sessions (person_id, last_played_at desc);

      create table person_game_events (
        id          text primary key,
        session_id  text not null references person_game_sessions (id) on delete cascade,
        event_key   text not null check (char_length(event_key) between 1 and 200),
        kind        text not null check (char_length(kind) between 1 and 80),
        payload     jsonb not null default '{}'::jsonb,
        occurred_at timestamptz not null default now(),
        unique (session_id, event_key)
      );
      create index person_game_events_session_idx
        on person_game_events (session_id, occurred_at asc);
    `,
  },
  {
    id: "0062_uuidv7_people_and_passkeys",
    sql: `
      -- Remap every provisional identifier inside the migration transaction.
      -- Keeping the old-to-new maps until commit lets dependent rows move to
      -- native UUIDs without deleting identities or unrelated business data.
      lock table event_people, event_person_identifiers in access exclusive mode;

      create temporary table person_uuid_map (
        old_id text primary key,
        new_id uuid not null unique
      ) on commit drop;
      insert into person_uuid_map (old_id,new_id)
      select id, uuidv7() from event_people;

      create temporary table identifier_uuid_map (
        old_id text primary key,
        new_id uuid not null unique
      ) on commit drop;
      insert into identifier_uuid_map (old_id,new_id)
      select id, uuidv7() from event_person_identifiers;

      create temporary table identity_fk_rebuild (
        table_name text not null,
        constraint_name text not null,
        column_name text not null,
        referenced_table text not null,
        definition text not null
      ) on commit drop;

      insert into identity_fk_rebuild (
        table_name,constraint_name,column_name,referenced_table,definition
      )
      select constraint_row.conrelid::regclass::text,
             constraint_row.conname,
             attribute.attname,
             constraint_row.confrelid::regclass::text,
             pg_get_constraintdef(constraint_row.oid)
        from pg_constraint constraint_row
        join lateral unnest(constraint_row.conkey) as constrained(attnum) on true
        join pg_attribute attribute
          on attribute.attrelid = constraint_row.conrelid
         and attribute.attnum = constrained.attnum
       where constraint_row.contype = 'f'
         and constraint_row.confrelid in (
           'event_people'::regclass,
           'event_person_identifiers'::regclass
         );

      do $$
      declare
        item record;
        map_table text;
        has_unmapped boolean;
      begin
        for item in select distinct table_name,constraint_name from identity_fk_rebuild loop
          execute format('alter table %s drop constraint %I', item.table_name, item.constraint_name);
        end loop;

        for item in
          select distinct table_name,column_name,referenced_table from identity_fk_rebuild
        loop
          map_table := case item.referenced_table
            when 'event_people' then 'person_uuid_map'
            when 'event_person_identifiers' then 'identifier_uuid_map'
          end;

          if map_table is null then
            raise exception
              'UUIDv7 identity migration found an unsupported reference target: %',
              item.referenced_table;
          end if;

          execute format(
            'select exists (
               select 1
                 from %s as target
                 left join %I as mapping on mapping.old_id = target.%I
                where target.%I is not null and mapping.old_id is null
             )',
            item.table_name,
            map_table,
            item.column_name,
            item.column_name
          ) into has_unmapped;

          if has_unmapped then
            raise exception
              'UUIDv7 identity migration found an unmappable reference in %.%',
              item.table_name,
              item.column_name;
          end if;

          execute format(
            'update %s as target
                set %I = mapping.new_id::text
               from %I as mapping
              where target.%I = mapping.old_id',
            item.table_name,
            item.column_name,
            map_table,
            item.column_name
          );
          execute format(
            'alter table %s alter column %I type uuid using %I::uuid',
            item.table_name,
            item.column_name,
            item.column_name
          );
        end loop;
      end;
      $$;

      update event_person_identifiers as target
         set id = mapping.new_id::text
        from identifier_uuid_map as mapping
       where target.id = mapping.old_id;
      update event_people as target
         set id = mapping.new_id::text
        from person_uuid_map as mapping
       where target.id = mapping.old_id;

      alter table event_person_identifiers
        alter column id type uuid using id::uuid,
        alter column id set default uuidv7();
      alter table event_people
        alter column id type uuid using id::uuid,
        alter column id set default uuidv7();

      do $$
      declare item record;
      begin
        for item in
          select distinct table_name,constraint_name,definition from identity_fk_rebuild
        loop
          execute format(
            'alter table %s add constraint %I %s',
            item.table_name,
            item.constraint_name,
            item.definition
          );
        end loop;
      end;
      $$;

      alter table event_person_identifiers
        drop constraint event_person_identifiers_kind_check,
        add constraint event_person_identifiers_kind_check
          check (kind in ('email','account'));

      create table person_webauthn_profiles (
        person_id    uuid primary key references event_people (id) on delete cascade,
        user_handle  text not null unique
                     check (user_handle ~ '^[A-Za-z0-9_-]{43}$'),
        created_at   timestamptz not null default now()
      );

      create table person_passkeys (
        id             uuid primary key default uuidv7(),
        person_id      uuid not null references event_people (id) on delete cascade,
        credential_id  text not null unique
                       check (char_length(credential_id) between 16 and 2048),
        public_key     bytea not null,
        counter        bigint not null default 0 check (counter >= 0),
        transports     text[] not null default '{}',
        device_type    text not null check (device_type in ('singleDevice','multiDevice')),
        backed_up      boolean not null default false,
        label          text not null check (char_length(label) between 1 and 80),
        created_at     timestamptz not null default now(),
        last_used_at   timestamptz,
        revoked_at     timestamptz
      );
      create index person_passkeys_person_idx
        on person_passkeys (person_id, created_at desc) where revoked_at is null;
    `,
  },
  {
    id: "0063_totp_and_recovery_codes",
    sql: `
      alter table event_person_identifiers
        add column email_address text
          check (email_address is null or char_length(email_address) between 3 and 320);

      create table person_totp_authenticators (
        id                 uuid primary key default uuidv7(),
        person_id          uuid not null references event_people (id) on delete cascade,
        label              text not null check (char_length(label) between 1 and 80),
        secret_ciphertext  text not null check (char_length(secret_ciphertext) between 80 and 500),
        enrollment_session_hash text
                           check (enrollment_session_hash is null or
                                  enrollment_session_hash ~ '^[0-9a-f]{64}$'),
        enrollment_expires_at timestamptz,
        last_counter       bigint,
        created_at         timestamptz not null default now(),
        verified_at        timestamptz,
        last_used_at       timestamptz,
        revoked_at         timestamptz,
        check (verified_at is null or revoked_at is null or revoked_at >= verified_at),
        check (verified_at is not null or
               (enrollment_session_hash is not null and enrollment_expires_at is not null))
      );
      create index person_totp_authenticators_person_idx
        on person_totp_authenticators (person_id, created_at desc)
        where revoked_at is null;

      create table person_recovery_codes (
        id             uuid primary key default uuidv7(),
        person_id      uuid not null references event_people (id) on delete cascade,
        generation_id  uuid not null,
        code_hash      text not null check (code_hash ~ '^[0-9a-f]{64}$'),
        created_at     timestamptz not null default now(),
        consumed_at    timestamptz,
        unique (person_id, code_hash)
      );
      create index person_recovery_codes_active_idx
        on person_recovery_codes (person_id, generation_id)
        where consumed_at is null;

      alter table email_outbox drop constraint if exists email_outbox_kind_check;
      alter table email_outbox add constraint email_outbox_kind_check check (kind in (
        'ticket-issued','ticket-resend','ticket-refund','ticket-exchange',
        'ticket-exchange-payment','attendee-access','ticket-assignment',
        'ticket-transfer','ticket-return','staff-access','admin-access','security-notice',
        'operations-alert','operations-digest','event-broadcast','communication',
        'communication-stage','communication-test','pitch-welcome','pitch-published',
        'pitch-recovery','pitch-reminder'
      ));
    `,
  },
  {
    id: "0064_person_game_solo_mode",
    sql: `
      alter table person_game_sessions drop constraint person_game_sessions_mode_check;
      alter table person_game_sessions add constraint person_game_sessions_mode_check
        check (mode in ('daily','solo','room','event'));
    `,
  },
  {
    id: "0065_hot_and_cold_daily_results",
    sql: `
      create table hot_and_cold_daily_results (
        run_id          uuid primary key,
        puzzle          integer not null check (puzzle > 0),
        person_id       uuid references event_people (id) on delete set null,
        outcome         text not null check (outcome in ('found','revealed')),
        guesses         integer not null check (guesses between 0 and 10000),
        hints           integer not null check (hints between 0 and 3),
        best_rank       integer check (best_rank is null or best_rank >= 0),
        frost_guesses   integer not null check (frost_guesses between 0 and 10000),
        cool_guesses    integer not null check (cool_guesses between 0 and 10000),
        warm_guesses    integer not null check (warm_guesses between 0 and 10000),
        hot_guesses     integer not null check (hot_guesses between 0 and 10000),
        synthetic       boolean not null default false,
        created_at      timestamptz not null default now(),
        check (frost_guesses + cool_guesses + warm_guesses + hot_guesses <= guesses)
      );
      create index hot_and_cold_daily_results_puzzle_idx
        on hot_and_cold_daily_results (puzzle,created_at);

      insert into hot_and_cold_daily_results
        (run_id,puzzle,outcome,guesses,hints,best_rank,frost_guesses,cool_guesses,
         warm_guesses,hot_guesses,synthetic)
      values
        ('00000000-0000-4000-8000-000000000101',1,'found',8,0,0,2,1,2,2,true),
        ('00000000-0000-4000-8000-000000000102',1,'found',12,1,0,5,2,2,2,true),
        ('00000000-0000-4000-8000-000000000103',1,'found',16,0,0,7,3,3,2,true),
        ('00000000-0000-4000-8000-000000000104',1,'found',22,2,0,10,5,3,3,true),
        ('00000000-0000-4000-8000-000000000105',1,'revealed',31,3,18,18,7,4,2,true),
        ('00000000-0000-4000-8000-000000000201',2,'found',6,0,0,1,1,1,2,true),
        ('00000000-0000-4000-8000-000000000202',2,'found',10,0,0,3,2,2,2,true),
        ('00000000-0000-4000-8000-000000000203',2,'found',14,1,0,5,3,3,2,true),
        ('00000000-0000-4000-8000-000000000204',2,'found',19,2,0,8,4,3,3,true),
        ('00000000-0000-4000-8000-000000000205',2,'revealed',27,3,42,15,6,4,2,true);
    `,
  },
  {
    id: "0066_pitch_person_ownership",
    sql: `
      alter table pitch_decks
        add column owner_person_id uuid references event_people (id) on delete set null;

      update pitch_decks deck
         set owner_person_id = identifier.person_id
        from event_person_identifiers identifier
       where identifier.kind = 'email'
         and identifier.value_hash = deck.owner_email_hash
         and identifier.verified_at is not null
         and identifier.historical_until is null;

      create index pitch_decks_owner_person_idx
        on pitch_decks (owner_person_id, updated_at desc)
        where owner_person_id is not null and lifecycle = 'active';
    `,
  },
  {
    id: "0067_reset_hot_and_cold_daily_history",
    sql: `
      delete from person_game_sessions
       where game = 'hot-and-cold'
         and mode = 'daily'
         and external_ref ~ '^[0-9]+$'
         and external_ref::integer > 3;

      delete from hot_and_cold_daily_results
       where puzzle > 3;
    `,
  },
  {
    id: "0068_seed_hot_and_cold_puzzle_three",
    sql: `
      insert into hot_and_cold_daily_results
        (run_id,puzzle,outcome,guesses,hints,best_rank,frost_guesses,cool_guesses,
         warm_guesses,hot_guesses,synthetic)
      values
        ('00000000-0000-4000-8000-000000000301',3,'found',7,0,0,3,1,1,2,true),
        ('00000000-0000-4000-8000-000000000302',3,'found',11,0,0,5,2,2,2,true),
        ('00000000-0000-4000-8000-000000000303',3,'found',13,1,0,6,3,2,2,true),
        ('00000000-0000-4000-8000-000000000304',3,'found',18,0,0,9,4,3,2,true),
        ('00000000-0000-4000-8000-000000000305',3,'found',25,2,0,13,6,3,3,true),
        ('00000000-0000-4000-8000-000000000306',3,'revealed',29,3,26,17,7,3,2,true)
      on conflict (run_id) do nothing;
    `,
  },
  {
    id: "0069_admin_ticket_invitations",
    sql: `
      alter table ticket_assignments
        alter column purchaser_person_id drop not null,
        add column issued_by_type text not null default 'attendee'
          check (issued_by_type in ('attendee','admin','root-owner')),
        add column issued_by_id text;

      alter table ticket_assignments add constraint ticket_assignments_issuer_check check (
        (issued_by_type = 'attendee' and purchaser_person_id is not null)
        or (issued_by_type in ('admin','root-owner') and issued_by_id is not null)
      );

      create index ticket_assignments_admin_event_idx
        on ticket_assignments (event_slug,created_at desc)
        where issued_by_type in ('admin','root-owner');
    `,
  },
  {
    id: "0070_hot_and_cold_judging_revision",
    sql: `
      delete from person_game_sessions
       where game = 'hot-and-cold';

      delete from hot_and_cold_daily_results;

      alter table hot_and_cold_daily_results
        add column target text not null,
        add column judging_version text not null,
        drop column synthetic;

      drop index hot_and_cold_daily_results_puzzle_idx;
      create index hot_and_cold_daily_results_judging_idx
        on hot_and_cold_daily_results (puzzle,target,judging_version,created_at);
    `,
  },
  {
    id: "0071_hot_and_cold_revision_replay",
    sql: `
      alter table hot_and_cold_daily_results
        add constraint hot_and_cold_daily_results_run_revision_key
        unique (run_id,judging_version);
    `,
  },
  {
    id: "0072_hot_and_cold_revision_identity",
    sql: `
      alter table hot_and_cold_daily_results
        drop constraint hot_and_cold_daily_results_run_revision_key,
        drop constraint hot_and_cold_daily_results_pkey,
        add primary key (run_id,judging_version);
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
