import { devices, expect, test } from "@playwright/test";
import {
  closeGameSurfaces,
  openIsolatedGameSurface,
  type IsolatedGameSurface,
  waitForAppHydration,
} from "./support/multiplayer";

test("keeps three Same Brain roles isolated through join, answer, refresh, and reveal", async ({
  browser,
}, testInfo) => {
  test.setTimeout(180_000);
  process.env.DATABASE_URL ??=
    process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";
  const configuredBaseURL = testInfo.project.use.baseURL;
  if (typeof configuredBaseURL !== "string") throw new Error("Playwright baseURL is required");
  const pools = await import("@/features/things/pool/store.server");
  const action = `same-brain-e2e:${Date.now()}`;
  const entrance = await pools.createGamePoolEntrance({
    game: "same-brain",
    label: "same brain browser QA",
    targetSize: 8,
    autoJoin: true,
    allowRoomChoice: true,
    allowNewRooms: true,
    actionId: action,
  });
  const opened = await pools.openGamePoolRun(entrance.id, { actionId: action });
  if (!opened) throw new Error("Same Brain test pool did not open");
  const entrancePath = `/play/${opened.token}`;

  const phone = {
    ...devices["Pixel 7"],
    serviceWorkers: "block" as const,
  };
  const surfaces = await Promise.all(
    ["Host", "Maya", "Daniel"].map((role) =>
      openIsolatedGameSurface({
        baseURL: configuredBaseURL,
        browser,
        contextOptions: phone,
        role,
      }),
    ),
  );
  const [host, maya, daniel] = surfaces;

  try {
    await enterFromGamePool(host, entrancePath, "Host");
    await Promise.all([
      enterFromGamePool(maya, entrancePath, "Maya"),
      enterFromGamePool(daniel, entrancePath, "Daniel"),
    ]);

    const hostRoster = host.page.getByRole("list", { name: "Players in the room" });
    const mayaRoster = maya.page.getByRole("list", { name: "Players in the room" });
    const danielRoster = daniel.page.getByRole("list", { name: "Players in the room" });
    await expect(hostRoster).toContainText("Host · you · room lead");
    await expect(mayaRoster).toContainText("Maya · you");
    await expect(danielRoster).toContainText("Daniel · you");
    await expect(maya.page.getByRole("button", { name: "start", exact: true })).toHaveCount(0);
    await expect(daniel.page.getByRole("button", { name: "start", exact: true })).toHaveCount(0);

    await host.page.getByRole("button", { name: "start", exact: true }).click();
    await Promise.all(
      surfaces.map(({ page }) =>
        expect(page.getByRole("textbox", { name: "your answer" })).toBeVisible({
          timeout: 15_000,
        }),
      ),
    );

    await answer(host, "violet walrus");
    await expect(maya.page.getByText("violet walrus", { exact: true })).toHaveCount(0);
    await expect(daniel.page.getByText("violet walrus", { exact: true })).toHaveCount(0);

    await answer(daniel, "copper kite");
    await expect(maya.page.getByText("copper kite", { exact: true })).toHaveCount(0);

    await daniel.page.reload();
    await waitForAppHydration(daniel.page);
    await expect(daniel.page.getByText("you said", { exact: true })).toBeVisible();
    await expect(daniel.page.getByText("copper kite", { exact: true })).toBeVisible();

    await host.page.getByRole("button", { name: "show answers now" }).click();
    await Promise.all(
      surfaces.map(({ page }) =>
        expect(page.getByText("violet walrus", { exact: true }).first()).toBeVisible({
          timeout: 15_000,
        }),
      ),
    );
    await Promise.all(
      surfaces.map(({ page }) =>
        expect(page.getByText("copper kite", { exact: true }).first()).toBeVisible(),
      ),
    );
    await expect(host.page.getByRole("button", { name: "next round" })).toBeVisible();
    await expect(maya.page.getByRole("button", { name: "next round" })).toHaveCount(0);
  } finally {
    await closeGameSurfaces(surfaces);
    await pools.setGamePoolRunStatus(entrance.id, "closed");
  }
});

async function enterFromGamePool(surface: IsolatedGameSurface, entrancePath: string, name: string) {
  await surface.page.goto(entrancePath);
  await waitForAppHydration(surface.page);
  await expect(surface.page.getByRole("region", { name: "Room lobby" })).toBeVisible({
    timeout: 15_000,
  });
  await surface.page.getByRole("button", { name: "change my name" }).click();
  const dialog = surface.page.getByRole("dialog", { name: "What should we call you?" });
  await dialog.getByRole("textbox", { name: "Name" }).fill(name);
  await dialog.getByRole("button", { name: "save name" }).click();
  const roster = surface.page.getByRole("list", { name: "Players in the room" });
  await expect(roster).toContainText(`${name} · you`);
  await expect(roster).toContainText("not ready");
  await surface.page.getByRole("button", { name: "I’m ready" }).click();
  await expect(roster).toContainText("ready");
}

async function answer(surface: IsolatedGameSurface, text: string) {
  await surface.page.getByRole("textbox", { name: "your answer" }).fill(text);
  await surface.page.getByRole("button", { name: "lock it in" }).click();
  await expect(surface.page.getByText("you said", { exact: true })).toBeVisible();
}
