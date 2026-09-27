import { expect, test } from "@playwright/test";
import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { waitForAppHydration } from "./support/multiplayer";

test("admin can drill into a transfer and remove one file", async ({ context, page }) => {
  const redis = new Redis({ url: "http://127.0.0.1:56380", token: "local-browser-test" });
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
    await page.goto("/admin?view=transfers");
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
  let granted = false;
  await page.route("**/api/admin/operations/people**", async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { action?: string };
      granted = body.action === "grant-transfer-creator";
      await route.fulfill({ json: { action: body.action, enabled: granted } });
      return;
    }
    await route.fulfill({
      json: {
        people: [
          {
            personId: "01990a1f-3b7c-7000-8000-000000000101",
            canonicalName: "Transfer Person",
            verifiedEmails: ["t•••@example.com"],
            identities: [],
            access: { acquisitionStatus: "active", activeSessions: 1 },
            tickets: [],
            globalRoles: [],
            eventRoles: [],
            accountPermissions: granted ? ["create_transfers"] : [],
            pendingInvitations: 0,
            staffDevices: 0,
            auditTimeline: [],
          },
        ],
        purchaserContacts: [],
      },
    });
  });
  await page.route("**/api/admin/operations/inbox**", (route) =>
    route.fulfill({ json: { items: [], unresolved: 0, unread: 0 } }),
  );

  await page.goto("/admin");
  await page.getByPlaceholder("admin password").fill("playwright-admin-password");
  await page.getByRole("button", { name: "unlock" }).click();
  await page.goto(
    "/admin?view=operations&operationsTab=people&person=01990a1f-3b7c-7000-8000-000000000101",
  );

  await expect(page.getByRole("heading", { name: "Transfer Person" })).toBeVisible();
  await page.getByRole("button", { name: "grant access" }).click();
  const dialog = page.getByRole("dialog", { name: /Allow this account to create file transfers/ });
  await dialog.getByLabel("reason for the audit log").fill("Approved event media uploader");
  await dialog.getByRole("button", { name: "grant transfer access" }).click();

  await expect(page.getByText("can create transfers")).toBeVisible();
  expect(granted).toBe(true);
});
