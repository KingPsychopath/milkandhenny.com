import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";
import { createPairsGame } from "../features/things/pairs/pairs-rules";
import type { PairsRecord } from "../features/things/pairs/pairs-rules";

const record: PairsRecord = {
  version: 1,
  seed: 404,
  pairCount: 3,
  names: ["Alex", "Jo"],
  actions: [],
};
const deal = createPairsGame(record.seed, record.pairCount, record.names);
const first = 0;
const partner = deal.cards.findIndex(
  (card, index) => index !== first && card.rank === deal.cards[first].rank,
);
const miss = deal.cards.findIndex((card) => card.rank !== deal.cards[first].rank);

test("Pairs supports communal turns, undo, refresh recovery, a finish and a rematch", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript((value) => {
    if (!sessionStorage.getItem("things:pairs:table:v1"))
      sessionStorage.setItem(
        "things:pairs:table:v1",
        JSON.stringify({ expiresAt: Date.now() + 600_000, record: value }),
      );
  }, record);
  await page.goto("/things/pairs");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "resume saved table" }).click();
  await expect(page.getByRole("heading", { name: "Alex’s turn." })).toBeVisible();
  await expect(page.locator(".pairs-face--front .pairs-pip")).toHaveCount(0);
  await page.getByRole("button", { name: `Card ${first + 1}: face down`, exact: true }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("button", { name: `Card ${miss + 1}: face down`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "Close. Keep it in mind." })).toBeVisible();
  // Multiplayer never auto-passes the social reveal, even with reduced motion.
  await expect(page.getByRole("button", { name: "next: Jo" })).toBeVisible();
  await page.getByRole("button", { name: "next: Jo" }).click();
  await expect(page.getByRole("heading", { name: "Jo’s turn." })).toBeVisible();
  await page.getByRole("button", { name: "undo last turn" }).click();
  await expect(page.getByRole("heading", { name: "Alex’s turn." })).toBeVisible();
  await page.getByRole("button", { name: `Card ${first + 1}: face down`, exact: true }).click();
  await page.getByRole("button", { name: `Card ${partner + 1}: face down`, exact: true }).click();
  await expect(page.getByRole("heading", { name: "A pair. All yours." })).toBeVisible();
  await page.reload();
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "resume saved table" }).click();
  await expect(page.getByRole("heading", { name: "A pair. All yours." })).toBeVisible();
  await expect(page.locator(".pairs-scores li").first()).toContainText("1pair");
  await page.getByRole("button", { name: "Alex, go again" }).click();
  const cleared = new Set([first, partner]);
  for (let pair = 1; pair < 3; pair++) {
    const a = deal.cards.findIndex((_, index) => !cleared.has(index));
    const b = deal.cards.findIndex(
      (card, index) => index !== a && card.rank === deal.cards[a].rank,
    );
    await page.getByRole("button", { name: `Card ${a + 1}: face down`, exact: true }).click();
    await page.getByRole("button", { name: `Card ${b + 1}: face down`, exact: true }).click();
    cleared.add(a);
    cleared.add(b);
    await page
      .getByRole("button", { name: pair === 2 ? "see the result" : "Alex, go again" })
      .click();
  }
  await expect(page.getByRole("heading", { name: "Alex takes the table." })).toBeVisible();
  await page.getByRole("button", { name: "shuffle & play again" }).click();
  await expect(page.getByRole("heading", { name: "Alex’s turn." })).toBeVisible();
  await expect(page.getByRole("button", { name: /face down/ })).toHaveCount(6);
});

test("Pairs solo works on a narrow screen with keyboard play and blocked storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    const random = crypto.getRandomValues.bind(crypto);
    crypto.getRandomValues = (array) => {
      if (array instanceof Uint32Array && array.length === 1) {
        array[0] = 404;
        return array;
      }
      return random(array);
    };
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "QuotaExceededError");
    };
  });
  await page.goto("/things/pairs");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "3 a quick hand" }).click();
  await page.getByRole("button", { name: "deal me in" }).click();
  await expect(page.getByRole("heading", { name: "Find the pairs." })).toBeVisible();
  await expect(
    page.getByText("This browser can’t save the table.", { exact: false }),
  ).toBeVisible();
  for (const rank of new Set(deal.cards.map((card) => card.rank))) {
    for (const [index, card] of deal.cards.entries()) {
      if (card.rank !== rank) continue;
      await page.getByRole("button", { name: `Card ${index + 1}: face down`, exact: true }).focus();
      await page.keyboard.press("Space");
    }
    await expect(page.locator(".pairs-card--shown")).toHaveCount(0, { timeout: 5000 });
  }
  await expect(page.getByRole("heading", { name: "A clean sweep." })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.goBack();
  await expect(page.getByRole("button", { name: "deal me in" })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("button", { name: "deal me in" })).toBeVisible();
});

test("Pairs multiplayer setup names players and catches duplicate names", async ({ page }) => {
  await page.goto("/things/pairs");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "with friends one device" }).click();
  await page.getByLabel("player 1", { exact: true }).fill("Alex");
  await page.getByLabel("player 2", { exact: true }).fill("alex");
  await page.getByRole("button", { name: "deal us in" }).click();
  await expect(page.getByRole("alert")).toContainText("different name");
  await page.getByLabel("player 2", { exact: true }).fill("Jo");
  await page.getByRole("button", { name: "deal us in" }).click();
  await expect(page.getByRole("heading", { name: "Alex’s turn." })).toBeVisible();
  await expect(page.getByRole("button", { name: /face down/ })).toHaveCount(12);
});
