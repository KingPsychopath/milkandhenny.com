import { createHash, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin credits hydrate campaigns and load one selected recipient list", async ({ page }) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const id = randomUUID();
  const grantId = randomUUID();
  const email = `credits-${id.slice(0, 8)}@example.com`;
  try {
    await database.query(
      `insert into attendee_credit_campaigns
       (id,campaign_key,name,amount_minor,currency,claim_expires_at,status)
       values ($1,$2,'Hydrated credit promise',500,'GBP',now() + interval '7 days','active')`,
      [id, `credits-${id.slice(0, 8)}`],
    );
    await database.query(
      `insert into attendee_credit_grants
       (id,campaign_id,email,email_hash,units_total)
       values ($1,$2,$3,$4,1)`,
      [grantId, id, email, createHash("sha256").update(email).digest("hex")],
    );

    const url = "/admin?view=communications&communicationTab=credits";
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
    expect(await response.text()).toContain("Hydrated credit promise");
    await page.goto(url);
    await waitForAppHydration(page);
    await page.getByRole("button", { name: /Hydrated credit promise/ }).click();
    await expect(page.getByText(email, { exact: true })).toBeVisible();
  } finally {
    await database.query("delete from attendee_credit_campaigns where id=$1", [id]);
    await database.end();
  }
});
