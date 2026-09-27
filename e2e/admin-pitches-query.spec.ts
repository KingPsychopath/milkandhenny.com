import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("pitch workspace and reminder status hydrate on the first admin render", async ({ page }) => {
  const url = "/admin?view=events&eventWorkspace=pitches";
  await page.goto(url);
  await waitForAppHydration(page);
  const password = page.getByLabel("admin password", { exact: true });
  if (await password.isVisible()) {
    await password.fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
  }

  const listResponse = await page.request.get("/api/admin/pitches");
  expect(listResponse.ok()).toBe(true);
  const list = (await listResponse.json()) as { pitches: unknown[] };
  const reminderResponse = await page.request.get("/api/admin/pitches?view=reminders");
  expect(reminderResponse.ok()).toBe(true);

  const response = await page.request.get(url);
  expect(response.ok()).toBe(true);
  const html = await response.text();
  expect(html).toContain(`${list.pitches.length} working`);
  expect(html).toContain("automatic nudges");

  await page.goto(url);
  await waitForAppHydration(page);
  await expect(page.getByRole("heading", { name: /working pitches?/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gentle reminders for unfinished pitches" }),
  ).toBeVisible();
});
