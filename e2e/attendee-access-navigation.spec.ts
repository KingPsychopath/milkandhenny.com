import { expect, test } from "@playwright/test";

test("anonymous account navigation reaches sign in without an error boundary", async ({ page }) => {
  await page.goto("/");
  const accountLink = page.getByRole("link", { name: "account", exact: true });
  await expect
    .poll(() => accountLink.evaluate((element) => getComputedStyle(element).pointerEvents))
    .toBe("auto");
  expect(await accountLink.getAttribute("href")).toBe("/access?returnTo=%2Fmy");
  await page.evaluate(() => {
    (window as Window & { accountNavigationMarker?: string }).accountNavigationMarker =
      "same-document";
  });
  await accountLink.click();

  await expect(page).toHaveURL(/\/access\?returnTo=(%2F|%2f)my$/);
  await expect(page.getByRole("heading", { name: "sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "account" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "oops" })).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(
        () => (window as Window & { accountNavigationMarker?: string }).accountNavigationMarker,
      ),
    )
    .toBe("same-document");
});

test("an emailed access link signs in automatically without reloading the document", async ({
  page,
}) => {
  let verificationRequests = 0;
  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });
  await page.route("**/api/attendee/access", async (route) => {
    if (route.request().method() !== "PATCH") return route.continue();
    verificationRequests += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ authenticated: true, returnTo: "/" }),
    });
  });

  await page.goto("/access?returnTo=%2Fmy#challenge=challenge-id&token=access-token");

  await expect(page).toHaveURL(/\/$/);
  expect(verificationRequests).toBe(1);
  expect(documentRequests).toBe(1);
  await expect(page.getByRole("button", { name: "sign in", exact: true })).toHaveCount(0);
});

test("missing pages offer back and home recovery", async ({ page }) => {
  await page.goto("/");
  await page.goto("/this-page-does-not-exist");

  await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
  await expect(page.getByRole("button", { name: "go back" })).toBeVisible();
  await expect(page.getByRole("link", { name: "go home" })).toBeVisible();
  await page.getByRole("button", { name: "go back" }).click();
  await expect(page).toHaveURL(/\/$/);
});
