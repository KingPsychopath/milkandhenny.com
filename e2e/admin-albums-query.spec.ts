import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin album catalogue hydrates its first render", async ({ page }) => {
  test.skip(process.env.ALBUM_STORE !== "postgres", "Requires the isolated Postgres album store");
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const slug = `admin-query-album-${randomUUID().slice(0, 8)}`;
  try {
    await database.query(
      `insert into gallery_albums
       (slug,title,album_date,status,updated_at)
       values ($1,'Hydrated admin gallery','2026-09-27','draft',now())`,
      [slug],
    );
    const url = "/admin?view=content";
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
    expect(await response.text()).toContain("Hydrated admin gallery");
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByText("Hydrated admin gallery", { exact: true }).first()).toBeVisible();
    await expect(page.locator("#album-manager")).not.toHaveAttribute("inert");
    const title = page.locator('input[name="album-title"]');
    await title.fill("My unsaved gallery title");
    await page.locator("#album-manager").getByRole("button", { name: "refresh" }).click();
    await expect(title).toHaveValue("My unsaved gallery title");
  } finally {
    await database.query("delete from gallery_albums where slug=$1", [slug]);
    await database.end();
  }
});
