import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { sonderOrder } from "../__tests__/helpers/sonder";
import { waitForAppHydration } from "./support/multiplayer";

test("Sonder bookings show mirrored counts and colour previews while native events retain ticket tools", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const connectionString =
    process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";
  const target = new URL(connectionString);
  if (
    !["127.0.0.1", "localhost"].includes(target.hostname) ||
    !["/mah_test", "/mah_preview"].includes(target.pathname)
  )
    throw new Error("This destructive browser fixture requires the isolated local test database");
  const db = new Pool({ connectionString });
  const slug = `sonder-browser-${randomUUID().slice(0, 8)}`;
  const native = `${slug}-native`,
    order = sonderOrder(2),
    team = `${slug}-team`;
  order.hangout_id = randomUUID();
  try {
    await db.query(`truncate events cascade`);
    for (const event of [slug, native])
      await db.query(
        `insert into events(slug,title,status,starts_at,timezone) values($1,$2,'published',now()+interval '7 days','Europe/London')`,
        [event, event === slug ? "Sonder browser event" : "Native browser event"],
      );
    await db.query(
      `insert into sonder_event_links(event_slug,hangout_id,mode,booking_url,last_sync_at,synced_revision) values($1,$2,'live','https://findsonder.app/synthetic-test',now(),0)`,
      [slug, order.hangout_id],
    );
    await db.query(
      `insert into score_teams(id,event_slug,name,colour_key) values($1,$2,'Sky group','sky')`,
      [team, slug],
    );
    await db.query(
      `insert into sonder_orders(event_slug,id,snapshot,team_id,snapshot_hash,seen_in_sync) values($1,$2,$3,$4,'synthetic',$5)`,
      [
        slug,
        order.order_id,
        JSON.stringify({
          ...order,
          tickets: order.tickets.map(({ qr_payload: _qr, ...ticket }) => ticket),
        }),
        team,
        randomUUID(),
      ],
    );
    for (const [i, ticket] of order.tickets.entries()) {
      const participant = `${slug}-guest-${i}`;
      await db.query(
        `insert into event_participants(id,event_slug,generated_alias,status) values($1,$2,$3,'active')`,
        [participant, slug, `Guest ${i + 1}`],
      );
      await db.query(
        `insert into sonder_tickets(event_slug,id,order_id,ordinal,status,participant_id,checked_in_at) values($1,$2,$3,$4,$5,$6,$7)`,
        [
          slug,
          ticket.id,
          order.order_id,
          ticket.ordinal,
          i === 0 ? "checked_in" : "valid",
          participant,
          i === 0 ? new Date() : null,
        ],
      );
    }
    await page.goto(`/admin?view=events&eventWorkspace=events&event=${slug}`);
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }
    await page.goto(`/admin?view=events&eventWorkspace=events&event=${slug}`);
    await waitForAppHydration(page);
    await expect(
      page.getByRole("heading", { name: "Sonder orders, teams & colours" }),
    ).toBeVisible();
    await expect(page.getByText("buyer@example.com", { exact: true })).toBeVisible();
    await expect(page.getByText("checked in", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "preview team emails", exact: true }).click();
    await expect(page.getByText(/Your booking group is on/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /queue.*email/ })).toBeDisabled();
    await page.screenshot({ path: "/tmp/mh-sonder-admin.png", fullPage: true });
    await page.goto(`/events/${slug}`);
    await waitForAppHydration(page);
    await expect(page.getByRole("link", { name: /book.*Sonder/i })).toBeVisible();
    await page.goto(`/admin?view=events&eventWorkspace=events&event=${native}`);
    await waitForAppHydration(page);
    await expect(
      page.getByRole("navigation", { name: "Native browser event tools" }),
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Sonder orders, teams & colours" })).toHaveCount(
      0,
    );
  } finally {
    // Mapping deletion is forbidden in the product; fixture cleanup uses the disposable database.
    await db.query(`truncate events cascade`);
    await db.end();
  }
});
