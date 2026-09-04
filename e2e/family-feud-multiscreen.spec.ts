import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

test("keeps the Family Feud TV, MC, and team buzzer in sync through refresh", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const baseURL = testInfo.project.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required");

  const phone = { ...devices["Pixel 7"], serviceWorkers: "block" as const };
  const presenter = await openIsolatedGameSurface({ baseURL, browser, role: "TV" });
  const mc = await openIsolatedGameSurface({
    baseURL,
    browser,
    contextOptions: { ...phone, viewport: { width: 320, height: 700 } },
    role: "MC",
  });
  const buzzer = await openIsolatedGameSurface({
    baseURL,
    browser,
    contextOptions: phone,
    role: "Circle buzzer",
  });
  const surfaces = [presenter, mc, buzzer];

  try {
    await presenter.page.goto("/things/family-feud");
    await waitForAppHydration(presenter.page);
    await presenter.page.getByRole("button", { name: "put Family Feud on this screen" }).click();
    await expect(
      presenter.page.getByText(/MC: scan once to take the private controls/),
    ).toBeVisible({
      timeout: 15_000,
    });

    const controllerUrl = await presenter.page
      .getByRole("link", { name: "open controller on this device" })
      .getAttribute("href");
    if (!controllerUrl) throw new Error("Controller link was not created");
    await mc.page.goto(controllerUrl);
    await waitForAppHydration(mc.page);
    await expect(mc.page.getByRole("button", { name: "start game" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(
      presenter.page.getByText("MC connected. Start the game from the phone."),
    ).toBeVisible({ timeout: 15_000 });
    const triangleScoreLabel = mc.page
      .getByLabel("Score")
      .getByText("Triangle team", { exact: true });
    await expect(triangleScoreLabel).toBeVisible();
    expect(
      await triangleScoreLabel.evaluate((label) => label.scrollWidth <= label.clientWidth),
    ).toBe(true);

    await mc.context.setOffline(true);
    await expect(mc.page.getByText("offline", { exact: true })).toBeVisible();
    await mc.page.getByRole("button", { name: "start game" }).click();
    await expect(
      mc.page.getByText("Reconnecting… try that once more.", { exact: true }),
    ).toBeVisible();
    await mc.context.setOffline(false);
    await expect(mc.page.getByText("connected", { exact: true })).toBeVisible({ timeout: 15_000 });

    await mc.page.getByRole("button", { name: "buzzer QR" }).click();
    const circleBuzzerUrl = await mc.page
      .getByRole("link", { name: "open this buzzer" })
      .first()
      .getAttribute("href");
    if (!circleBuzzerUrl) throw new Error("Circle buzzer link was not created");
    await buzzer.page.goto(circleBuzzerUrl);
    await waitForAppHydration(buzzer.page);
    await expect(buzzer.page.getByRole("button", { name: /Circle team/ })).toHaveCount(1);
    await expect(buzzer.page.getByRole("button", { name: /Triangle team/ })).toHaveCount(0);

    await mc.page.getByRole("button", { name: "start game" }).click();
    await expect(presenter.page.getByText("Shout together. The MC reveals.")).toBeVisible({
      timeout: 15_000,
    });
    await mc.page.getByRole("button", { name: "start practice" }).click();
    await mc.page.getByRole("button", { name: "finish practice" }).click();

    const privatePrompt = await mc.page.locator("main h1").innerText();
    await expect(presenter.page.getByText("Round 1 is coming up.")).toBeVisible({
      timeout: 15_000,
    });
    await expect(presenter.page.getByText(privatePrompt, { exact: true })).toHaveCount(0);

    await mc.page.getByRole("button", { name: "use this card" }).click();
    await mc.page.getByRole("button", { name: "open buzzers" }).click();
    await expect(buzzer.page.getByText("Buzzers open", { exact: true })).toBeVisible({
      timeout: 15_000,
    });
    await buzzer.page.getByRole("button", { name: /Circle team/ }).click();
    await expect(mc.page.getByText(/Circle team.*answers now/)).toBeVisible({ timeout: 15_000 });

    await mc.page.getByRole("button", { name: /Reveal answer 1,/ }).click();
    await expect(presenter.page.getByLabel(/Answer 1, .*worth 10 points/)).toBeVisible({
      timeout: 15_000,
    });
    await expect(presenter.page.getByLabel("Score")).toContainText("10");

    await mc.page.reload();
    await waitForAppHydration(mc.page);
    await expect(mc.page.getByRole("button", { name: /start 45 seconds/ })).toBeVisible({
      timeout: 15_000,
    });
    await expect(mc.page.getByLabel("Score")).toContainText("10");
    for (let round = 0; round < 12; round++) {
      await mc.page.getByRole("button", { name: /start 45 seconds/ }).click();
      await mc.page.getByRole("button", { name: "end main answers", exact: true }).click();
      await mc.page.getByRole("button", { name: /start .*second steal/ }).click();
      await mc.page.getByRole("button", { name: "no match · reveal board", exact: true }).click();
      await mc.page.getByRole("button", { name: "show round score", exact: true }).click();
      const finish = mc.page.getByRole("button", { name: "finish game", exact: true });
      await expect(
        finish.or(mc.page.getByRole("button", { name: "next team and round", exact: true })),
      ).toBeVisible();
      if (await finish.isVisible()) {
        await finish.click();
        break;
      }
      await mc.page.getByRole("button", { name: "next team and round", exact: true }).click();
      await mc.page.getByRole("button", { name: "use this card", exact: true }).click();
      await mc.page.getByRole("button", { name: "open buzzers", exact: true }).click();
      await expect(buzzer.page.getByText("Buzzers open", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await buzzer.page.getByRole("button", { name: /Circle team/ }).click();
      await expect(mc.page.getByText(/Circle team.*answers now/)).toBeVisible({ timeout: 15_000 });
      await mc.page.getByRole("button", { name: /Reveal answer 1,/ }).click();
    }
    await mc.page.getByRole("button", { name: "confirm final result", exact: true }).click();
    const replay = mc.page.getByRole("button", {
      name: "play again with the same teams",
      exact: true,
    });
    await expect(replay).toBeVisible();
    await expect(presenter.page.getByLabel("Score")).toContainText("Circle team");
    await replay.click();
    await expect(
      mc.page.getByRole("button", { name: "start practice", exact: true }),
    ).toBeVisible();
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
