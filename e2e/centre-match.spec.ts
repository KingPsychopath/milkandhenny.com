import { devices, expect, test } from "@playwright/test";
import {
  CENTRE_CELL,
  centreCellId,
  centreCellParts,
  generateCentreMaze,
} from "@/features/things/centre/centre-generator";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

test("Centre runs a keyboard race on isolated phones, hides the maze before GO and rematches", async ({
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
      const path = "/features/things/centre/centre-room.functions.ts";
      const api = await import(/* @vite-ignore */ path);
      const created = await api.createCentreRoomFn({ data: { hostName: "Host", difficulty: 1 } });
      const joined = await api.joinCentreRoomFn({
        data: { roomId: created.roomId, joinToken: created.joinToken, name: "Guest" },
      });
      if (!joined.ok) throw new Error(joined.error);
      return { roomId: created.roomId, seats: [created, joined] };
    });
    for (const [index, surface] of surfaces.entries()) {
      await surface.context.addInitScript(
        ({ roomId, seat }) => {
          localStorage.setItem(
            `things:centre:v1:room:${roomId}:player-session`,
            JSON.stringify({
              expiresAt: Date.now() + 3_600_000,
              value: { roomId, playerId: seat.playerId, playerToken: seat.playerToken },
            }),
          );
        },
        { roomId: room.roomId, seat: room.seats[index] },
      );
      await surface.page.goto(`/things/centre/${room.roomId}`);
      await waitForAppHydration(surface.page);
    }
    await host.page.getByRole("button", { name: /^start/ }).click();
    for (const surface of surfaces) {
      const board = surface.page.getByRole("application", { name: /^Circular maze/ });
      await expect(board.locator(".centre-maze-hidden")).toBeAttached();
      await board.focus();
      await surface.page.keyboard.press("Enter");
    }
    await Promise.all(
      surfaces.map(async (surface, index) => {
        const board = surface.page.getByRole("application", { name: /^Circular maze/ });
        await expect(board.locator(".centre-maze-hidden")).toHaveCount(0, { timeout: 15_000 });
        const snapshot = await surface.page.evaluate(
          async ({ roomId, seat }) => {
            const path = "/features/things/centre/centre-room.functions.ts";
            const { readCentreSnapshotFn } = await import(/* @vite-ignore */ path);
            return (
              await readCentreSnapshotFn({
                data: {
                  roomId,
                  playerId: seat.playerId,
                  playerToken: seat.playerToken,
                  lastSequence: 0,
                },
              })
            ).snapshot;
          },
          { roomId: room.roomId, seat: room.seats[index] },
        );
        const course = snapshot.course;
        const maze = generateCentreMaze({
          seed: course.seed,
          difficulty: course.difficulty,
          playerCount: course.playerCount,
        });
        const entrance = snapshot.players.find(
          (player: { id: string }) => player.id === room.seats[index].playerId,
        ).entranceIndex;
        const parents = new Map<string, string | null>([[CENTRE_CELL, null]]);
        const queue = [CENTRE_CELL];
        for (let cursor = 0; cursor < queue.length; cursor++)
          for (const next of maze.links[queue[cursor]]) {
            if (!parents.has(next)) {
              parents.set(next, queue[cursor]);
              queue.push(next);
            }
          }
        let current = centreCellId(maze.rings - 1, maze.entranceSectors[entrance]);
        await board.focus();
        while (current !== CENTRE_CELL) {
          const next = parents.get(current)!;
          const from = centreCellParts(current)!;
          const to = centreCellParts(next);
          const key =
            !to || to.ring < from.ring
              ? "ArrowUp"
              : to.ring > from.ring
                ? "ArrowDown"
                : to.sector === (from.sector + 1) % maze.sectors
                  ? "ArrowRight"
                  : "ArrowLeft";
          await surface.page.keyboard.press(key, { delay: 60 });
          current = next;
        }
      }),
    );
    for (const surface of surfaces)
      await expect(surface.page.getByRole("heading", { name: /found the centre/ })).toBeVisible({
        timeout: 20_000,
      });
    await expect(guest.page.getByRole("button", { name: "new maze", exact: true })).toHaveCount(0);
    await host.page.getByRole("button", { name: "new maze", exact: true }).click();
    await expect(host.page.getByRole("application", { name: /^Circular maze/ })).toBeVisible();
  } finally {
    await closeGameSurfaces(surfaces);
  }
});
