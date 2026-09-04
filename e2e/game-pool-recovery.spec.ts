import { devices, expect, test } from "@playwright/test";
import {
  openIsolatedGameSurface,
  closeGameSurfaces,
  waitForAppHydration,
} from "./support/multiplayer";
import { GAME_SETTINGS_GAMES } from "@/features/things/shared/game-settings";

for (const game of GAME_SETTINGS_GAMES)
  test(`${game}: separate phones keep their identities after refresh and reconnect`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(120_000);
    process.env.DATABASE_URL =
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";
    const pools = await import("@/features/things/pool/store.server");
    const actionId = `recovery:${game}:${Date.now()}`;
    const entrance = await pools.createGamePoolEntrance({
      game,
      label: `Recovery QA ${game}`,
      targetSize: 8,
      autoJoin: true,
      allowRoomChoice: true,
      allowNewRooms: true,
      actionId,
    });
    const opened = await pools.openGamePoolRun(entrance.id, { actionId });
    if (!opened) throw new Error("Pool did not open");
    const surfaces = await Promise.all(
      ["Host", "Maya"].map((role) =>
        openIsolatedGameSurface({
          browser,
          baseURL: String(testInfo.project.use.baseURL),
          role,
          contextOptions: {
            ...devices["Pixel 7"],
            reducedMotion: "reduce",
            serviceWorkers: "block",
          },
        }),
      ),
    );
    try {
      for (const surface of surfaces) {
        await surface.page.goto(`/play/${opened.token}`);
        await waitForAppHydration(surface.page);
        await expect(surface.page.getByRole("button", { name: "change my name" })).toBeVisible({
          timeout: 15_000,
        });
        await surface.page.getByRole("button", { name: "change my name" }).click();
        const dialog = surface.page.getByRole("dialog", { name: "What should we call you?" });
        await dialog.getByRole("textbox", { name: "Name", exact: true }).fill(surface.role);
        await dialog.getByRole("button", { name: "save name" }).click();
        await expect(surface.page).toHaveURL(new RegExp(`/things/${game}/`), { timeout: 15_000 });
      }
      const [host, guest] = surfaces;
      const roomPath = new URL(host.page.url()).pathname;
      expect(new URL(guest.page.url()).pathname).toBe(roomPath);
      await guest.page.reload();
      await waitForAppHydration(guest.page);
      await expect(guest.page.getByText(/Maya/).first()).toBeVisible({ timeout: 15_000 });
      await guest.context.setOffline(true);
      await expect(
        guest.page
          .getByRole("status")
          .filter({ hasText: /offline|reconnecting/i })
          .first(),
      ).toBeVisible({ timeout: 15_000 });
      await guest.context.setOffline(false);
      await expect(guest.page.getByText(/Maya/).first()).toBeVisible();
      expect(new URL(guest.page.url()).pathname).toBe(roomPath);
      const database = await import("@/lib/platform/postgres.server");
      const counts = await database.query<{ count: number }>(
        "select count(*)::int as count from game_pool_assignments where run_id=$1 and status='active'",
        [opened.run!.id],
      );
      expect(counts[0]?.count).toBe(2);
    } finally {
      await closeGameSurfaces(surfaces);
      await pools.setGamePoolRunStatus(entrance.id, "closed");
    }
  });
