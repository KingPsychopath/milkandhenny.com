import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin inbox notification hydrates into the workspace", async ({ page }) => {
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const sourceId = randomUUID();
  const notificationId = randomUUID();
  try {
    await pool.query(
      `insert into attendee_domain_events
       (id, kind, deduplication_key, actor_type, severity, correlation_id)
       values ($1, 'test.query-inbox', $2, 'system', 'warning', $3)`,
      [sourceId, `query-inbox-${sourceId}`, sourceId],
    );
    await pool.query(
      `insert into admin_notifications
       (id, source_event_id, category, title, body, deep_link)
       values ($1, $2, 'test', 'Query inbox browser test', 'A new notification.',
               '/admin?view=operations')`,
      [notificationId, sourceId],
    );

    await page.goto("/admin?view=operations");
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
      await page.goto("/admin?view=operations");
      await waitForAppHydration(page);
    }

    const inboxResponse = await page.request.get("/api/admin/operations/inbox?active=1");
    expect(inboxResponse.ok()).toBe(true);
    const inbox = (await inboxResponse.json()) as { unread: number };
    expect(inbox.unread).toBeGreaterThanOrEqual(1);

    const notifications = page.getByRole("button", { name: /unread admin notification/ });
    await expect(notifications).toHaveAttribute(
      "aria-label",
      new RegExp(`^${inbox.unread} unread admin notification`),
    );
    await notifications.click();
    await expect(page.getByText("Query inbox browser test")).toBeVisible();
  } finally {
    await pool.query("delete from attendee_domain_events where id = $1", [sourceId]);
    await pool.end();
  }
});

test("a people deep link renders the searched identity from the route query", async ({ page }) => {
  test.setTimeout(120_000);
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const personId = randomUUID();
  try {
    await pool.query("insert into event_people(id,canonical_name) values ($1,$2)", [
      personId,
      "Query People Browser Test",
    ]);
    await page.goto("/admin?view=operations&operationsTab=people");
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }
    await page.goto(`/admin?view=operations&operationsTab=people&person=${personId}`);
    await waitForAppHydration(page);
    await expect(page.getByRole("textbox", { name: "Search people" })).toHaveValue(personId);
    await expect(page.getByText("Query People Browser Test").first()).toBeVisible();
  } finally {
    await pool.query("delete from event_people where id=$1", [personId]);
    await pool.end();
  }
});
