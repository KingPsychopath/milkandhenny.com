import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

for (const reducedMotion of [false, true]) {
  test(`account pull stays raised and returns to the source page${reducedMotion ? " with reduced motion" : ""}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    await page.goto("/things");
    await waitForAppHydration(page);
    const account = page.getByRole("link", { name: "account", exact: true });
    const theme = page.getByRole("button", { name: /Switch to .* mode/ });
    const a = await account.boundingBox();
    const b = await theme.boundingBox();
    expect(a!.width).toBeGreaterThanOrEqual(44);
    expect(b!.x - (a!.x + a!.width)).toBeGreaterThanOrEqual(8);
    await account.click();
    await expect(page).toHaveURL(/\/(my|access)(?:[/?#]|$)/);
    const close = page.getByRole("link", { name: "back to site", exact: true });
    await expect(close).toBeVisible();
    await expect
      .poll(() =>
        close.locator(".lamp-cord").evaluate((element) => element.getBoundingClientRect().height),
      )
      .toBeLessThanOrEqual(36);
    await close.click();
    await expect(page).toHaveURL(/\/things$/);
    await expect(account).toBeVisible();
  });
}
