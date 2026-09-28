import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("filtered email ledger is present in initial HTML and hydrated delivery view", async ({
  page,
}) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const id = randomUUID();
  const subject = `Hydrated delivery ${id.slice(0, 8)}`;
  try {
    await database.query(
      `insert into email_outbox
       (id,idempotency_key,channel,recipient_hash,status,kind,source,recipient_hint,subject_hint)
       values ($1,$2,'operations',$3,'accepted','operations-alert','test','query@example.test',$4)`,
      [id, `query-email-${id}`, id.replaceAll("-", "").repeat(2), subject],
    );
    const url = `/admin?view=communications&communicationTab=delivery&emailStatus=accepted&emailQuery=${encodeURIComponent(subject)}`;
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
    expect(await response.text()).toContain(subject);
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByText(subject, { exact: true })).toBeVisible();
  } finally {
    await database.query("delete from email_outbox where id=$1", [id]);
    await database.end();
  }
});
