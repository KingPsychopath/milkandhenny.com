import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin event catalogue is in the initial server render and hydrated workspace", async ({
  page,
}) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const slug = `query-admin-event-${randomUUID().slice(0, 8)}`;
  try {
    await database.query(
      `insert into events(slug,title,status,starts_at,timezone)
       values ($1,'Hydrated event catalogue','draft',now() + interval '7 days','Europe/London')`,
      [slug],
    );
    await page.goto("/admin?view=events&eventWorkspace=events");
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }

    const url = "/admin?view=events&eventWorkspace=events";
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Hydrated event catalogue");
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(
      page.locator("#events-manager li").filter({ hasText: "Hydrated event catalogue" }),
    ).toBeVisible();
  } finally {
    await database.query("delete from events where slug=$1", [slug]);
    await database.end();
  }
});
