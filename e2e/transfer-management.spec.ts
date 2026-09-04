import { expect, test } from "@playwright/test";

test("admin can drill into a transfer and remove one file", async ({ context, page }) => {
  let removed = false;
  await page.route("**/api/admin/transfers**", async (route) => {
    const request = route.request();
    const pathname = new URL(request.url()).pathname;
    if (pathname.endsWith("/files/file-1") && request.method() === "DELETE") {
      removed = true;
      await route.fulfill({ json: { success: true, deletedTransfer: false } });
      return;
    }
    if (pathname.endsWith("/transfer-1")) {
      await route.fulfill({
        json: {
          transfer: {
            id: "transfer-1",
            title: "Managed transfer",
            files: removed
              ? []
              : [
                  {
                    id: "file-1",
                    filename: "manage-me.txt",
                    kind: "file",
                    mimeType: "text/plain",
                    processingStatus: "skipped",
                  },
                ],
          },
        },
      });
      return;
    }
    await route.fulfill({
      json: {
        transfers: [
          {
            id: "transfer-1",
            title: "Managed transfer",
            fileCount: removed ? 0 : 1,
            createdAt: "2026-09-03T00:00:00.000Z",
            expiresAt: "2026-09-10T00:00:00.000Z",
            remainingSeconds: 604_800,
          },
        ],
        media: { queueLength: 0, worker: {} },
      },
    });
  });

  await page.goto("/admin");
  await page.getByPlaceholder("admin password").fill("playwright-admin-password");
  await page.getByRole("button", { name: "unlock" }).click();
  await page.goto("/admin?view=transfers");

  const transferRow = page.locator("article").filter({ hasText: "Managed transfer" });
  await expect(transferRow).toBeVisible();
  await transferRow.getByRole("button", { name: "details" }).click();
  await expect(page.getByRole("link", { name: "open transfer" })).toBeVisible();
  const addFilesLink = page.getByRole("link", { name: "add files" });
  await expect(addFilesLink).toHaveAttribute("href", /\/upload\?transfer=transfer-1/);
  const appendPage = await context.newPage();
  await appendPage.goto((await addFilesLink.getAttribute("href"))!);
  await expect(appendPage.getByLabel("transfer id")).toHaveValue("transfer-1");
  await appendPage.close();

  await page.getByRole("button", { name: "remove" }).click();
  const dialog = page.getByRole("dialog", { name: "Remove “manage-me.txt”?" });
  await dialog.getByRole("button", { name: "remove file" }).click();
  await expect(page.getByText("No files match this state.")).toBeVisible();
  expect(removed).toBe(true);
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
