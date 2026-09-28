import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("shared-page summaries load when the content tool opens", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/admin?view=content");
  await waitForAppHydration(page);
  const password = page.getByLabel("admin password", { exact: true });
  if (await password.isVisible()) {
    await password.fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
  }
  await page.goto("/admin?view=content");
  await waitForAppHydration(page);
  await page.getByRole("tab", { name: "shared pages" }).click();
  await expect(page.getByText("currently shared pages")).toBeVisible();
  await expect(page.getByText("No currently shared pages.")).toBeVisible();
  await page.getByRole("tab", { name: "maintenance" }).click();
  await expect(
    page.locator("#word-media-orphans").getByText("Failed to scan orphan word media folders"),
  ).toBeVisible();
});
