import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test.use({ actionTimeout: 15_000 });

test("Spelling Party keeps player answers private, recovers a phone, and finishes on the shared screen", async ({
  browser,
}, testInfo) => {
  test.setTimeout(240_000);
  const baseURL = String(testInfo.project.use.baseURL);
  const screen = await openIsolatedGameSurface({
    browser,
    baseURL,
    role: "Screen",
    contextOptions: { reducedMotion: "reduce", serviceWorkers: "block" },
  });
  const players = await Promise.all(
    ["Maya", "Daniel"].map((role) =>
      openIsolatedGameSurface({
        browser,
        baseURL,
        role,
        contextOptions: { ...devices["Pixel 7"], reducedMotion: "reduce", serviceWorkers: "block" },
      }),
    ),
  );
  try {
    // The old launch URL redirects to Spelling Bee. Existing Party room links remain supported.
    await screen.page.goto("/things");
    await waitForAppHydration(screen.page);
    const { partyPresenterFragment } =
      await import("@/features/things/spelling-party/party-invite");
    const room = await screen.page.evaluate(async () => {
      const modulePath = "/features/things/spelling-party/party-room.functions.ts";
      const { createPartyRoomFn } = await import(/* @vite-ignore */ modulePath);
      return createPartyRoomFn({ data: { deckId: "warm-up", answerSeconds: 15, roundTotal: 5 } });
    });
    const playerPath = `/things/spelling-party/${room.roomId}`;
    await screen.page.goto(`${playerPath}/present#${partyPresenterFragment(room)}`);
    await waitForAppHydration(screen.page);
    for (const player of players) {
      await player.page.goto(playerPath);
      await waitForAppHydration(player.page);
      await player.page.getByRole("button", { name: "change my name", exact: true }).last().click();
      const nameDialog = player.page.getByRole("dialog", { name: "What should we call you?" });
      await nameDialog.getByRole("textbox", { name: "Name", exact: true }).fill(player.role);
      await nameDialog.getByRole("button", { name: "save name", exact: true }).click();
      await player.page.getByRole("button", { name: "I’m ready", exact: true }).click();
    }
    await screen.page.getByRole("button", { name: "start round", exact: true }).click();
    for (let round = 1; round <= 5; round++) {
      await expect(screen.page.getByText(`word ${round} of 5`, { exact: true })).toBeVisible({
        timeout: 25_000,
      });
      const [maya, daniel] = players;
      await expect(maya.page.getByRole("button", { name: "lock it in", exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await maya.page.getByRole("button", { name: "Z", exact: true }).click();
      await maya.page.getByRole("button", { name: "lock it in", exact: true }).click();
      await expect(
        daniel.page.getByRole("list", { name: "Spellings ranked by closeness" }),
      ).toHaveCount(0);
      if (round === 1) {
        await maya.page.reload();
        await waitForAppHydration(maya.page);
        await expect(
          maya.page.getByRole("heading", { name: "Locked in.", exact: true }),
        ).toBeVisible();
      }
      await daniel.page.getByRole("button", { name: "A", exact: true }).click();
      await daniel.page.getByRole("button", { name: "lock it in", exact: true }).click();
      await expect(screen.page.getByText("closest spellings", { exact: true })).toBeVisible({
        timeout: 15_000,
      });
      await expect(
        screen.page.getByRole("list", { name: "Spellings ranked by closeness" }),
      ).toContainText("Maya");
    }
    await expect(
      screen.page.getByRole("button", { name: "play again · same people", exact: true }),
    ).toBeVisible({ timeout: 20_000 });
    await expect(
      players[0].page.getByRole("heading", { name: "Final scores.", exact: true }),
    ).toBeVisible();
    await screen.page.getByRole("button", { name: "back to the lobby", exact: true }).click();
    await expect(
      screen.page.getByRole("button", { name: "start round", exact: true }),
    ).toBeVisible();
    await expect(screen.page.getByRole("list", { name: "Players in the room" })).toContainText(
      "Daniel",
    );
  } finally {
    await closeGameSurfaces([screen, ...players]);
  }
});
