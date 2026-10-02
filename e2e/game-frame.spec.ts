import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("every game setup has the same accessible menu and a direct home exit on a phone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 375, height: 812 });
  for (const game of [
    "pairs",
    "family-feud",
    "hot-and-cold",
    "centre",
    "same-brain",
    "twin",
    "imposter",
    "mafia",
    "draw-country",
    "spelling-bee",
    "heads-up",
    "icebreaker",
  ]) {
    await page.goto(`/things/${game}`);
    await waitForAppHydration(page);
    const menu = page.getByRole("button", { name: "menu", exact: true });
    await expect(menu, game).toHaveCount(1);
    await menu.focus();
    await page.keyboard.press("Enter");
    const navigation = page.getByRole("navigation", { name: "Game menu", exact: true });
    await expect(navigation.getByRole("link", { name: "all games", exact: true })).toBeVisible();
    await expect(navigation.getByRole("link", { name: "home", exact: true })).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      game,
    ).toBe(true);
    await page.keyboard.press("Escape");
    await expect(menu).toBeFocused();
    await expect(navigation).toBeHidden();
  }
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page
    .getByRole("navigation", { name: "Game menu" })
    .getByRole("link", { name: "home", exact: true })
    .click();
  await expect(page).toHaveURL(/\/$/);
});

test("Imposter lobby shows its invite QR by default and keeps help after the start action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/things/imposter");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "play together", exact: true }).click();
  const lobby = page.getByRole("region", { name: "Room lobby", exact: true });
  await expect(lobby.getByRole("img", { name: /QR code to join room/ })).toBeVisible();
  const roster = lobby.getByRole("list", { name: "Players in the room" });
  await expect(roster).not.toContainText(/guest [a-f0-9]{4}/i);
  await expect(roster).toContainText("you · host");
  await expect(lobby.getByRole("button", { name: "how it works", exact: true })).toBeVisible();
  expect(
    await lobby.locator("button:disabled").evaluate((button) => {
      const help = Array.from(button.closest("section")?.querySelectorAll("summary") ?? []).find(
        (summary) => summary.textContent?.trim() === "how it works",
      );
      return Boolean(
        help && button.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
      );
    }),
  ).toBe(true);
  await page.getByRole("button", { name: "menu", exact: true }).click();
  await page.getByRole("button", { name: "leave room", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "leave room", exact: true }).click();
  await expect(page).toHaveURL(/\/things\/imposter$/);
});

test("Mafia presenter invites players and labels readiness without a cramped header", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/things/mafia");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "play together", exact: true }).click();
  const screen = await Promise.all([
    page.waitForEvent("popup"),
    page.getByRole("link", { name: "big screen ↗", exact: true }).click(),
  ]).then(([popup]) => popup);
  await screen.setViewportSize({ width: 375, height: 812 });
  await expect(
    screen.getByRole("heading", { name: "Get everyone in.", exact: true }),
  ).toBeVisible();
  await expect(screen.getByRole("img", { name: /QR code to join room/ })).toBeVisible();
  await expect(screen.getByRole("list", { name: "Players in the room" })).toContainText(
    "host · ready",
  );
  const header = screen.locator(".game-frame-header");
  await expect(header).not.toContainText(/mafia|waiting|alive/i);
  expect(await screen.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
    true,
  );
  await screen.getByRole("link", { name: "← room", exact: true }).click();
  await expect(screen.getByRole("region", { name: "Room lobby", exact: true })).toBeVisible();
  await screen.close();
});
