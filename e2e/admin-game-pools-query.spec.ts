import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("game entrance catalogue hydrates without replacing an unsaved draft", async ({ page }) => {
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";
  process.env.DATABASE_URL = databaseUrl;
  const database = new Pool({ connectionString: databaseUrl });
  const pools = await import("@/features/things/pool/store.server");
  const entrance = await pools.createGamePoolEntrance({
    game: "same-brain",
    label: `Hydrated entrance ${randomUUID().slice(0, 8)}`,
    actionId: `admin-query-${randomUUID()}`,
  });
  try {
    const url = "/admin?view=games";
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
    expect(await response.text()).toContain(entrance.label);
    await page.goto(url);
    await waitForAppHydration(page);
    const row = page.locator("li").filter({ hasText: entrance.label }).first();
    await row.getByRole("button", { name: "manage", exact: true }).click();
    const label = row.getByLabel("label", { exact: true });
    await label.fill("My unsaved room label");
    await page.getByRole("button", { name: "refresh entrances" }).click();
    await expect(label).toHaveValue("My unsaved room label");
  } finally {
    await database.query("delete from game_pool_entrances where id=$1", [entrance.id]);
    await database.end();
  }
});
