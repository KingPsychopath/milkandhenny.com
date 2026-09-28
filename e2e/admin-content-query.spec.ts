import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("admin overview and system reads are server-rendered and shared with the workspace", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.goto("/admin?view=overview");
  await waitForAppHydration(page);
  const password = page.getByLabel("admin password", { exact: true });
  if (await password.isVisible()) {
    await password.fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
  }

  const summaryResponse = await page.request.get("/api/admin/content-summary");
  expect(summaryResponse.ok()).toBe(true);
  const summary = (await summaryResponse.json()) as { blog: { totalPosts: number } };
  const expectedCount = String(summary.blog.totalPosts);

  const htmlResponse = await page.request.get("/admin?view=overview");
  expect(htmlResponse.ok()).toBe(true);
  expect(await htmlResponse.text()).toMatch(new RegExp(`words</dt><dd[^>]*>${expectedCount}</dd>`));

  await page.goto("/admin?view=overview");
  await waitForAppHydration(page);
  await expect(page.locator("dt", { hasText: "words" }).locator("+ dd")).toHaveText(expectedCount);

  const healthResponse = await page.request.get("/api/debug");
  expect(healthResponse.ok()).toBe(true);
  const health = (await healthResponse.json()) as { status: string };
  const systemResponse = await page.request.get("/admin?view=system");
  expect(systemResponse.ok()).toBe(true);
  expect(await systemResponse.text()).toContain("Core status");
  await page.goto("/admin?view=system");
  await waitForAppHydration(page);
  await expect(page.getByText(health.status, { exact: true }).first()).toBeVisible();
});
