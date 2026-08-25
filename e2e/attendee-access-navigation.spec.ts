import { expect, test } from "@playwright/test";

test("anonymous account navigation reaches sign in without an error boundary", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "account", exact: true }).click();

  await expect(page).toHaveURL(/\/access\?returnTo=(%2F|%2f)my$/);
  await expect(page.getByRole("heading", { name: "sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "oops" })).toHaveCount(0);
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
