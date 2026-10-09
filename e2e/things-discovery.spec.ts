import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("a delayed race creation cannot reopen Pairs after leaving setup", async ({ page }) => {
  await page.goto("/things/pairs");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "race a friend two devices · rounds" }).click();
  await page.getByLabel("your name", { exact: true }).fill("Delayed QA");
  let resume: (() => void) | undefined;
  let responseReady: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const ready = new Promise<void>((resolve) => {
    responseReady = resolve;
  });
  await page.route("**/_serverFn/**", async (route) => {
    if (route.request().method() !== "POST") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    responseReady?.();
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.getByRole("button", { name: "create a race" }).click();
    await ready;
    await page.getByRole("link", { name: "← things", exact: true }).click();
    await expect(page.getByRole("heading", { name: "things+", exact: true })).toBeVisible();
    resume?.();
    // The stored receipt proves the delayed callback finished, including its navigation attempt.
    await expect
      .poll(() =>
        page.evaluate(() =>
          Object.keys(localStorage).some((key) => key.startsWith("things:pairs:race:")),
        ),
      )
      .toBe(true);
    await expect(page).toHaveURL(/\/things$/);
  } finally {
    resume?.();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("missing-access and shared-screen states retain a visible exit", async ({ page }) => {
  test.setTimeout(90_000);
  for (const path of [
    "/things/family-feud/ABCDEFG/control",
    "/things/family-feud/ABCDEFG/buzzer",
    "/things/family-feud/ABCDEFG/present",
    "/things/spelling-party/ABCDEFG",
    "/things/spelling-party/ABCDEFG/present",
    "/things/liars/ABCDEFG/present",
    "/things/judge/ABCDEFG",
    "/things/pitches/present/ABCDEFG",
    "/things/pitches/remote/ABCDEFG",
    "/things/pairs/race/ABCDEFG",
    "/play/expired-invite",
  ]) {
    await page.goto(path);
    await waitForAppHydration(page);
    await expect(
      page.locator('a[href="/things"], a[href^="/things/"]').filter({ visible: true }).first(),
      path,
    ).toBeVisible();
  }
});

test("Things groups games and tools, combines filters and search, and remembers frequent visits", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/things");
  await waitForAppHydration(page);
  const games = page.getByRole("region", { name: "games", exact: true });
  const tools = page.getByRole("region", { name: "tools", exact: true });
  await expect(games).toBeVisible();
  await expect(tools).toBeVisible();
  await expect(games.getByRole("link").first()).toContainText("pairs");
  await expect(games.getByRole("link").first()).toContainText("1–6 players");
  await page.getByRole("button", { name: "Filter things", exact: true }).click();
  await page.getByRole("option", { name: "tools", exact: true }).click();
  await expect(games).toHaveCount(0);
  await expect(tools.getByRole("link")).toHaveCount(2);
  await page.getByRole("searchbox", { name: "Search things" }).fill("slides");
  await expect(tools.getByRole("link")).toHaveCount(1);
  await expect(tools.getByRole("link")).toContainText("pitch night");
  await page.getByRole("searchbox", { name: "Search things" }).fill("nothing-matches");
  await expect(page.getByText("No matches.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "show everything", exact: true }).click();
  await expect(games).toBeVisible();
  await games.getByRole("link").filter({ hasText: "twin" }).click();
  await expect(page).toHaveURL(/\/things\/twin$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/things$/);
  await expect(games.getByRole("link").first()).toContainText("twin");
  await page.reload();
  await waitForAppHydration(page);
  await expect(games.getByRole("link").first()).toContainText("twin");
  await page.getByRole("button", { name: "Sort things", exact: true }).click();
  await page.getByRole("option", { name: "a–z", exact: true }).click();
  await expect(games.getByRole("link").first()).toContainText("centre");
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
});

test("Pairs explains each win condition and one Back returns to setup after repeated refreshes", async ({
  page,
}) => {
  await page.goto("/things");
  await waitForAppHydration(page);
  await page.getByRole("link").filter({ hasText: "pairs" }).click();
  await expect(page.getByText(/clear every pair in as few tries/)).toBeVisible();
  await page.getByRole("button", { name: "with friends one device" }).click();
  await expect(page.getByText(/Collect the most pairs to win/)).toBeVisible();
  await page.getByRole("button", { name: "race a friend two devices · rounds" }).click();
  await expect(page.getByText(/Win two rounds to take the match/)).toBeVisible();
  await page.getByRole("button", { name: "just me solo" }).click();
  await page.getByRole("button", { name: "deal me in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Find the pairs." })).toBeVisible();
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.reload();
    await waitForAppHydration(page);
    await page.getByRole("button", { name: "resume saved table", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Find the pairs." })).toBeVisible();
  }
  await page.goBack();
  await expect(page.getByRole("button", { name: "deal me in", exact: true })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL(/\/things$/);
});
