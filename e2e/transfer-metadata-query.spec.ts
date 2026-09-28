import { randomBytes } from "node:crypto";
import { Redis } from "@upstash/redis";
import { expect, test } from "@playwright/test";
import { waitForAppHydration } from "./support/multiplayer";

test("transfer metadata reconciles processing and keeps owner capability scoped", async ({
  page,
  request,
}) => {
  test.setTimeout(75_000);
  const redis = new Redis({
    url: process.env.PLAYWRIGHT_REDIS_REST_URL ?? "http://127.0.0.1:56380",
    token: "local-browser-test",
  });
  const id = randomBytes(16).toString("base64url");
  const token = randomBytes(16).toString("base64url");
  const key = `transfer:${id}`;
  const transfer = {
    id,
    title: "Hydrated transfer journey",
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    deleteToken: token,
    files: [
      {
        id: "photo-1",
        filename: "photo.jpg",
        kind: "image",
        size: 100,
        mimeType: "image/jpeg",
        storageKey: `${id}/photo-1`,
        width: 100,
        height: 100,
        previewStatus: "original_only",
        processingStatus: "queued",
      },
    ],
  };
  try {
    await redis.set(key, JSON.stringify(transfer), { ex: 600 });
    const response = await request.get(`/t/${id}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Hydrated transfer journey");

    await page.goto(`/t/${id}`);
    await waitForAppHydration(page);
    await expect(page.getByText("processing", { exact: true })).toBeVisible();
    await redis.set(
      key,
      JSON.stringify({
        ...transfer,
        files: [{ ...transfer.files[0], previewStatus: "ready", processingStatus: "worker_done" }],
      }),
      { ex: 600 },
    );
    await expect(page.getByText("processing", { exact: true })).toHaveCount(0, {
      timeout: 25_000,
    });

    await page.goto(`/t/${id}?token=${token}`);
    await expect(page.getByText("owner controls", { exact: true }).first()).toBeVisible();
    await page.goto(`/t/${id}?token=wrong-token`);
    await expect(page.getByText("owner controls", { exact: true })).toHaveCount(0);
  } finally {
    await redis.del(key);
  }
});

test("concurrent admin and anonymous SSR transfer views keep private Query data isolated", async ({
  page,
  request,
}) => {
  const redis = new Redis({
    url: process.env.PLAYWRIGHT_REDIS_REST_URL ?? "http://127.0.0.1:56380",
    token: "local-browser-test",
  });
  const id = randomBytes(16).toString("base64url");
  const key = `transfer:${id}`;
  try {
    await redis.set(
      key,
      JSON.stringify({
        id,
        title: "Isolated transfer view",
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
        deleteToken: randomBytes(16).toString("base64url"),
        files: [],
      }),
      { ex: 600 },
    );
    await page.goto("/admin?view=overview");
    await waitForAppHydration(page);
    const password = page.getByLabel("admin password", { exact: true });
    if (await password.isVisible()) {
      await password.fill("playwright-admin-password");
      await page.getByRole("button", { name: "unlock", exact: true }).click();
      await waitForAppHydration(page);
    }

    const [adminResponse, anonymousResponse] = await Promise.all([
      page.request.get(`/t/${id}`),
      request.get(`/t/${id}`),
    ]);
    expect(adminResponse.ok()).toBe(true);
    expect(anonymousResponse.ok()).toBe(true);
    const [adminHtml, anonymousHtml] = await Promise.all([
      adminResponse.text(),
      anonymousResponse.text(),
    ]);
    expect(adminHtml).toContain("Isolated transfer view");
    expect(anonymousHtml).toContain("Isolated transfer view");
    expect(adminHtml).toContain("admin controls");
    expect(anonymousHtml).not.toContain("admin controls");
  } finally {
    await redis.del(key);
  }
});
