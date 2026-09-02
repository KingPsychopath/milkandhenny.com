import { createHash } from "node:crypto";

import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("door staff find a typo, admit a whole order, and switch safely to a checkpoint", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  const suffix = safeSuffix();
  const eventSlug = `door-flow-${suffix.toLowerCase()}`;
  const ticketIds = [
    `01ARZ3NDEK${suffix}`,
    `01BRZ3NDEK${suffix}`,
    `01CRZ3NDEK${suffix}`,
    `01DRZ3NDEK${suffix}`,
  ];
  const roleId = `role_door_${suffix}`;
  const assignmentId = `staff_door_${suffix}`;
  const token = `staff_door_token_${suffix}_abcdefghijklmnopqrstuvwxyz`;
  const pool = new Pool({ connectionString: databaseUrl });

  await pool.query(
    `insert into events (slug,title,status,starts_at,timezone)
     values ($1,'Door flow QA','published',now(),'Europe/London')`,
    [eventSlug],
  );
  await pool.query(
    `insert into ticket_types (event_slug,id,name,quantity)
     values ($1,'standard','Standard',10)`,
    [eventSlug],
  );
  await pool.query(
    `insert into tickets
       (id,event_slug,ticket_type_id,holder_name,order_id,parent_ticket_id,redeemed_at,redeemed_by)
     values
       ($1,$5,'standard','Alice Group',$6,null,null,null),
       ($2,$5,'standard','Bobby Group',$6,$1,now(),'earlier scanner'),
       ($3,$5,'standard','Cara Group',$6,$1,null,null),
       ($4,$5,'standard','Dora Solo',$7,null,null,null)`,
    [
      ticketIds[0],
      ticketIds[1],
      ticketIds[2],
      ticketIds[3],
      eventSlug,
      `order-${suffix}`,
      `solo-${suffix}`,
    ],
  );
  await pool.query(
    `insert into checkpoints (event_slug,id,name,default_allowance,allowances,position)
     values ($1,'welcome-drink','Welcome drink',1,'{}'::jsonb,0)`,
    [eventSlug],
  );
  const permissions = { admitTickets: true, scanCheckpoints: true };
  const scope = { checkpointIds: ["welcome-drink"], rolePreset: "door-host" };
  await pool.query(
    `insert into event_staff_roles
       (id,event_slug,label,role_preset,permissions,scope,expires_at,created_by)
     values ($1,$2,'Front door','door-host',$3::jsonb,$4::jsonb,
       now() + interval '1 day','playwright')`,
    [roleId, eventSlug, JSON.stringify(permissions), JSON.stringify(scope)],
  );
  await pool.query(
    `insert into score_staff_assignments
       (id,event_slug,label,assignment_type,token_hash,permissions,scope,status,role_preset,
        invitation_state,role_id)
     values ($1,$2,'Front door','station',$3,$4::jsonb,$5::jsonb,'active',
       'door-host','active',$6)`,
    [
      assignmentId,
      eventSlug,
      createHash("sha256").update(token).digest("hex"),
      JSON.stringify(permissions),
      JSON.stringify(scope),
      roleId,
    ],
  );

  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  try {
    await page.goto(`/events/${eventSlug}/staff/${token}`);
    await expect(page.getByRole("heading", { name: "Door flow QA" })).toBeVisible();
    await expect
      .poll(() =>
        page
          .getByPlaceholder("name or ticket")
          .evaluate((element) =>
            Object.keys(element).some((key) => key.startsWith("__reactProps$")),
          ),
      )
      .toBe(true);
    await expect(page.getByRole("button", { name: "door", exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );

    const finder = page.getByPlaceholder("name or ticket");
    await finder.fill("Alcie");
    await page.getByRole("button", { name: /Alice Group/ }).click();
    const order = page.getByRole("region", { name: "3 tickets on this order" });
    await expect(order).toContainText("Alice Group");
    await expect(order).toContainText("Bobby Group");
    await expect(order).toContainText("inside ✓");
    await expect(order.getByRole("button", { name: "check in 1" })).toBeVisible();
    await order.getByRole("button", { name: "select everyone" }).click();
    await order.getByRole("button", { name: "check in 2" }).click();
    await expect(page.getByRole("status")).toContainText("2 guests are checked in");
    await expect
      .poll(async () => {
        const result = await pool.query<{ count: string }>(
          `select count(*)::text as count from tickets
            where event_slug = $1 and redeemed_at is not null`,
          [eventSlug],
        );
        return result.rows[0]?.count;
      })
      .toBe("3");

    await finder.fill("Dora");
    await expect(page.getByRole("button", { name: /Dora Solo/ })).toBeVisible();
    await context.setOffline(true);
    await page.getByRole("button", { name: /Dora Solo/ }).click();
    await expect(page.getByRole("alert")).toContainText("Check the connection and try again");
    await expect(finder).toHaveValue(ticketIds[3]!);
    await context.setOffline(false);
    await page.getByRole("button", { name: "check in" }).click();
    await expect(page.getByRole("status")).toContainText("Dora Solo is checked in");

    await page.getByRole("button", { name: "checkpoints" }).click();
    await expect(page.getByRole("heading", { name: "Record an allowance" })).toBeVisible();
    await expect(page.getByText("Welcome drink", { exact: true })).toBeVisible();
    await finder.fill("Cara");
    await page.getByRole("button", { name: /Cara Group/ }).click();
    await expect(page.getByRole("status")).toContainText("recorded 1 · 0 left");
    await expect(page.getByRole("heading", { name: "Check a guest in" })).toHaveCount(0);

    await finder.fill("Nobody Here");
    await expect(page.getByText("No matching guest yet.")).toBeVisible();
    await page.getByRole("button", { name: "record 1" }).click();
    await expect(page.getByRole("alert")).toContainText("No active ticket matches");

    await page.getByRole("button", { name: "door", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveCount(0);
    await finder.fill("Bobby");
    await page.getByRole("button", { name: /Bobby Group/ }).click();
    const completedOrder = page.getByRole("region", { name: "3 tickets on this order" });
    await expect(completedOrder.getByText("inside ✓")).toHaveCount(3);
    await expect(completedOrder.getByRole("status")).toContainText("Everyone is already inside");
    await completedOrder.getByRole("button", { name: "back to search" }).click();
    await finder.fill("Alice");
    await expect(page.getByRole("alert")).toHaveCount(0);
  } finally {
    await context.close();
    await pool.end();
  }
});

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
