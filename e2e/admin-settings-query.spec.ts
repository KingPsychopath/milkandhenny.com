import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin access policies and administrator grants hydrate on the first render", async ({
  page,
}) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const slug = `query-settings-${randomUUID().slice(0, 8)}`;
  try {
    await database.query(
      `insert into events(slug,title,status,starts_at,timezone)
       values ($1,'Hydrated access policy','draft',now() + interval '7 days','Europe/London')`,
      [slug],
    );
    const url = "/admin?view=settings";
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
    const html = await response.text();
    expect(html).toContain("Hydrated access policy");
    expect(html).toContain("Named administrators");

    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByRole("heading", { name: "Named administrators" })).toBeVisible();
    // The initial event selection fills this panel after hydration and changes page height.
    await expect(
      page.getByRole("group", { name: "Hydrated access policy", exact: true }),
    ).toBeVisible();
    await page.getByLabel("event activation", { exact: true }).click();
    await expect(
      page.getByRole("option", { name: "Hydrated access policy · draft", exact: true }),
    ).toBeVisible();
  } finally {
    await database.query("delete from events where slug=$1", [slug]);
    await database.end();
  }
});
