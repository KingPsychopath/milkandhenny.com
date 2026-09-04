import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

test("Twin finishes an isolated-phone match after a wrong answer and supports a rematch", async ({
  browser,
}, testInfo) => {
  test.setTimeout(150_000);
  const surfaces = await Promise.all(
    ["Host", "Guest"].map((role) =>
      openIsolatedGameSurface({
        browser,
        baseURL: String(testInfo.project.use.baseURL),
        role,
        contextOptions: { ...devices["Pixel 7"], reducedMotion: "reduce", serviceWorkers: "block" },
      }),
    ),
  );
  const [host, guest] = surfaces;
  try {
    await host.page.goto("/things");
    await waitForAppHydration(host.page);
    const room = await host.page.evaluate(async () => {
      const path = "/features/things/twin/twin-room.functions.ts";
      const api = await import(/* @vite-ignore */ path);
      const created = await api.createTwinRoomFn({
        data: { hostName: "Host", handSize: 3, windowMs: 15_000, graceMs: 1000 },
      });
      const joined = await api.joinTwinRoomFn({
        data: { roomId: created.roomId, joinToken: created.joinToken, name: "Guest" },
      });
      if (!joined.ok) throw new Error(joined.error);
      return { roomId: created.roomId, seats: [created, joined] };
    });
    for (const [index, surface] of surfaces.entries()) {
      await surface.context.addInitScript(
        ({ roomId, seat }) => {
          localStorage.setItem(
            `things:twin:v1:room:${roomId}:player-session`,
            JSON.stringify({
              expiresAt: Date.now() + 3_600_000,
              value: { roomId, playerId: seat.playerId, playerToken: seat.playerToken },
            }),
          );
        },
        { roomId: room.roomId, seat: room.seats[index] },
      );
      await surface.page.goto(`/things/twin/${room.roomId}`);
      await waitForAppHydration(surface.page);
    }
    await host.page.getByRole("button", { name: /^start/ }).click();
    const again = host.page.getByRole("button", { name: "rematch now", exact: true });
    for (let heat = 0; heat < 10; heat++) {
      if (await again.isVisible()) break;
      const hand = host.page.locator('[data-twin-card="hand"]');
      await expect
        .poll(
          async () =>
            (await again.isVisible()) || (await hand.locator("button:enabled").count()) > 0,
          { timeout: 20_000 },
        )
        .toBe(true);
      if (await again.isVisible()) break;
      const middle = host.page.locator('[data-twin-card="middle"]');
      const previous = await middle.getAttribute("data-twin-card-id");
      const symbols = await middle
        .locator("[data-twin-symbol]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-twin-symbol")));
      const choices = await hand
        .locator("button[data-twin-symbol]")
        .evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-twin-symbol")));
      const matching = choices.find((symbol) => symbols.includes(symbol));
      expect(matching).toBeTruthy();
      if (heat === 0) {
        const wrong = await guest.page
          .locator('[data-twin-card="hand"] button[data-twin-symbol]')
          .evaluateAll(
            (nodes, middleSymbols) =>
              nodes
                .find((node) => !middleSymbols.includes(node.getAttribute("data-twin-symbol")))
                ?.getAttribute("data-twin-symbol"),
            symbols,
          );
        expect(wrong).toBeTruthy();
        await guest.page
          .locator(`[data-twin-card="hand"] button[data-twin-symbol="${wrong}"]`)
          .click();
        await expect(guest.page.getByText(/wrong one|Not that one/).first()).toBeVisible();
      }
      const answer = hand.locator(`button[data-twin-symbol="${matching}"]`);
      await answer.focus();
      await host.page.keyboard.press("Enter");
      await expect
        .poll(
          async () =>
            (await again.isVisible()) ||
            (await middle.getAttribute("data-twin-card-id")) !== previous,
          { timeout: 25_000 },
        )
        .toBe(true);
    }
    await expect(again).toBeVisible();
    await expect(
      guest.page.getByText("The host can start an immediate rematch or reopen the lobby."),
    ).toBeVisible();
    await again.click();
    await expect(host.page.locator('[data-twin-card="hand"] button').first()).toBeEnabled({
      timeout: 20_000,
    });
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
