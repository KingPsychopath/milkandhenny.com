import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("guest upload access hydrates its active state and reconciles closure", async ({ page }) => {
  test.setTimeout(75_000);
  const redis = new Redis({
    url: process.env.PLAYWRIGHT_REDIS_REST_URL ?? "http://127.0.0.1:56380",
    token: "local-browser-test",
  });
  const key = "auth:upload-open";
  try {
    await page.goto("/admin?view=transfers");
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }
    await redis.set(
      key,
      JSON.stringify({
        id: randomUUID(),
        token: randomUUID(),
        openedAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
        durationMinutes: 15,
      }),
      { ex: 900 },
    );
    const url = "/admin?view=transfers";
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("guest access is open");
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByText("guest access is open", { exact: true })).toBeVisible();

    await redis.del(key);
    await expect(page.getByRole("button", { name: "open uploads", exact: true })).toBeVisible({
      timeout: 25_000,
    });
  } finally {
    await redis.del(key);
  }
});
