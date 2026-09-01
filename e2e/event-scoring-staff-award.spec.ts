import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("staff can award a multi-ticket order and an attendee can claim a live QR", async ({
  browser,
}) => {
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

  const attendeeContext = await browser.newContext();
  const staffContext = await browser.newContext();
  const rivalContext = await browser.newContext();
  const attendee = await attendeeContext.newPage();
  const staff = await staffContext.newPage();
  const rival = await rivalContext.newPage();
  let attendeeNotificationRequests = 0;
  attendee.on("request", (request) => {
    if (request.url().includes("/score/notifications")) attendeeNotificationRequests += 1;
  });

  try {
    await expectTicketFixtures(pool, eventSlug, [firstTicket, secondTicket]);
    await attendee.goto(`/ticket/${secondTicket}`);
    await chooseTicketForPoints(attendee);
    await expectTicketFixtures(pool, eventSlug, [firstTicket, secondTicket]);
    await attendee.goto(`/ticket/${firstTicket}`);
    await expectTicketFixtures(pool, eventSlug, [firstTicket, secondTicket]);
    await chooseTicketForPoints(attendee);
    await expect.poll(() => attendeeNotificationRequests).toBeGreaterThan(0);

    await staff.goto(`/events/${eventSlug}/staff/${stationToken}`);
    await expect(staff.getByRole("heading", { name: "Staff award QA" })).toBeVisible();
    await staff.waitForLoadState("networkidle");
    await staff.getByPlaceholder("name, alias, or ticket").fill("First guest");
    await staff.getByRole("button", { name: "find", exact: true }).click();
    const participantResult = staff.getByRole("button", {
      name: /First guest.*2 tickets/,
    });
    await expect(participantResult).toBeVisible({ timeout: 15_000 });
    await participantResult.click();
    await staff.getByRole("button", { name: "all 2", exact: true }).click();
    await staff.getByRole("button", { name: /Quick bonus.*\+3/ }).click();

    await expect
      .poll(async () => balances(pool, eventSlug))
      .toEqual({ "First guest": 3, "Second guest": 3 });
    const noticeProbe = await attendee.evaluate(async (ticketId) => {
      const response = await fetch(`/api/tickets/${ticketId}/score/notifications`);
      return { status: response.status, body: await response.json() };
    }, firstTicket);
    expect(noticeProbe).toMatchObject({
      status: 200,
      body: { notifications: [{ points: 3 }] },
    });
    const scoreUpdate = attendee.getByRole("complementary", { name: "Score update" });
    await expect(scoreUpdate.getByText("score updated")).toBeVisible({ timeout: 15_000 });
    await expect(scoreUpdate).toContainText("3points");
    await expect(scoreUpdate).toContainText("+3");
    await expect(scoreUpdate).toHaveCount(1);
    await expect(attendee.getByText("managed order total: 6 points")).toBeVisible();

    await staff.reload();
    await staff.waitForLoadState("networkidle");
    await staff.getByRole("button", { name: "First guest recent award" }).click();
    await expect(staff.getByRole("region", { name: "First guest" })).toContainText("3 points");
    await expect(staff.getByRole("region", { name: "First guest" })).toContainText(
      "6 across 2 tickets",
    );

    await staff.getByRole("button", { name: "show a QR" }).click();
    const qrSection = staff.getByRole("region", { name: "One-use award QR" });
    await qrSection.getByRole("button", { name: /Checked-in bonus.*\+3/ }).click();
    const claimLink = qrSection.getByRole("link", { name: "open claim link" });
    await expect(claimLink).toBeVisible();
    const claimUrl = await claimLink.getAttribute("href");
    expect(claimUrl).toBeTruthy();

    await attendee.goto(claimUrl!);
    await expect(attendee.getByText("Check in before claiming these points.")).toBeVisible();
    await expect(attendee.getByRole("link", { name: "open ticket for check-in" })).toBeVisible();
    await pool.query(
      `update event_participants set checked_in_at = now()
        where ticket_id = $1 and event_slug = $2`,
      [firstTicket, eventSlug],
    );
    let loseFirstClaimResponse = true;
    await attendee.route("**/award-claims/**", async (route) => {
      if (!loseFirstClaimResponse) {
        await route.continue();
        return;
      }
      loseFirstClaimResponse = false;
      await route.fetch();
      await route.abort("failed");
    });
    await attendee.getByRole("button", { name: "check again and claim 3 points" }).click();
    await expect(attendee.getByText("Confirmation pending.")).toBeVisible({ timeout: 15_000 });
    await expect(attendee.getByText("+3 points confirmed.")).toBeVisible({ timeout: 15_000 });
    await expect(attendee.getByRole("link", { name: "ticket & points" })).toBeVisible();
    await expect(attendee.getByRole("link", { name: "leaderboard" })).toBeVisible();
    await expect
      .poll(async () => balances(pool, eventSlug))
      .toEqual({ "First guest": 6, "Second guest": 3 });

    await attendee.goto("/things");
    const eventNavigation = attendee.getByRole("navigation", { name: "Your event ticket" });
    await expect(eventNavigation).toBeVisible();
    await expect(eventNavigation.getByRole("link", { name: "ticket", exact: true })).toBeVisible();
    await expect(eventNavigation.getByRole("link", { name: "save", exact: true })).toBeVisible();
    await eventNavigation.getByRole("link", { name: "score", exact: true }).click();
    await expect(attendee).toHaveURL(new RegExp(`/events/${eventSlug}/score$`));
    await expect(attendee.getByRole("heading", { name: "Leaderboard" })).toBeVisible();

    await rival.goto(`/ticket/${secondTicket}`);
    await chooseTicketForPoints(rival);
    await rival.goto(claimUrl!);
    await expect(rival.getByText("These points have already been claimed.")).toBeVisible({
      timeout: 15_000,
    });
    await expect
      .poll(async () => balances(pool, eventSlug))
      .toEqual({ "First guest": 6, "Second guest": 3 });
  } finally {
    await Promise.allSettled([attendeeContext.close(), staffContext.close(), rivalContext.close()]);
    await pool.end();
  }
});

async function expectTicketFixtures(pool: Pool, eventSlug: string, ticketIds: string[]) {
  await expect
    .poll(async () => {
      const result = await pool.query<{ id: string }>(
        `select id from tickets where event_slug = $1 order by id`,
        [eventSlug],
      );
      return result.rows.map((row) => row.id);
    })
    .toEqual([...ticketIds].sort());
}

async function chooseTicketForPoints(page: import("@playwright/test").Page) {
  const button = page.getByRole("button", { name: "use this ticket for points" });
  await expect(button).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() =>
      button.evaluate((element) =>
        Object.keys(element).some((key) => key.startsWith("__reactProps$")),
      ),
    )
    .toBe(true);
  await button.click();
  await expect(
    page
      .getByRole("status")
      .filter({ hasText: "This device will use this ticket for event points." }),
  ).toBeVisible({ timeout: 15_000 });
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem("mah-has-score-session")))
    .toBe("1");
}

function safeSuffix() {
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  let source = Date.now();
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix = `${alphabet[source % alphabet.length]}${suffix}`;
    source = Math.floor(source / alphabet.length);
  }
  return suffix;
}

async function balances(pool: Pool, eventSlug: string) {
  const result = await pool.query<{ holder_name: string; balance: number }>(
    `select tickets.holder_name,coalesce(projections.balance,0)::integer as balance
       from tickets
       join event_participants participants on participants.ticket_id = tickets.id
       left join score_projections projections on projections.participant_id = participants.id
      where tickets.event_slug = $1
      order by tickets.holder_name`,
    [eventSlug],
  );
  return Object.fromEntries(result.rows.map((row) => [row.holder_name, row.balance]));
}
