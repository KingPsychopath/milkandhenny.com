import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
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
  await expect(page.getByRole("heading", { name: /working pitch(?:es)?/ })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Gentle reminders for unfinished pitches" }),
  ).toBeVisible();
});

test("selected pitch detail opens through a private Query", async ({ page }) => {
  test.setTimeout(60_000);
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const suffix = randomUUID().slice(0, 8);
  const title = `Admin Query Pitch ${suffix}`;
  let deckId = "";
  try {
    await page.goto("/things/pitches/new");
    await page.getByLabel("pitch title").fill(title);
    await page.getByLabel("your name").fill("Query Pitch Owner");
    await page.getByLabel("recovery email").fill(`pitch-${suffix}@example.com`);
    await page.getByRole("button", { name: "open the studio" }).click();
    await expect(page).toHaveURL(/\/things\/pitches\/[^/]+\/edit/);
    deckId = new URL(page.url()).pathname.split("/")[3] ?? "";

    const url = "/admin?view=events&eventWorkspace=pitches";
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
    await expect(page.locator("#pitch-manager")).not.toHaveAttribute("inert");
    await page.getByRole("button", { name: `Edit ${title}` }).click();
    await expect(page.getByRole("heading", { name: "Pitch control room" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "pitch title", exact: true })).toHaveValue(
      title,
    );
  } finally {
    if (deckId) await database.query("delete from pitch_decks where id=$1", [deckId]);
    await database.end();
  }
});
