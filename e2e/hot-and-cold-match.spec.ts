import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });
test("Hot & Cold completes a shared hunt with submitted-guess recovery and replay", async ({
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
      const path = "/features/things/hot-and-cold/hot-and-cold.functions.ts";
      const api = await import(/* @vite-ignore */ path);
      const created = await api.createHotAndColdRoomFn({
        data: { hostName: "Host", rounds: 1, guessesPerPlayer: 2, turnSeconds: 0 },
      });
      const joined = await api.joinHotAndColdRoomFn({
        data: { roomId: created.roomId, joinToken: created.joinToken, name: "Guest" },
      });
      if (!joined.ok) throw new Error(joined.error);
      return { roomId: created.roomId, seats: [created, joined] };
    });
    for (const [index, surface] of surfaces.entries()) {
      await surface.context.addInitScript(
        ({ roomId, seat }) => {
          localStorage.setItem(
            `things:hot-and-cold:v2:room:${roomId}:player-session`,
            JSON.stringify({ expiresAt: Date.now() + 3_600_000, value: seat }),
          );
        },
        { roomId: room.roomId, seat: room.seats[index] },
      );
      await surface.page.goto(`/things/hot-and-cold/${room.roomId}`);
      await waitForAppHydration(surface.page);
    }
    await host.page.getByRole("button", { name: "start the hunt", exact: true }).click();
    const finish = host.page.getByRole("button", { name: "finish game", exact: true });
    let roundId: string | undefined;
    for (const [index, word] of [
      "cat",
      "house",
      "water",
      "tree",
      "music",
      "food",
      "book",
      "love",
    ].entries()) {
      const snapshot = await host.page.evaluate(
        async ({ roomId, seat }) => {
          const path = "/features/things/hot-and-cold/hot-and-cold.functions.ts";
          const { readHotAndColdSnapshotFn } = await import(/* @vite-ignore */ path);
          return (
            await readHotAndColdSnapshotFn({
              data: { roomId, playerId: seat.playerId, playerToken: seat.playerToken },
            })
          ).snapshot;
        },
        { roomId: room.roomId, seat: room.seats[0] },
      );
      if (snapshot.phase === "reveal") break;
      roundId = snapshot.round.id;
      const active =
        surfaces[
          room.seats.findIndex(
            (seat: { playerId: string }) => seat.playerId === snapshot.round.currentPlayerId,
          )
        ];
      const input = active.page.getByPlaceholder("guess any word", { exact: true });
      await expect(input).toBeEnabled();
      await input.fill(word);
      await input.press("Enter");
      await expect(host.page.getByText(word, { exact: true }).first()).toBeVisible({
        timeout: 15_000,
      });
      if (index === 0) {
        await active.page.reload();
        await waitForAppHydration(active.page);
        await expect(active.page.getByText(word, { exact: true }).first()).toBeVisible();
      }
    }
    expect(roundId).toBeTruthy();
    await expect(finish).toBeVisible({ timeout: 15_000 });
    await finish.click();
    const again = host.page.getByRole("button", { name: "play again", exact: true });
    await expect(again).toBeVisible();
    await expect(guest.page.getByRole("button", { name: "play again", exact: true })).toHaveCount(
      0,
    );
    await again.click();
    await expect(host.page.getByRole("textbox")).toBeVisible();
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
