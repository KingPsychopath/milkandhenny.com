import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

test("Draw Country locks drawings, restores a submitted phone, reveals scores and rematches", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
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
      const path = "/features/things/draw-country/draw-country-room.functions.ts";
      const api = await import(/* @vite-ignore */ path);
      const created = await api.createDrawCountryRoomFn({
        data: { hostName: "Host", roundTotal: 1, drawSeconds: 90 },
      });
      const joined = await api.joinDrawCountryRoomFn({
        data: { roomId: created.roomId, joinToken: created.joinToken, name: "Guest" },
      });
      if (!joined.ok) throw new Error(joined.error);
      return { roomId: created.roomId, seats: [created, joined] };
    });
    for (const [index, surface] of surfaces.entries()) {
      await surface.context.addInitScript(
        ({ roomId, seat }) => {
          localStorage.setItem(
            `things:draw-country:v1:room:${roomId}:player-session`,
            JSON.stringify({
              expiresAt: Date.now() + 3_600_000,
              value: { roomId, playerId: seat.playerId, playerToken: seat.playerToken },
            }),
          );
        },
        { roomId: room.roomId, seat: room.seats[index] },
      );
      await surface.page.goto(`/things/draw-country/${room.roomId}`);
      await waitForAppHydration(surface.page);
    }
    await host.page.getByRole("button", { name: /^start/ }).click();
    for (const [index, surface] of surfaces.entries()) {
      const canvas = surface.page.getByRole("img", { name: /^Drawing area/ });
      await expect(canvas).toBeVisible({ timeout: 15_000 });
      const bounds = await canvas.boundingBox();
      if (!bounds) throw new Error("Drawing canvas has no bounds");
      const x = bounds.x + bounds.width * 0.2;
      const y = bounds.y + bounds.height * 0.2;
      await surface.page.mouse.move(x, y);
      await surface.page.mouse.down();
      await surface.page.mouse.move(x + bounds.width * 0.6, y, { steps: 12 });
      await surface.page.mouse.move(x + bounds.width * 0.4, y + bounds.height * 0.6, { steps: 12 });
      await surface.page.mouse.move(x, y, { steps: 12 });
      await surface.page.mouse.up();
      await surface.page.getByRole("button", { name: "lock in", exact: true }).click();
      if (index === 0) {
        await host.page.reload();
        await waitForAppHydration(host.page);
        await expect(host.page.getByText(/locked in/i).first()).toBeVisible();
        await expect(
          guest.page.getByRole("button", { name: "lock in", exact: true }),
        ).toBeVisible();
      }
    }
    await expect(
      host.page.getByRole("button", { name: "next round now", exact: true }),
    ).toBeVisible({ timeout: 15_000 });
    await host.page.getByRole("button", { name: "next round now", exact: true }).click();
    const again = host.page.getByRole("button", { name: "play again · same people", exact: true });
    await expect(again).toBeVisible();
    await expect(guest.page.getByText(/final borders/).first()).toBeVisible();
    await again.click();
    await expect(host.page.getByRole("img", { name: /^Drawing area/ })).toBeVisible({
      timeout: 15_000,
    });
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
