import { expect, test } from "@playwright/test";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test("keeps the keyboard flow open while daily guesses score", async ({ page }) => {
  let firstScoreRequestSeen = false;
  let releaseFirstScore: () => void = () => undefined;
  const firstScoreGate = new Promise<void>((resolve) => {
    releaseFirstScore = resolve;
  });

  await page.route("**/*", async (route) => {
    const request = route.request();
    const isScoreRequest =
      request.method() === "POST" &&
      request.url().includes("/_serverFn/") &&
      request.postData()?.includes('"word"');
    if (!isScoreRequest || firstScoreRequestSeen) {
      await route.continue();
      return;
    }
    firstScoreRequestSeen = true;
    await firstScoreGate;
    await route.continue();
  });

  try {
    await page.goto("/things/hot-and-cold/daily");
    await page.waitForLoadState("networkidle");
    const input = page.getByRole("textbox", { name: "Guess a word" });
    await expect(input).toBeVisible();
    const initialScrollY = await page.evaluate(() => window.scrollY);

    await input.fill("table");
    await input.press("Enter");
    await expect.poll(() => firstScoreRequestSeen).toBe(true);
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>("#hot-and-cold-guess")?.blur();
    });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expect(input).toBeEditable();
    await expect(input).not.toHaveAttribute("readonly", "");

    await input.fill("music");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(page.getByText("2 guesses queued", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "2 queued" })).toBeDisabled();

    releaseFirstScore();
    await expect(page.getByText("table", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("music", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();
    await expect(input).not.toHaveAttribute("readonly", "");
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);
    await expect(page.locator(".heat-ledger-update")).toHaveCount(0);
    await expect(page.locator("#hot-and-cold-guess-message")).not.toContainText("#");
    await expect(page.locator("#hot-and-cold-guess-message")).not.toContainText(/table|music/i);

    await page.evaluate(() => {
      if (!window.visualViewport) throw new Error("Visual Viewport API unavailable");
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 420 },
        offsetTop: { configurable: true, value: 424 },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    const game = page.locator(".hot-and-cold").first();
    await expect(game).toHaveAttribute("data-heat-keyboard", "");
    const keyboardStatus = page.locator(".heat-source");
    const hottestGuess = page.locator(".heat-ledger > li").first();
    await expect(page.locator(".heat-source-keyboard-summary")).toBeVisible();
    await expect
      .poll(async () => Math.round((await keyboardStatus.boundingBox())?.y ?? 0))
      .toBeGreaterThanOrEqual(420);
    await expect
      .poll(async () => {
        const status = await keyboardStatus.boundingBox();
        const hottest = await hottestGuess.boundingBox();
        if (!status || !hottest) return Number.POSITIVE_INFINITY;
        return Math.round(Math.abs(hottest.y - (status.y + status.height)));
      })
      .toBeLessThanOrEqual(3);
    await expect(game).toHaveCSS("--heat-visual-bottom", "0px");
    await page.waitForTimeout(150);

    const alignedScrollY = await page.evaluate(() => window.scrollY);
    await page.evaluate(() => {
      // Two guesses alone are not tall enough to prove that the player can keep scrolling.
      const ledger = document.querySelector<HTMLElement>(".heat-ledger");
      if (ledger) {
        ledger.style.paddingBottom = "40rem";
        ledger.getBoundingClientRect();
      }
      window.scrollBy({ top: 120, behavior: "auto" });
      window.visualViewport?.dispatchEvent(new Event("scroll"));
    });
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(alignedScrollY + 80);
    await page.waitForTimeout(150);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(alignedScrollY + 80);

    const hideKeyboard = page.getByRole("button", { name: "Hide keyboard" });
    await expect(hideKeyboard).toBeVisible();
    await expect(page.locator(".heat-composer")).toHaveCSS("background-image", "none");
    const composerBounds = await page.locator(".heat-composer-inner").boundingBox();
    const controlBounds = await page.locator(".heat-composer-controls").boundingBox();
    expect(composerBounds).not.toBeNull();
    expect(controlBounds).not.toBeNull();
    expect((controlBounds?.x ?? 0) + (controlBounds?.width ?? 0)).toBeLessThanOrEqual(
      (composerBounds?.x ?? 0) + (composerBounds?.width ?? 0) + 1,
    );
    await hideKeyboard.click();
    await expect(input).not.toBeFocused();
    await expect(game).not.toHaveAttribute("data-heat-keyboard", "");
    await page.evaluate(() => {
      if (!window.visualViewport) throw new Error("Visual Viewport API unavailable");
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 844 },
        offsetTop: { configurable: true, value: 0 },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(initialScrollY);

    await page.evaluate(() => window.scrollTo({ top: 160, behavior: "auto" }));
    const readingScrollY = await page.evaluate(() => window.scrollY);
    expect(readingScrollY).toBeGreaterThan(100);
    await input.click();
    await page.evaluate(() => {
      if (!window.visualViewport) throw new Error("Visual Viewport API unavailable");
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 420 },
        offsetTop: { configurable: true, value: 0 },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect(game).toHaveAttribute("data-heat-keyboard", "");
    await expect(game).toHaveCSS("--heat-visual-bottom", "424px");
    await expect
      .poll(async () => {
        const bounds = await page.locator(".heat-composer").boundingBox();
        return Math.round((bounds?.y ?? Number.POSITIVE_INFINITY) + (bounds?.height ?? 0));
      })
      .toBeLessThanOrEqual(420);
    await expect
      .poll(async () => {
        const status = await keyboardStatus.boundingBox();
        const hottest = await hottestGuess.boundingBox();
        if (!status || !hottest) return Number.POSITIVE_INFINITY;
        return Math.round(Math.abs(hottest.y - (status.y + status.height)));
      })
      .toBeLessThanOrEqual(3);

    await hideKeyboard.click();
    await page.evaluate(() => {
      if (!window.visualViewport) throw new Error("Visual Viewport API unavailable");
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 844 },
        offsetTop: { configurable: true, value: 0 },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(readingScrollY);
  } finally {
    releaseFirstScore();
  }
});

test("submits a room name from the mobile keyboard", async ({ page }) => {
  await page.goto("/things/hot-and-cold/QWERTY2");
  const input = page.getByRole("textbox", { name: "your name" });
  await expect(input).toBeVisible();

  await input.fill("Keyboard guest");
  await input.press("Enter");

  await expect(page.getByRole("alert")).toHaveText("That room is no longer available");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("Keyboard guest two");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
});
