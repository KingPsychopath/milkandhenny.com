import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("one-phone Imposter keeps handoffs private with keyboard controls and blocked storage", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.addInitScript(() => {
    Storage.prototype.setItem = () => {
      throw new DOMException("Blocked", "QuotaExceededError");
    };
  });
  await page.goto("/things/imposter/phone");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "deal", exact: true }).focus();
  await page.keyboard.press("Enter");
  for (let seat = 0; seat < 6; seat++) {
    const card = page.getByRole("button", { name: "Hold to reveal your role", exact: true });
    await expect(card).toContainText("hold to reveal");
    await expect(
      page.getByRole("heading", { name: `player ${seat + 1}`, exact: true }),
    ).toBeVisible();
    await card.focus();
    await page.keyboard.down("Space");
    await expect(card).toContainText("the category is");
    await expect(page.getByRole("button", { name: "menu", exact: true })).toBeHidden();
    if (await card.getByText("the word is", { exact: true }).count()) {
      await expect(card.locator(".imposter-role-shortlist")).toHaveCount(0);
      await expect(card).toContainText("Give a clue. Keep this word secret.");
    }
    await page.waitForTimeout(650);
    await page.keyboard.up("Space");
    await expect(page.getByRole("button", { name: "menu", exact: true })).toBeVisible();
  }
  await expect(
    page.getByRole("heading", { name: "Put the phone down", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "show me who was who", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Here is who was lying", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "deal again", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Hold to reveal your role", exact: true }),
  ).toContainText("hold to reveal");
});

test("one-phone handoff ignores quick taps and cancelled holds, then advances on release", async ({
  page,
}) => {
  await page.goto("/things/imposter/phone");
  await waitForAppHydration(page);
  await page.getByRole("button", { name: "deal", exact: true }).click();
  const card = page.getByRole("button", { name: "Hold to reveal your role", exact: true });
  const firstPlayer = page.getByRole("heading", { name: "player 1", exact: true });
  await card.click();
  await expect(firstPlayer).toBeVisible();
  await expect(card).toContainText("hold to reveal");
  await card.focus();
  await page.keyboard.down("Enter");
  await expect(page.getByText("the category is", { exact: true })).toHaveCount(0);
  await page.keyboard.up("Enter");
  await expect(firstPlayer).toBeVisible();
  await page.keyboard.down("Enter");
  await expect(card).toContainText("the category is");
  await page.waitForTimeout(650);
  await card.blur();
  await page.keyboard.up("Enter");
  await expect(firstPlayer).toBeVisible();
  await expect(card).toContainText("hold to reveal");
  const box = await card.boundingBox();
  if (!box) throw new Error("Missing role card");
  await page.mouse.move(box.x + box.width / 2, box.y + 20);
  await page.mouse.down();
  await expect(card).toContainText("the category is");
  await page.waitForTimeout(650);
  await card.dispatchEvent("pointercancel");
  await page.mouse.up();
  await expect(firstPlayer).toBeVisible();
  await expect(card).toContainText("hold to reveal");
  await page.mouse.down();
  await expect(card).toContainText("the category is");
  await page.waitForTimeout(650);
  await page.mouse.up();
  await expect(page.getByRole("heading", { name: "player 2", exact: true })).toBeVisible();
  await expect(card).toContainText("hold to reveal");
  await expect(page.getByText("the category is", { exact: true })).toHaveCount(0);
});
