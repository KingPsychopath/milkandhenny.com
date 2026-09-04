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
      page.getByRole("button", { name: "hold the card first", exact: true }),
    ).toBeDisabled();
    await card.focus();
    await page.keyboard.down("Space");
    await expect(card).toContainText("the category is");
    await page.keyboard.up("Space");
    await expect(card).toContainText("hold to reveal");
    await page.getByRole("button", { name: "got it — pass it on", exact: true }).focus();
    await page.keyboard.press("Enter");
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
