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
  const configuredBaseURL = testInfo.project.use.baseURL;
  if (typeof configuredBaseURL !== "string") throw new Error("Playwright baseURL is required");

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
    await host.context.grantPermissions(["clipboard-read", "clipboard-write"], {
      origin: configuredBaseURL,
    });
    await host.page.goto("/things/same-brain");
    await waitForAppHydration(host.page);
    await host.page.getByRole("button", { name: /^(?:open a room|private room)$/ }).click();
    await joinAs(host, "Host");

    await host.page.getByRole("button", { name: "copy invite link" }).click();
    await expect(host.page.getByText("invite copied", { exact: true })).toBeVisible();
    const inviteUrl = await host.page.evaluate(() => navigator.clipboard.readText());
    expect(inviteUrl).toContain("/things/same-brain/");
    expect(inviteUrl).toContain("#join=");

    await Promise.all([joinFromInvite(maya, inviteUrl), joinFromInvite(daniel, inviteUrl)]);

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
  }
});

async function joinFromInvite(surface: IsolatedGameSurface, inviteUrl: string) {
  await surface.page.goto(inviteUrl);
  await joinAs(surface, surface.role);
}

async function joinAs(surface: IsolatedGameSurface, name: string) {
  await waitForAppHydration(surface.page);
  await surface.page.getByRole("textbox", { name: "your name" }).fill(name);
  await surface.page.getByRole("button", { name: "join the room" }).click();
  await expect(surface.page.getByRole("region", { name: "Room lobby" })).toBeVisible({
    timeout: 15_000,
  });
}

async function answer(surface: IsolatedGameSurface, text: string) {
  await surface.page.getByRole("textbox", { name: "your answer" }).fill(text);
  await surface.page.getByRole("button", { name: "lock it in" }).click();
  await expect(surface.page.getByText("you said", { exact: true })).toBeVisible();
}
