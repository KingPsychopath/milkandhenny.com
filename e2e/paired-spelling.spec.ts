import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

test("a silent Spelling Bee round survives a judge refresh and reaches matching results", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const surfaces = await Promise.all(
    ["Player", "Judge"].map((role) =>
      openIsolatedGameSurface({
        browser,
        baseURL: String(testInfo.project.use.baseURL),
        role,
        contextOptions: { ...devices["Pixel 7"], reducedMotion: "reduce", serviceWorkers: "block" },
      }),
    ),
  );
  const [player, judge] = surfaces;
  // This journey deliberately models a device with no native speech engine or motion controls.
  await player.context.addInitScript(() => {
    Object.defineProperty(window, "speechSynthesis", {
      configurable: true,
      value: {
        getVoices: () => [],
        addEventListener: () => {},
        removeEventListener: () => {},
        cancel: () => {},
      },
    });
    localStorage.setItem(
      "things:spelling-bee:v1:preferences",
      JSON.stringify({
        tiltEnabled: false,
        positionLock: false,
        voiceURI: "",
        timerSeconds: 0,
        roundTotal: 5,
        autoSpeak: false,
        soundEnabled: false,
      }),
    );
  });
  try {
    await player.page.goto("/things/spelling-bee");
    await waitForAppHydration(player.page);
    await player.page.getByRole("button", { name: "play together", exact: true }).click();
    const invite = player.page.getByRole("link", { name: "open judge view", exact: true });
    await expect(invite).toHaveAttribute("href", /\/things\/judge\//);
    await judge.page.goto((await invite.getAttribute("href"))!);
    await waitForAppHydration(judge.page);
    await expect(player.page.getByText("● judge connected", { exact: true })).toBeVisible();
    await player.page.getByRole("button", { name: "start", exact: true }).click();
    for (let index = 0; index < 5; index++) {
      const markCorrect = judge.page.getByRole("button", { name: "correct", exact: true });
      await expect(markCorrect).toBeEnabled({ timeout: 15_000 });
      if (index === 1) {
        await judge.page.reload();
        await waitForAppHydration(judge.page);
        await judge.page.getByRole("button", { name: "take over controls", exact: true }).click();
        await expect(markCorrect).toBeEnabled({ timeout: 15_000 });
      }
      const current = await judge.page.locator("#current-item").innerText();
      await markCorrect.click();
      await expect(judge.page.locator("#current-item")).not.toHaveText(current, {
        timeout: 15_000,
      });
      if (index === 0) {
        await judge.page.getByRole("button", { name: "undo last", exact: true }).click();
        await expect(judge.page.locator("#current-item")).toHaveText(current);
        await expect(markCorrect).toBeEnabled();
        await markCorrect.click();
        await expect(judge.page.locator("#current-item")).not.toHaveText(current);
      }
    }
    await expect(
      player.page.getByRole("button", { name: "another round", exact: true }),
    ).toBeVisible();
    await expect(player.page.getByRole("heading", { name: "5", exact: true })).toBeVisible();
    await expect(
      judge.page.getByRole("heading", { name: "Round complete", exact: true }),
    ).toBeVisible();
  } finally {
    await closeGameSurfaces(surfaces);
  }
});

test("Heads Up supports silent judging, undo, a complete timed round and rematch", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const surfaces = await Promise.all(
    ["Player", "Judge"].map((role) =>
      openIsolatedGameSurface({
        browser,
        baseURL: String(testInfo.project.use.baseURL),
        role,
        contextOptions: { ...devices["Pixel 7"], reducedMotion: "reduce", serviceWorkers: "block" },
      }),
    ),
  );
  const [player, judge] = surfaces;
  await player.context.addInitScript(() => {
    localStorage.setItem("things:heads-up:v1:preferences", JSON.stringify({ soundEnabled: false }));
  });
  try {
    await player.page.goto("/things/heads-up");
    await waitForAppHydration(player.page);
    await player.page.getByRole("button", { name: "play together", exact: true }).click();
    const invite = player.page.getByRole("link", { name: "open judge view", exact: true });
    await expect(invite).toHaveAttribute("href", /\/things\/judge\//);
    await judge.page.goto((await invite.getAttribute("href"))!);
    await waitForAppHydration(judge.page);
    await expect(player.page.getByText("● judge connected", { exact: true })).toBeVisible();
    await player.page.getByRole("button", { name: "start", exact: true }).click();
    const correct = judge.page.getByRole("button", { name: "correct", exact: true });
    await expect(correct).toBeEnabled({ timeout: 15_000 });
    const first = await judge.page.locator("#current-item").innerText();
    await correct.click();
    await expect(judge.page.locator("#current-item")).not.toHaveText(first);
    await judge.page.getByRole("button", { name: "undo last", exact: true }).click();
    await expect(judge.page.locator("#current-item")).toHaveText(first);
    await expect(correct).toBeEnabled();
    await correct.click();
    await expect(judge.page.locator("#current-item")).not.toHaveText(first);
    await expect(player.page.getByRole("button", { name: "play again", exact: true })).toBeVisible({
      timeout: 80_000,
    });
    await expect(player.page.getByRole("heading", { name: "1", exact: true })).toBeVisible();
    await expect(
      judge.page.getByRole("heading", { name: "Round complete", exact: true }),
    ).toBeVisible();
    await player.page.getByRole("button", { name: "play again", exact: true }).click();
    await expect(correct).toBeEnabled({ timeout: 15_000 });
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
