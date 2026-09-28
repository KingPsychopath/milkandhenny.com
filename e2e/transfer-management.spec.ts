import { expect, test } from "@playwright/test";
import { randomBytes, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("admin can drill into a transfer and remove one file", async ({ context, page }) => {
  test.setTimeout(60_000);
  const redis = new Redis({
    url: process.env.PLAYWRIGHT_REDIS_REST_URL ?? "http://127.0.0.1:56380",
    token: "local-browser-test",
  });
  const transferId = randomBytes(16).toString("base64url");
  const key = `transfer:${transferId}`;
  const transfer = {
    id: transferId,
    title: "Managed transfer",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    deleteToken: randomBytes(16).toString("base64url"),
    files: [
      {
        id: "file-1",
        filename: "manage-me.txt",
        kind: "file",
        size: 100,
        mimeType: "text/plain",
        storageKey: `${transferId}/file-1`,
        processingStatus: "skipped",
      },
    ],
  };
  let removed = false;
  try {
    await redis.set(key, JSON.stringify(transfer), { ex: 600 });
    await redis.sadd("transfer:index", transferId);
    await page.route(`**/api/admin/transfers/${transferId}/files/file-1`, async (route) => {
      removed = true;
      await redis.set(key, JSON.stringify({ ...transfer, files: [] }), { ex: 600 });
      await route.fulfill({ json: { success: true, deletedTransfer: false } });
    });

    await page.goto("/admin");
    await page.getByPlaceholder("admin password").fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock" }).click();
    await page.goto("/admin?view=transfers", { waitUntil: "domcontentloaded" });
    await waitForAppHydration(page);

    const response = await page.request.get("/admin?view=transfers");
    expect(await response.text()).toContain("Managed transfer");
    const transferRow = page.locator("article").filter({ hasText: "Managed transfer" });
    await expect(transferRow).toBeVisible();
    await expect(page.locator("#transfer-manager")).not.toHaveAttribute("inert", "");
    await transferRow.getByRole("button", { name: "details" }).click();
    await expect(page.getByRole("link", { name: "open transfer" })).toBeVisible();
    const addFilesLink = page.getByRole("link", { name: "add files" });
    await expect(addFilesLink).toHaveAttribute(
      "href",
      new RegExp(`/upload\\?transfer=${transferId}`),
    );
    const appendPage = await context.newPage();
    await appendPage.goto((await addFilesLink.getAttribute("href"))!);
    await expect(appendPage.getByLabel("transfer id")).toHaveValue(transferId);
    await appendPage.close();

    await page.getByRole("button", { name: "remove" }).click();
    const dialog = page.getByRole("dialog", { name: "Remove “manage-me.txt”?" });
    await dialog.getByRole("button", { name: "remove file" }).click();
    await expect(page.getByText("No files match this state.")).toBeVisible();
    expect(removed).toBe(true);
  } finally {
    await redis.del(key);
    await redis.srem("transfer:index", transferId);
  }
});

test("admin can grant transfer creation to a signed-in account", async ({ page }) => {
  const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const personId = randomUUID();
  try {
    await database.query("insert into event_people(id,canonical_name) values ($1,$2)", [
      personId,
      "Transfer Person",
    ]);
    await page.goto("/admin");
    await page.getByPlaceholder("admin password").fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock" }).click();
    await page.goto(`/admin?view=operations&operationsTab=people&person=${personId}`);
    await waitForAppHydration(page);

    await expect(page.getByRole("heading", { name: "Transfer Person" })).toBeVisible();
    await page.getByRole("button", { name: "grant access" }).click();
    const dialog = page.getByRole("dialog", {
      name: /Allow this account to create file transfers/,
    });
    await dialog.getByLabel("reason for the audit log").fill("Approved event media uploader");
    await dialog.getByRole("button", { name: "grant transfer access" }).click();
    const stepUp = page.getByRole("dialog", { name: "Confirm it’s you" });
    await stepUp.getByLabel("Admin password").fill("playwright-admin-password");
    await stepUp.getByRole("button", { name: "verify" }).click();

    await expect(page.getByText("can create transfers")).toBeVisible();
    const grant = await database.query(
      "select permission from account_permission_grants where person_id=$1",
      [personId],
    );
    expect(grant.rows).toEqual([{ permission: "create_transfers" }]);
  } finally {
    await database.query("delete from attendee_operations_audit_events where entity_id=$1", [
      personId,
    ]);
    await database.query("delete from account_permission_grants where person_id=$1", [personId]);
    await database.query("delete from event_people where id=$1", [personId]);
    await database.end();
  }
});
