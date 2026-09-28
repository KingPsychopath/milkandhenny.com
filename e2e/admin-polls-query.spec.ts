import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin poll studio hydrates its active workspace read", async ({ page }) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const id = randomUUID();
  const slug = `admin-query-poll-${id.slice(0, 8)}`;
  try {
    await database.query(
      `insert into polls
       (id, slug, title, intro, question, options, selection_mode,
        result_visibility, show_percentages, status)
       values ($1, $2, 'Hydrated poll studio', 'Help us choose.', 'Which day works?',
               $3::jsonb, 'single', 'after_vote', false, 'open')`,
      [id, slug, JSON.stringify([{ id: "tuesday", label: "Tuesday" }])],
    );

    const url = "/admin?view=communications&communicationTab=polls";
    await page.goto(url);
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }

    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Hydrated poll studio");
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByRole("button", { name: /Hydrated poll studio/ })).toBeVisible();
  } finally {
    await database.query("delete from polls where id=$1", [id]);
    await database.end();
  }
});
