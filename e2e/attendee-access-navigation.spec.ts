import { createHash } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("anonymous account navigation reaches sign in without an error boundary", async ({ page }) => {
  await page.goto("/");
  const accountLink = page.getByRole("link", { name: "account", exact: true });
  await expect
    .poll(() => accountLink.evaluate((element) => getComputedStyle(element).pointerEvents))
    .toBe("auto");
  expect(await accountLink.getAttribute("href")).toBe("/access?returnTo=%2Fmy");
  await accountLink.click();

  await expect(page).toHaveURL(/\/access\?returnTo=(%2F|%2f)my$/);
  await expect(page.getByRole("heading", { name: "sign in" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "account" })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "oops" })).toHaveCount(0);
});

test("an emailed access link requires deliberate confirmation before redemption", async ({
  page,
}) => {
  const pool = new Pool({ connectionString: databaseUrl });
  const suffix = Date.now().toString(36);
  const challengeId = `access_browser_${suffix}`;
  const token = `browser-token-${suffix}`;
  const email = `browser-${suffix}@example.com`;
  const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

  await pool.query(
    `insert into event_person_login_challenges
       (id,email,email_hash,token_hash,code_hash,purpose,return_to,expires_at)
     values ($1,$2,$3,$4,$5,'sign-in','/',now() + interval '15 minutes')`,
    [challengeId, email, sha256(email), sha256(token), sha256("unused-code")],
  );

  try {
    await page.goto(
      `/access/verify?returnTo=%2Fmy&challenge=${encodeURIComponent(challengeId)}&token=${encodeURIComponent(token)}`,
    );

    await expect(page.getByRole("heading", { name: "continue signing in" })).toBeVisible();
    const continueButton = page.getByRole("button", { name: "continue securely" });
    await expect(continueButton).toBeEnabled();
    await continueButton.click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: "sign in" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "account", exact: true })).toHaveAttribute(
      "href",
      "/my",
    );
  } finally {
    await pool.end();
  }
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
