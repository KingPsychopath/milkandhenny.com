import { expect, test } from "@playwright/test";

test("creates, saves, publishes, presents, and remotely controls a pitch", async ({
  browser,
  page,
}) => {
  const suffix = `${Date.now()}`;
  const title = `Playwright pitch ${suffix}`;
  const editedTitle = `${title} saved`;

  await page.addInitScript(() => {
    localStorage.setItem("milkandhenny:pitch-studio-tour:v1", "seen");
  });
  await page.goto("/things/pitches/new");
  await page.getByLabel("pitch title").fill(title);
  await page.getByLabel("your name").fill("Pitch Tester");
  await page.getByLabel("recovery email").fill(`pitch-${suffix}@example.com`);
  await page.getByRole("button", { name: "open the studio" }).click();

  await expect(page).toHaveURL(/\/things\/pitches\/[^/]+\/edit/);
  const deckId = new URL(page.url()).pathname.split("/")[3];
  expect(deckId).toBeTruthy();

  const editorTitle = page.locator('input[aria-label="Pitch title"]');
  await expect(editorTitle).toBeVisible();
  await editorTitle.fill(editedTitle);
  await expect(page.getByText("saved", { exact: true })).not.toBeVisible();
  await page.getByLabel("Current slide name").fill("Opening claim");
  await page.getByRole("button", { name: "+ slide" }).click();
  await page.getByLabel("Current slide name").fill("Closing proof");
  await expect(page.getByText("saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.reload();
  await expect(editorTitle).toHaveValue(editedTitle);
  await expect(page.getByRole("button", { name: /Closing proof/ })).toBeVisible();
  await expect(page.getByText("saved", { exact: true })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("button", { name: "publish + seal" }).click();
  await expect(page.getByRole("status")).toContainText("Published", { timeout: 20_000 });

  await page.goto(`/things/pitches/${deckId}`);
  await expect(page.getByRole("heading", { name: editedTitle })).toBeVisible();

  await page.goto("/admin");
  await page.getByPlaceholder("admin password").fill("playwright-admin-password");
  await page.getByRole("button", { name: "unlock" }).click();
  await expect(page).not.toHaveURL(/\/admin$/);

  await page.goto("/things/pitches/present");
  await page.getByRole("button", { name: "open presentation screen" }).click();
  await expect(page).toHaveURL(/\/things\/pitches\/present\/[^/]+/);
  const roomId = new URL(page.url()).pathname.split("/").at(-1);
  expect(roomId).toBeTruthy();

  const remoteContext = await browser.newContext();
  const remote = await remoteContext.newPage();
  await remote.goto(`/things/pitches/remote/${roomId}`);
  await remote.getByLabel("your name").fill("Remote Tester");
  await remote.getByRole("button", { name: "request control" }).click();

  await expect(page.getByText("Remote Tester")).toBeVisible({ timeout: 15_000 });
  await page.getByRole("button", { name: "allow" }).click();
  await expect(remote.getByText("you have the room", { exact: false })).toBeVisible({
    timeout: 15_000,
  });

  await remote.getByPlaceholder("name or idea").fill(editedTitle);
  await remote.getByRole("button", { name: new RegExp(editedTitle) }).click();
  await expect(page.getByText("1 / 2")).toBeVisible({ timeout: 15_000 });
  await remote.getByRole("button", { name: /next/ }).click();
  await expect(page.getByText("2 / 2")).toBeVisible({ timeout: 15_000 });

  await remoteContext.close();
});
