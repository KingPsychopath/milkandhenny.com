import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("legacy points-only staff credentials cannot reopen awards", async ({ browser }) => {
  test.setTimeout(120_000);
  const suffix = safeSuffix();
  const eventSlug = `staff-award-${suffix.toLowerCase()}`;
  const firstTicket = `01ARZ3NDEK${suffix}`;
  const secondTicket = `01BRZ3NDEK${suffix}`;
  const orderId = `qa-order-${suffix}`;
  const assignmentId = `staff_qa_${suffix}`;
  const roleId = `role_qa_${suffix}`;
  const activityId = `activity_qa_${suffix}`;
  const checkedActivityId = `activity_checked_${suffix}`;
  const stationToken = `staff_qa_token_${suffix}`;
  const pool = new Pool({ connectionString: databaseUrl });

  await pool.query(
    `insert into events (slug,title,status,starts_at,timezone)
     values ($1,'Staff award QA','published',now(),'Europe/London')`,
    [eventSlug],
  );
  await pool.query(
    `insert into ticket_types (event_slug,id,name,quantity)
     values ($1,'standard','Standard',4)`,
    [eventSlug],
  );
  await pool.query(
    `insert into tickets (id,event_slug,ticket_type_id,holder_name,order_id) values
       ($1,$3,'standard','First guest',$4),
       ($2,$3,'standard','Second guest',$4)`,
    [firstTicket, secondTicket, eventSlug, orderId],
  );
  await pool.query(
    `insert into event_scoring_settings (event_slug,state,leaderboard_visibility)
     values ($1,'live','hidden')`,
    [eventSlug],
  );
  await pool.query(
    `insert into score_activities (id,event_slug,name,template,status,rule)
     values
       ($1,$3,'Quick bonus','participation','live',$4::jsonb),
       ($2,$3,'Checked-in bonus','scan-to-award','live',$5::jsonb)`,
    [
      activityId,
      checkedActivityId,
      eventSlug,
      JSON.stringify({
        mode: "fixed",
        fixedPoints: 3,
        repeat: "repeat",
        requiresCheckIn: false,
      }),
      JSON.stringify({
        mode: "fixed",
        fixedPoints: 3,
        repeat: "repeat",
        requiresCheckIn: true,
      }),
    ],
  );
  await pool.query(
    `insert into event_staff_roles
       (id,event_slug,label,role_preset,permissions,scope,expires_at,created_by)
     values ($1,$2,'QA points marshal','points-marshal',$3::jsonb,$4::jsonb,
       now() + interval '1 day','playwright')`,
    [
      roleId,
      eventSlug,
      JSON.stringify({ awardPoints: true, viewParticipantPoints: true }),
      JSON.stringify({
        activityIds: [activityId, checkedActivityId],
        rolePreset: "points-marshal",
      }),
    ],
  );
  await pool.query(
    `insert into score_staff_assignments
       (id,event_slug,label,assignment_type,token_hash,permissions,scope,status,role_preset,
        invitation_state,role_id)
     values ($1,$2,'QA points marshal','station',$3,$4::jsonb,$5::jsonb,'active',
       'points-marshal','active',$6)`,
    [
      assignmentId,
      eventSlug,
      createHash("sha256").update(stationToken).digest("hex"),
      JSON.stringify({ awardPoints: true, viewParticipantPoints: true }),
      JSON.stringify({
        activityIds: [activityId, checkedActivityId],
        rolePreset: "points-marshal",
      }),
      roleId,
    ],
  );
  await pool.query(
    `insert into score_pools (id,event_slug,owner_type,owner_id,issued_points)
     values ($1,$2,'station',$3,30)`,
    [`pool_qa_${suffix}`, eventSlug, assignmentId],
  );

  const context = await browser.newContext();
  const page = await context.newPage();
  try {
    await page.goto(`/events/${eventSlug}/staff/${stationToken}`);
    await expect(page.getByText("No active event tools", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Award points|Quick bonus/ })).toHaveCount(0);
    const response = await page.request.post(
      `/api/events/${eventSlug}/award-claims/${stationToken}`,
      {
        headers: { Origin: new URL(page.url()).origin },
        data: { ticketIds: [firstTicket, secondTicket], activityId },
      },
    );
    expect(response.status()).toBe(410);
    const ledger = await pool.query(
      "select count(*)::integer as count from score_transactions where event_slug = $1",
      [eventSlug],
    );
    expect(ledger.rows[0].count).toBe(0);
  } finally {
    await context.close();
    await pool.end();
  }
});

function safeSuffix() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  return Array.from(
    { length: 10 },
    () => alphabet[Math.floor(Math.random() * alphabet.length)],
  ).join("");
}
