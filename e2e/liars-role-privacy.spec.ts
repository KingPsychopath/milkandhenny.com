import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

for (const mode of ["mafia", "imposter"] as const) {
  test(`${mode} keeps role cards private and supports keyboard reveal and host handover`, async ({
    browser,
  }, testInfo) => {
    test.setTimeout(240_000);
    const surfaces = await Promise.all(
      ["Host", "Guest", "Alex", "Sam", "Jo"].map((role) =>
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
    const [host, guest] = surfaces;
    try {
      await host.page.goto("/things");
      await waitForAppHydration(host.page);
      const room = await host.page.evaluate(async (gameMode) => {
        const path = "/features/things/liars/liars-room.functions.ts";
        const api = await import(/* @vite-ignore */ path);
        const started = await api.startLiarsScenarioFn({
          data: {
            mode: gameMode,
            names: ["Host", "Guest", "Alex", "Sam", "Jo"],
            timings: {
              deal: 10_000,
              night: 20_000,
              dawn: 8_000,
              deliberation: 20_000,
              vote: 10_000,
              verdict: 5_000,
              finalGuess: 10_000,
            },
            toggles: { lastWords: false },
          },
        });
        if (started.error) throw new Error(started.error);
        await api.applyLiarsHostActionFn({
          data: {
            roomId: started.roomId,
            hostToken: started.hostToken,
            action: { type: "phase.pause", actionId: crypto.randomUUID() },
          },
        });
        return started;
      }, mode);
      const privateRoles: string[] = [];
      for (const [index, surface] of surfaces.entries()) {
        await surface.context.addInitScript(
          ({ roomId, seat }) => {
            localStorage.setItem(
              `things:liars:v1:room:${roomId}:player-session`,
              JSON.stringify({
                expiresAt: Date.now() + 3_600_000,
                value: { roomId, playerId: seat.playerId, playerToken: seat.playerToken },
              }),
            );
          },
          { roomId: room.roomId, seat: room.seats[index] },
        );
        await surface.page.goto(`/things/liars/${room.roomId}`);
        await waitForAppHydration(surface.page);
        const snapshot = await surface.page.evaluate(
          async ({ roomId, seat }) => {
            const path = "/features/things/liars/liars-room.functions.ts";
            const { readLiarsSnapshotFn } = await import(/* @vite-ignore */ path);
            return (
              await readLiarsSnapshotFn({
                data: {
                  roomId,
                  playerId: seat.playerId,
                  credential: seat.playerToken,
                  lastSequence: 0,
                },
              })
            ).snapshot;
          },
          { roomId: room.roomId, seat: room.seats[index] },
        );
        expect(snapshot.player.playerId).toBe(room.seats[index].playerId);
        privateRoles.push(snapshot.player.role);
        for (const other of snapshot.players) {
          if (other.id !== snapshot.player.playerId && !snapshot.player.allyIds.includes(other.id))
            expect(other.role).toBeUndefined();
        }
        const card = surface.page.getByRole("button", {
          name: "Hold to reveal your role",
          exact: true,
        });
        await expect(card).toContainText("hold to reveal");
        await card.focus();
        await surface.page.keyboard.down("Space");
        await expect(card).not.toContainText("hold to reveal");
        await surface.page.keyboard.up("Space");
        await expect(card).toContainText("hold to reveal");
        await card.dispatchEvent("pointerdown");
        await expect(card).not.toContainText("hold to reveal");
        await card.dispatchEvent("pointercancel");
        await expect(card).toContainText("hold to reveal");
      }
      const handover = await host.page.evaluate(
        async ({ roomId, hostToken, playerId }) => {
          const path = "/features/things/liars/liars-room.functions.ts";
          const { applyLiarsHostActionFn } = await import(/* @vite-ignore */ path);
          return applyLiarsHostActionFn({
            data: {
              roomId,
              hostToken,
              action: { type: "host.pass", playerId, actionId: crypto.randomUUID() },
            },
          });
        },
        { roomId: room.roomId, hostToken: room.hostToken, playerId: room.seats[1].playerId },
      );
      expect(handover.accepted).toBe(true);
      await guest.page.reload();
      await waitForAppHydration(guest.page);
      const authority = await guest.page.evaluate(
        async ({ roomId, seat }) => {
          const path = "/features/things/liars/liars-room.functions.ts";
          const { readLiarsSnapshotFn } = await import(/* @vite-ignore */ path);
          return (
            await readLiarsSnapshotFn({
              data: {
                roomId,
                playerId: seat.playerId,
                credential: seat.playerToken,
                lastSequence: 0,
              },
            })
          ).snapshot;
        },
        { roomId: room.roomId, seat: room.seats[1] },
      );
      expect(authority.hostPlayerId).toBe(room.seats[1].playerId);
      await guest.page.evaluate(async ({ roomId, hostToken }) => {
        const path = "/features/things/liars/liars-room.functions.ts";
        const { applyLiarsHostActionFn } = await import(/* @vite-ignore */ path);
        await applyLiarsHostActionFn({
          data: {
            roomId,
            hostToken,
            action: { type: "phase.resume", actionId: crypto.randomUUID() },
          },
        });
      }, room);
      if (mode === "mafia") {
        await Promise.all(
          surfaces.map(async ({ page }) => {
            const abstain = page.getByRole("button", {
              name: /^(nobody dies tonight|do nothing tonight)$/,
            });
            await expect(abstain).toBeEnabled({ timeout: 35_000 });
            await abstain.click();
          }),
        );
      } else {
        for (const round of [1, 2]) {
          for (const surface of surfaces.slice(0, 2)) {
            await expect(
              surface.page.getByText(`clues · round ${round}`, { exact: true }),
            ).toBeVisible({ timeout: 20_000 });
            const done = surface.page.getByRole("button", {
              name: "everyone has said theirs →",
              exact: true,
            });
            await expect(done).toBeEnabled();
            await done.click();
          }
        }
      }
      await Promise.all(
        surfaces.slice(0, 3).map(async ({ page }) => {
          const ready = page.getByRole("button", { name: "ready to vote", exact: true });
          await expect(ready).toBeVisible({ timeout: 40_000 });
          await ready.click();
        }),
      );
      const mafiaIndex = privateRoles.findIndex((role) => role === mode);
      expect(mafiaIndex).toBeGreaterThanOrEqual(0);
      const mafiaName = room.seats[mafiaIndex].name;
      await Promise.all(
        surfaces.map(async ({ page }) => {
          await expect(page.getByRole("heading", { name: "Vote", exact: true })).toBeVisible({
            timeout: 25_000,
          });
          await page.getByRole("button", { name: new RegExp(`^${mafiaName}(?: |$)`) }).click();
          await page.getByRole("button", { name: "lock my vote", exact: true }).click();
        }),
      );
      if (mode === "imposter") {
        const guess = surfaces[mafiaIndex].page.locator('form input[maxlength="60"]');
        await expect(guess).toBeVisible({ timeout: 15_000 });
        await guess.fill("definitely not the secret");
        await guess.press("Enter");
      }
      for (const surface of surfaces)
        await expect(surface.page.getByText("what happened", { exact: true })).toBeVisible({
          timeout: 25_000,
        });
      await guest.page.getByRole("button", { name: "again, same people", exact: true }).click();
      await expect(
        guest.page.getByRole("button", { name: "Hold to reveal your role", exact: true }),
      ).toBeVisible();
    } finally {
      await closeGameSurfaces(surfaces);
    }
  });
}
