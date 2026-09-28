import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("alert recipients render on the server for the delivery workspace", async ({ page }) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const id = randomUUID();
  const hint = `hydrated-alert-${id.slice(0, 8)}@example.test`;
  try {
    await database.query(
      `insert into admin_alert_recipients(id,email_hash,email_hint,email_address,verified_at)
       values ($1,$2,$3,$3,now())`,
      [id, id.replaceAll("-", "").repeat(2), hint],
    );
    const url = "/admin?view=communications&communicationTab=delivery";
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
    expect(await response.text()).toContain(hint);
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByText(hint, { exact: true })).toBeVisible();
  } finally {
    await database.query("delete from admin_alert_recipients where id=$1", [id]);
    await database.end();
  }
});
