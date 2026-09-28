import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("Hot and Cold quality evidence loads when its disclosure opens", async ({ page }) => {
  test.setTimeout(75_000);
  await page.goto("/admin?view=games");
  await waitForAppHydration(page);
  const password = page.getByLabel("admin password", { exact: true });
  if (await password.isVisible()) {
    await password.fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
  }
  await page.goto("/admin?view=games");
  await waitForAppHydration(page);
  await expect(page.getByRole("heading", { name: "Hot and Cold quality window" })).toHaveCount(0);
  await page.getByText("puzzle quality · review upcoming approvals", { exact: true }).click();
  await expect(page.getByRole("heading", { name: "Hot and Cold quality window" })).toBeVisible();
  await expect(page.getByLabel("Upcoming Hot and Cold puzzle")).toBeVisible();
});
