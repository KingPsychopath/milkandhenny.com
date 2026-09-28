import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("best dressed voting page hydrates its server snapshot", async ({ page }) => {
  const response = await page.request.get("/best-dressed");
  expect(response.ok()).toBe(true);
  expect(await response.text()).toContain("Best dressed");

  await page.goto("/best-dressed");
  await waitForAppHydration(page);
  await expect(page.getByRole("heading", { name: "Best dressed" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "cast your vote" })).toBeVisible();
  await expect(page.getByRole("button", { name: "submit one vote" })).toBeDisabled();
});
