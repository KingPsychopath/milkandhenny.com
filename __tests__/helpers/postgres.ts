/**
 * Test database helper.
 *
 * These tests run against a **real Postgres**, not an emulator. The
 * properties they assert — no overselling under concurrent buyers, one
 * admission under concurrent scans — are properties of row locks and
 * `where ... is null` predicates. An in-memory SQL fake would happily run the
 * statements and prove nothing about either.
 *
 * Start one with:
 *
 *   docker run -d --name mah-test-pg -e POSTGRES_PASSWORD=test \
 *     -e POSTGRES_DB=mah_test -p 55432:5432 postgres:18-alpine
 *
 * Suites call `describeWithDatabase`, which skips cleanly when no database is
 * reachable so the rest of the suite still runs. `vitest.globalSetup.ts`
 * probes once and records the answer.
 */

import { describe } from "vitest";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

export const databaseReady = process.env.MAH_TEST_DB_READY === "1";

/** `describe`, or `describe.skip` when there is no test database. */
export const describeWithDatabase = databaseReady ? describe : describe.skip;

/**
 * Serialises whole test files against the shared database.
 *
 * Vitest runs files in parallel workers; two suites resetting and truncating
 * the same tables would corrupt each other mid-test. Each file takes this
 * session-level advisory lock in `applySchema` and holds it until
 * `closeDatabase`, so database suites run one file at a time while everything
 * else stays parallel.
 */
const TEST_SUITE_LOCK_KEY = 8_147_299;
let suiteLockClient: {
  query: (sql: string, params?: unknown[]) => Promise<unknown>;
  release: () => void;
} | null = null;

export async function applySchema(): Promise<void> {
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  const { getPool, query } = await import("@/lib/platform/postgres.server");
  const { runMigrations } = await import("@/lib/platform/migrations.server");

  const pool = getPool();
  if (pool && !suiteLockClient) {
    const client = await pool.connect();
    await client.query("select pg_advisory_lock($1)", [TEST_SUITE_LOCK_KEY]);
    suiteLockClient = client;
  }

  await query(`
    drop table if exists application_scheduled_jobs cascade;
    drop table if exists achievement_unlocks cascade;
    drop table if exists achievement_progress cascade;
    drop table if exists event_waitlist_inventory cascade;
    drop table if exists event_waitlist_entries cascade;
    drop table if exists attendee_operations_audit_events cascade;
    drop table if exists admin_alert_recipients cascade;
    drop table if exists admin_notification_reads cascade;
    drop table if exists admin_notifications cascade;
    drop table if exists admin_attention_cases cascade;
    drop table if exists attendee_domain_events cascade;
    drop table if exists global_admin_grants cascade;
    drop table if exists ticket_refund_allocations cascade;
    drop table if exists ticket_return_requests cascade;
    drop table if exists ticket_transfers cascade;
    drop table if exists ticket_assignments cascade;
    drop table if exists attendee_action_links cascade;
    drop table if exists event_operation_policies cascade;
    drop table if exists attendee_operation_settings cascade;
    drop table if exists event_order_managers cascade;
    drop table if exists event_ticket_identity_claims cascade;
    drop table if exists event_person_login_challenges cascade;
    drop table if exists score_operational_events cascade;
    drop table if exists event_icebreaker_encounters cascade;
    drop table if exists event_icebreaker_profiles cascade;
    drop table if exists score_activity_templates cascade;
    drop table if exists score_prize_finalizations cascade;
    drop table if exists score_media_links cascade;
    drop table if exists score_notifications cascade;
    drop table if exists score_audit_events cascade;
    drop table if exists score_staff_award_claims cascade;
    drop table if exists score_staff_devices cascade;
    drop table if exists score_staff_assignments cascade;
    drop table if exists event_staff_roles cascade;
    drop table if exists score_offline_commands cascade;
    drop table if exists score_offline_reservations cascade;
    drop table if exists score_anomaly_flags cascade;
    drop table if exists score_discovery_clues cascade;
    drop table if exists score_discovery_claims cascade;
    drop table if exists score_discoveries cascade;
    drop table if exists score_game_receipts cascade;
    drop table if exists game_result_group_claims cascade;
    drop table if exists game_result_group_claim_sessions cascade;
    drop table if exists official_game_results cascade;
    drop table if exists event_game_player_links cascade;
    drop table if exists event_game_score_bindings cascade;
    drop table if exists event_game_register cascade;
    drop table if exists score_postings cascade;
    drop table if exists score_transactions cascade;
    drop table if exists score_projections cascade;
    drop table if exists score_pools cascade;
    drop table if exists score_team_memberships cascade;
    drop table if exists score_teams cascade;
    drop table if exists score_activities cascade;
    drop table if exists event_scoring_settings cascade;
    drop table if exists event_participant_merges cascade;
    drop table if exists event_participants cascade;
    drop table if exists person_game_events cascade;
    drop table if exists person_game_sessions cascade;
    drop table if exists hot_and_cold_daily_results cascade;
    drop table if exists person_recovery_codes cascade;
    drop table if exists person_totp_authenticators cascade;
    drop table if exists person_passkeys cascade;
    drop table if exists person_webauthn_profiles cascade;
    drop table if exists event_person_identifiers cascade;
    drop table if exists event_people cascade;
    drop table if exists game_pool_moderation_events cascade;
    drop table if exists game_pool_assignments cascade;
    drop table if exists game_pool_rooms cascade;
    drop table if exists game_pool_runs cascade;
    drop table if exists game_pool_entrances cascade;
    drop table if exists email_feedback_events cascade;
    drop table if exists email_delivery_events cascade;
    drop table if exists communication_links cascade;
    drop table if exists survey_responses cascade;
    drop table if exists surveys cascade;
    drop table if exists communication_stage_deliveries cascade;
    drop table if exists communication_plan_stages cascade;
    drop table if exists communication_plans cascade;
    drop table if exists communication_contact_consent_events cascade;
    drop table if exists communication_templates cascade;
    drop table if exists communication_messages cascade;
    drop table if exists communication_contacts cascade;
    drop table if exists email_suppressions cascade;
    drop table if exists email_outbox cascade;
    drop table if exists pitch_audit_events cascade;
    drop table if exists pitch_platform_settings cascade;
    drop table if exists site_settings cascade;
    drop table if exists pitch_commands cascade;
    drop table if exists pitch_editions cascade;
    drop table if exists pitch_mutations cascade;
    drop table if exists pitch_deck_backups cascade;
    drop table if exists pitch_assets cascade;
    drop table if exists pitch_access_tokens cascade;
    drop table if exists pitch_decks cascade;
    drop table if exists event_drops cascade;
    drop table if exists guest_requests cascade;
    drop table if exists scanner_link_devices cascade;
    drop table if exists scanner_links cascade;
    drop table if exists checkpoint_usage cascade;
    drop table if exists checkpoints cascade;
    drop table if exists ticket_exchange_refunds cascade;
    drop table if exists ticket_exchanges cascade;
    drop table if exists checkout_sessions cascade;
    drop table if exists tickets cascade;
    drop table if exists ticket_types cascade;
    drop table if exists events cascade;
    drop table if exists schema_migrations cascade;
  `);
  await runMigrations();
}

/** Fast per-test cleanup that keeps the schema in place. */
export async function truncateAll(): Promise<void> {
  const { query } = await import("@/lib/platform/postgres.server");
  await query(
    `truncate application_scheduled_jobs, email_delivery_events, email_suppressions, email_outbox, communication_links, pitch_decks,
              attendee_credit_claim_links, attendee_credit_grants, attendee_credit_campaigns,
              event_waitlist_inventory, event_waitlist_entries, checkout_sessions, tickets,
              ticket_types, events restart identity cascade`,
  );
  // New tables land via cascade from events/tickets, but be explicit so a
  // future FK loosening cannot quietly leak state between tests.
  await query(
    `truncate hot_and_cold_daily_results, person_recovery_codes, person_totp_authenticators, person_passkeys,
              person_webauthn_profiles, event_order_managers, event_ticket_identity_claims,
              event_person_login_challenges, event_person_identifiers, event_people,
              attendee_operations_audit_events, admin_alert_recipients, admin_notification_reads,
              admin_notifications,
              admin_attention_cases, attendee_domain_events, global_admin_grants,
              ticket_refund_allocations, ticket_return_requests, ticket_transfers,
              ticket_assignments, attendee_action_links, event_operation_policies,
              event_drops, guest_requests, scanner_link_devices, scanner_links,
              checkpoint_usage, checkpoints, site_settings cascade`,
  ).catch(() => {});
  await query(
    `update attendee_operation_settings set
       global_availability = '{"scoring":true,"publicLeaderboard":true,"manualStaffAwards":true,"discoveries":true,"guestPhotos":true,"transfers":false,"onwardTransfers":false,"complimentaryTransfers":false}'::jsonb,
       new_event_defaults = '{"scoring":false,"publicLeaderboard":false,"manualStaffAwards":false,"discoveries":false,"guestPhotos":false,"transfers":false,"onwardTransfers":false,"complimentaryTransfers":false}'::jsonb,
       emergency_paused = '{}'::jsonb, revision = 1, updated_by = 'root-owner',
       update_reason = null, updated_at = now()
     where id = true`,
  ).catch(() => {});
  await query(
    `update pitch_platform_settings set mode = 'enabled', updated_at = now() where singleton = true`,
  ).catch(() => {});
}

export async function closeDatabase(): Promise<void> {
  if (suiteLockClient) {
    await suiteLockClient
      .query("select pg_advisory_unlock($1)", [TEST_SUITE_LOCK_KEY])
      .catch(() => {});
    suiteLockClient.release();
    suiteLockClient = null;
  }
  const { closePool } = await import("@/lib/platform/postgres.server");
  await closePool();
}
