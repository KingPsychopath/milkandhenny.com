import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("admin voting window renders on the server and updates after a command", async ({ page }) => {
  test.skip(
    process.env.BEST_DRESSED_STORE !== "postgres",
    "Requires the isolated Postgres voting store",
  );
  test.setTimeout(60_000);
  const url = "/admin?view=best-dressed";
  await page.goto(url);
  await waitForAppHydration(page);
  const password = page.getByLabel("admin password", { exact: true });
  if (await password.isVisible()) {
    await password.fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
    await page.goto(url);
    await waitForAppHydration(page);
  }

  try {
    await page.getByRole("button", { name: "open voting" }).click();
    await expect(page.getByText(/open until/)).toBeVisible();
    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("open until");
    await page.reload();
    await waitForAppHydration(page);
    await expect(page.getByText(/open until/)).toBeVisible();
  } finally {
    await page.request.post("/api/best-dressed/voting/open", { data: { minutes: 0 } });
  }
});
