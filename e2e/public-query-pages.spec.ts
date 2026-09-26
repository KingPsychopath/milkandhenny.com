import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("public listing queries render on the server and survive client navigation", async ({
  page,
  request,
}) => {
  for (const [path, marker] of [
    ["/", "thoughts, stories, and things worth sharing"],
    ["/words", "search or scroll"],
    ["/events", "Upcoming"],
  ]) {
    const response = await request.get(path);
    const body = await response.text();
    expect(response.ok(), `${path}: ${response.status()} ${body.slice(-2000)}`).toBe(true);
    expect(body, path).toContain(marker);
  }

  await page.goto("/");
  await waitForAppHydration(page);
  await page.getByRole("link", { name: "[words]" }).click();
  await expect(page.getByRole("heading", { name: "words" })).toBeVisible();
  await page.goBack();
  await expect(page.getByText("Recent", { exact: true })).toBeVisible();
});
