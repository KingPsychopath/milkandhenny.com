import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("session security reads the hydrated private token session query", async ({ page }) => {
  await page.goto("/admin?view=system");
  await waitForAppHydration(page);
  const password = page.getByLabel("admin password", { exact: true });
  if (await password.isVisible()) {
    await password.fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
    await page.goto("/admin?view=system");
    await waitForAppHydration(page);
  }

  const response = await page.request.get("/api/admin/tokens/sessions");
  expect(response.ok()).toBe(true);
  const data = (await response.json()) as { count: number; sessions: Array<{ jti: string }> };
  expect(data.count).toBe(data.sessions.length);
  await expect(page.getByText("token sessions", { exact: false }).first()).toBeVisible();
  if (data.sessions.length > 0) {
    await expect(page.getByText(data.sessions[0].jti, { exact: true })).toHaveCount(1);
  }
});
