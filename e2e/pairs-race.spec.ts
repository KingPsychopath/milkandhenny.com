import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

async function clearTable(page: Page) {
  const known = new Map<string, number[]>();
  const cleared = new Set<number>();
  async function flip(index: number) {
    const card = page.getByRole("button", { name: `Card ${index + 1}: face down`, exact: true });
    await expect(card).toBeEnabled({ timeout: 10_000 });
    await card.click();
    const face = page.locator(".pairs-slot").nth(index).locator(".pairs-corner b").first();
    await expect(face).toBeAttached();
    const rank = (await face.textContent())!;
    if (!known.get(rank)?.includes(index)) known.set(rank, [...(known.get(rank) ?? []), index]);
    return rank;
  }
  // Learn every position through the rendered faces. No seed or server state is used.
  for (let index = 0; index < 6; index += 2) {
    const a = await flip(index);
    const b = await flip(index + 1);
    if (a === b) {
      cleared.add(index);
      cleared.add(index + 1);
    }
    if (cleared.size !== 6)
      await expect(page.getByRole("button", { name: /face down/ }).first()).toBeEnabled({
        timeout: 10_000,
      });
  }
  for (const indices of known.values()) {
    if (cleared.has(indices[0])) continue;
    await flip(indices[0]);
    // The final face may disappear into the result immediately after acceptance.
    const card = page.getByRole("button", {
      name: `Card ${indices[1] + 1}: face down`,
      exact: true,
    });
    await expect(card).toBeEnabled({ timeout: 10_000 });
    await card.click();
    cleared.add(indices[0]);
    cleared.add(indices[1]);
    if (cleared.size !== 6)
      await expect(page.getByRole("button", { name: /face down/ }).first()).toBeEnabled({
        timeout: 10_000,
      });
  }
}

test("Pairs races isolated phones through two rounds, private flips, refresh and a rematch", async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const surfaces = await Promise.all(
    ["Alex", "Jo"].map((role) =>
      openIsolatedGameSurface({
        browser,
        baseURL: String(testInfo.project.use.baseURL),
        role,
        contextOptions: {
          viewport: { width: 390, height: 844 },
          reducedMotion: "reduce",
          serviceWorkers: "block",
        },
      }),
    ),
  );
  const [host, guest] = surfaces;
  try {
    await host.page.goto("/things/pairs");
    await waitForAppHydration(host.page);
    await host.page.getByRole("button", { name: "3 a quick hand" }).click();
    await host.page.getByRole("button", { name: "race a friend two devices · rounds" }).click();
    await host.page.getByLabel("your name").fill("Alex");
    await host.page.getByRole("button", { name: "create a race" }).click();
    await expect(host.page.getByRole("heading", { name: "Save the other seat." })).toBeVisible();
    await guest.page.goto(host.page.url());
    await waitForAppHydration(guest.page);
    await guest.page.getByLabel("your name").fill("Jo");
    await guest.page.getByRole("button", { name: "take the other seat" }).click();
    for (const surface of surfaces)
      await expect(
        surface.page.getByRole("heading", { name: "Two seats. One winner." }),
      ).toBeVisible();
    for (let round = 1; round <= 2; round++) {
      for (const surface of surfaces)
        await surface.page.getByRole("button", { name: "I’m ready", exact: true }).click();
      await host.page
        .getByRole("button", {
          name: round === 1 ? "start the race" : "deal next round",
          exact: true,
        })
        .click();
      for (const surface of surfaces)
        await expect(
          surface.page.getByRole("heading", { name: "Clear your table first." }),
        ).toBeVisible({ timeout: 10_000 });
      await expect(guest.page.locator(".pairs-pip")).toHaveCount(0);
      if (round === 1) {
        await guest.page.reload();
        await waitForAppHydration(guest.page);
        await expect(
          guest.page.getByRole("heading", { name: "Clear your table first." }),
        ).toBeVisible();
      }
      await clearTable(host.page);
      for (const surface of surfaces)
        await expect(
          surface.page.getByRole("heading", {
            name: round === 1 ? "Alex takes round 1." : "Alex takes the match.",
            exact: true,
          }),
        ).toBeVisible({ timeout: 10_000 });
      await expect(guest.page.locator(".pairs-pip")).toHaveCount(0);
    }
    for (const surface of surfaces)
      await surface.page.getByRole("button", { name: "ready for a rematch" }).click();
    await host.page.getByRole("button", { name: "deal a rematch" }).click();
    for (const surface of surfaces)
      await expect(
        surface.page.getByRole("heading", { name: "Clear your table first." }),
      ).toBeVisible({ timeout: 10_000 });
    await expect(host.page.locator(".pairs-scores li").first()).toContainText("0");
    await expect
      .poll(() => host.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      .toBe(true);
    await host.page.getByRole("button", { name: "concede match", exact: true }).click();
    await host.page.getByRole("button", { name: "concede this match", exact: true }).click();
    await expect(guest.page.getByRole("heading", { name: "Jo takes the match." })).toBeVisible();
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
