import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("editor word catalogue is server-rendered and reused after hydration", async ({ page }) => {
  test.setTimeout(120_000);
  const pool = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const slug = `query-editor-${randomUUID().slice(0, 8)}`;
  try {
    await pool.query(
      `insert into words
       (slug,title,type,body_key,visibility,markdown,created_at,updated_at,
        reading_time,reading_time_version,author_role,revision)
       values ($1,'Hydrated Editor Word','note',$2,'private','Editor word body.',
               now(),now(),1,2,'admin',1)`,
      [slug, `words/${slug}`],
    );
    await page.goto("/admin");
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }
    const response = await page.request.get("/admin/editor");
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Hydrated Editor Word");
    await page.goto("/admin/editor");
    await waitForAppHydration(page);
    await expect(page.getByText("Hydrated Editor Word").first()).toBeVisible();
  } finally {
    await pool.query("delete from words where slug=$1", [slug]);
    await pool.end();
  }
});
