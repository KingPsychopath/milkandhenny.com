import { expect, test } from "@playwright/test";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 390, height: 844 },
});

test("keeps rapid daily guessing stable in the native document flow", async ({ page }) => {
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
    const guessButton = page.getByRole("button", { name: "guess", exact: true });
    const composer = page.locator(".heat-composer");
    const ledger = page.locator(".heat-ledger");
    await expect(input).toBeVisible();
    await expect(composer).toHaveCSS("position", "relative");
    await expect(guessButton).toBeEnabled();
    await expect
      .poll(() =>
        page.evaluate(() => {
          const form = document.querySelector(".heat-composer");
          const list = document.querySelector(".heat-ledger, .heat-ledger-empty");
          return Boolean(
            form && list && form.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
          );
        }),
      )
      .toBe(true);
    await expect
      .poll(() =>
        page
          .locator('meta[name="viewport"]')
          .getAttribute("content")
          .then((content) => content?.includes("interactive-widget=resizes-content")),
      )
      .toBe(true);

    await input.fill("table");
    await input.press("Enter");
    await page.evaluate(() => {
      const field = document.querySelector<HTMLInputElement>("#hot-and-cold-guess");
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      if (!field || !valueSetter) throw new Error("Guess input unavailable");
      valueSetter.call(field, " ");
      field.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: " ", inputType: "insertText" }),
      );
    });
    await expect(input).toHaveValue("");
    await expect.poll(() => firstScoreRequestSeen).toBe(true);
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>("#hot-and-cold-guess")?.blur();
    });
    await expect(input).toBeFocused();
    await expect(input).toHaveValue("");
    await expect(input).toBeEditable();
    await expect(input).not.toHaveAttribute("readonly", "");
    await expect(guessButton).toHaveText("guess");
    await expect(guessButton).toBeEnabled();
    const status = page.locator("#hot-and-cold-guess-message");
    await expect(status).toHaveText("lower is hotter");
    await expect(status).not.toHaveAttribute("data-receipt", "");
    await expect(status).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(status).toHaveCSS("box-shadow", "none");

    await input.fill("music");
    await input.press("Enter");
    await expect(input).toHaveValue("");
    await expect(guessButton).toHaveText("guess");
    await expect(guessButton).toBeEnabled();

    releaseFirstScore();
    await expect(page.getByText("table", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("music", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(input).toBeEditable();
    await expect(input).toBeFocused();
    await expect(input).not.toHaveAttribute("readonly", "");
    const receipt = page.locator(".heat-guess-receipt");
    await expect(receipt).toContainText(/table · #[\d,]+/);
    await expect(receipt).toContainText("hottest");
    await expect(receipt).toHaveCSS("position", "static");
    await expect(status).toHaveAttribute("data-receipt", "");
    await expect(status).toContainText(/table · #[\d,]+/);
    await expect(receipt).toContainText(/music · #[\d,]+/, { timeout: 5_000 });
    await expect(receipt).toHaveCount(0, { timeout: 5_000 });
    await expect(status).toHaveText("lower is hotter");
    await expect(status).not.toHaveAttribute("data-receipt", "");

    await input.fill("table");
    await input.press("Enter");
    await expect(page.locator("#hot-and-cold-guess-message")).toContainText(
      /already guessed · #[\d,]+/,
    );
    await expect(input).toHaveValue("table");
    await expect
      .poll(() =>
        input.evaluate((field) => {
          const textInput = field as HTMLInputElement;
          return [textInput.selectionStart, textInput.selectionEnd];
        }),
      )
      .toEqual([0, 5]);
    await input.press("Backspace");
    await expect(input).toHaveValue("");
    await input.fill("chair");
    await expect(page.locator("#hot-and-cold-guess-message")).toHaveText("lower is hotter");
    await input.fill("");

    const hintButton = page.getByRole("button", { name: "hint", exact: true });
    const giveUpButton = page.getByRole("button", { name: "give up", exact: true });
    await expect(giveUpButton).toHaveCount(0);
    await expect(hintButton).toHaveCSS("width", "80px");
    await expect(hintButton).toHaveCSS("border-top-style", "none");
    await expect(hintButton).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await expect(hintButton).toHaveCSS("box-shadow", "none");
    for (let hint = 0; hint < 3; hint += 1) {
      await hintButton.click();
      await expect(receipt).toContainText(/hint · .+ · #[\d,]+/, { timeout: 30_000 });
      await expect(page.locator("#hot-and-cold-guess-message")).toContainText(
        /hint · .+ · #[\d,]+/,
      );
      await expect(receipt).toHaveCount(0, { timeout: 5_000 });
    }
    await expect(page.locator("#hot-and-cold-guess-message")).toHaveText("lower is hotter");
    await expect(hintButton).toHaveCount(0);
    await expect(giveUpButton).toBeVisible();
    await expect(giveUpButton).toHaveCSS("width", "80px");
    await giveUpButton.click();
    await expect(page.getByRole("dialog", { name: "Reveal this word?" })).toBeVisible();
    await page.getByRole("button", { name: "keep playing", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Reveal this word?" })).toHaveCount(0);

    await page.evaluate(() => {
      if (!window.visualViewport) throw new Error("Visual Viewport API unavailable");
      Object.defineProperties(window.visualViewport, {
        height: { configurable: true, value: 420 },
        offsetTop: { configurable: true, value: 424 },
      });
      window.visualViewport.dispatchEvent(new Event("resize"));
    });
    const game = page.locator(".hot-and-cold").first();
    await expect(game).not.toHaveAttribute("data-mobile-keyboard", "");
    await expect(game).not.toHaveAttribute("style", /mobile-keyboard/);
    await expect(page.locator(".heat-source-hottest-word")).toBeVisible();
    await expect(ledger).toBeVisible();

    await expect(page.getByRole("button", { name: "Hide keyboard" })).toHaveCount(0);
    await input.click();
    await expect(input).toBeFocused();
    await page.locator(".heat-source").click();
    await expect(input).not.toBeFocused();
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
