import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("footer destination is server rendered for the event workspace", async ({ page }) => {
  const url = "/admin?view=events&eventWorkspace=events";
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
  expect(html).toContain("live destination");

  await page.goto(url);
  await waitForAppHydration(page);
  await page.getByText("public footer destination").click();
  await expect(page.getByText("live destination")).toBeVisible();
});
