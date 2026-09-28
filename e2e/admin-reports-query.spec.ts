import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("active reports are present in the initial admin overview", async ({ page }) => {
  test.skip(process.env.REPORT_STORE !== "postgres", "Requires the isolated Postgres report store");
  const databaseUrl =
    process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";
  const database = new Pool({ connectionString: databaseUrl });
  const key = `report-query-${randomUUID()}`;
  const url = "/admin?view=overview";
  await page.goto(url);
  const reportResponse = await page.request.post("/api/reports", {
    headers: {
      "idempotency-key": key,
      "user-agent": "report-query-test",
      origin: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:4174",
    },
    data: { type: "client_error", payload: { surface: key, errorCode: "hydration_test" } },
  });
  expect(reportResponse.ok(), await reportResponse.text()).toBe(true);
  const report = (await reportResponse.json()) as { reportId: string };
  try {
    await page.goto(url);
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }

    const response = await page.request.get(url);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain(key);
    await page.goto(url);
    await waitForAppHydration(page);
    await expect(page.getByText(key, { exact: false }).first()).toBeVisible();
  } finally {
    await database.query("delete from diagnostic_reports where id=$1", [report.reportId]);
    await database.end();
  }
});
