import Redis from "ioredis";
import { randomUUID } from "node:crypto";
import { test, expect, type Page } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

async function unlock(page: Page) {
  await page.goto("/admin?view=events");
  await waitForAppHydration(page);
  if (await page.getByLabel("admin password", { exact: true }).isVisible()) {
    await page.getByLabel("admin password", { exact: true }).fill("playwright-admin-password");
    await page.getByRole("button", { name: "unlock", exact: true }).click();
    await waitForAppHydration(page);
    await page.goto("/admin?view=events");
    await waitForAppHydration(page);
  }
}

test("recovers an event draft across workspaces, browser Back, and refresh on a phone", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await unlock(page);
  await page.getByRole("button", { name: "+ new event", exact: true }).click();
  await page.getByLabel("title (required)", { exact: true }).fill("Unfinished event draft");
  const switcher = page.getByRole("button", { name: "Admin work area", exact: true });
  await switcher.click();
  await page.getByRole("option", { name: "games", exact: true }).click();
  await expect(page).toHaveURL(/view=games/);
  await expect(page.getByRole("button", { name: "create entrance", exact: true })).toBeInViewport();
  await page.goBack();
  await expect(page.getByLabel("title (required)", { exact: true })).toHaveValue(
    "Unfinished event draft",
  );
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await waitForAppHydration(page);
  await expect(page.getByLabel("title (required)", { exact: true })).toHaveValue(
    "Unfinished event draft",
  );
  await expect(
    page.getByText("Unfinished edits recovered in this tab.", { exact: false }),
  ).toBeVisible();
});

test("uses the event timezone and preserves a stale editor's draft", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const slug = `admin-edit-${Date.now()}`;
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  try {
    await database.query(
      "insert into events(slug,title,status,starts_at,timezone) values ($1,'Timezone QA','draft','2026-09-05T18:00:00Z','Europe/London')",
      [slug],
    );
    await unlock(page);
    await page.goto(`/admin?view=events&event=${slug}`);
    await waitForAppHydration(page);
    const row = page.locator("#events-manager li").filter({ hasText: "Timezone QA" });
    await row.getByRole("button", { name: "edit", exact: true }).click();
    await expect(page.getByLabel(/starts.*Europe\/London/)).toHaveValue("2026-09-05T19:00");
    await page.getByLabel("title (required)", { exact: true }).fill("My unfinished revision");
    await database.query(
      "update events set title='Another editor saved',updated_at=now()+interval '1 second' where slug=$1",
      [slug],
    );
    await page.getByRole("button", { name: "save", exact: true }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /changed|updated elsewhere/ })
        .first(),
    ).toBeVisible();
    await expect(page.getByLabel("title (required)", { exact: true })).toHaveValue(
      "My unfinished revision",
    );
    expect(
      (await database.query("select title from events where slug=$1", [slug])).rows[0].title,
    ).toBe("Another editor saved");
  } finally {
    await context.close();
    await database.query("delete from events where slug=$1", [slug]);
    await database.end();
  }
});

test("recovers a communication draft across tabs and refresh", async ({ page }) => {
  test.setTimeout(120_000);
  await unlock(page);
  await page.goto("/admin?view=communications&communicationTab=compose");
  await waitForAppHydration(page);
  await page.getByLabel("subject", { exact: true }).fill("Unfinished message");
  await page
    .getByRole("textbox", { name: "message body", exact: true })
    .fill("A draft to recover.");
  await page.getByRole("button", { name: "templates", exact: true }).click();
  await page.goBack();
  await expect(page.getByLabel("subject", { exact: true })).toHaveValue("Unfinished message");
  page.on("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await waitForAppHydration(page);
  await expect(page.getByRole("textbox", { name: "message body", exact: true })).toHaveValue(
    "A draft to recover.",
  );
});

test("warns and keeps the editor when draft storage is unavailable", async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("mah:admin-draft:"))
        throw new DOMException("Blocked", "QuotaExceededError");
      original.call(this, key, value);
    };
  });
  await unlock(page);
  await page.getByRole("button", { name: "+ new event", exact: true }).click();
  await page.getByLabel("title (required)", { exact: true }).fill("Keep this work");
  await expect(page.getByText("Draft recovery is unavailable.", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "games", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Leave with unfinished edits?" })).toBeVisible();
  await page.getByRole("button", { name: "keep editing", exact: true }).click();
  await expect(page.getByLabel("title (required)", { exact: true })).toHaveValue("Keep this work");
});

test("saving a new survey keeps its identity and clears only the saved draft", async ({ page }) => {
  test.setTimeout(120_000);
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const slug = `survey-save-${Date.now()}`;
  try {
    await unlock(page);
    await page.goto("/admin?view=communications&communicationTab=feedback");
    await waitForAppHydration(page);
    await page.getByRole("button", { name: "new survey", exact: true }).click();
    await page.getByLabel("title", { exact: true }).fill("Survey save QA");
    await page.getByLabel("slug", { exact: true }).fill(slug);
    await page.getByLabel("prompt", { exact: true }).fill("How was your night?");
    await page.getByRole("button", { name: "save survey", exact: true }).click();
    await expect(page.getByText("edit survey", { exact: true })).toBeVisible();
    const original = (await database.query("select id from surveys where slug=$1", [slug])).rows[0]
      .id;
    await page.getByLabel("title", { exact: true }).fill("Updated survey QA");
    const response = page.waitForResponse(
      (reply) => reply.url().endsWith("/api/admin/surveys") && reply.request().method() === "POST",
    );
    await page.getByRole("button", { name: "save survey", exact: true }).click();
    expect((await response).ok()).toBe(true);
    expect(
      (await database.query("select id,title from surveys where slug=$1", [slug])).rows,
    ).toEqual([{ id: original, title: "Updated survey QA" }]);
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            Object.keys(sessionStorage).filter(
              (key) =>
                key.startsWith("mah:admin-draft:") && key.endsWith(":communications:surveyDraft"),
            ).length,
        ),
      )
      .toBe(0);
  } finally {
    await database.query("delete from surveys where slug=$1", [slug]);
    await database.end();
  }
});

test("stage edits preserve UTC seconds and reject a newer server version", async ({
  browser,
}, testInfo) => {
  test.setTimeout(120_000);
  const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const slug = `stage-edit-${Date.now()}`;
  const planId = randomUUID();
  const stageId = randomUUID();
  const context = await browser.newContext({
    baseURL: testInfo.project.use.baseURL,
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();
  try {
    await database.query(
      "insert into events(slug,title,status,starts_at,timezone) values ($1,'Stage QA','draft','2027-01-10T18:00:00Z','Europe/London')",
      [slug],
    );
    await database.query(
      "insert into communication_plans(id,event_slug,name,status) values ($1,$2,'Stage QA','draft')",
      [planId, slug],
    );
    await database.query(
      "insert into communication_plan_stages(id,plan_id,stage_key,label,position,kind,audience,subject,body,status,send_at) values ($1,$2,'qa','QA stage',0,'event_service','event_attendees','Original QA','Original body','draft','2027-01-09T18:23:45Z')",
      [stageId, planId],
    );
    await unlock(page);
    await page.goto(
      `/admin?view=communications&communicationTab=event-plan&communicationEvent=${slug}`,
    );
    await waitForAppHydration(page);
    await page.getByRole("button", { name: "edit message", exact: true }).click();
    await expect(page.getByLabel("send at (UTC)", { exact: true })).toHaveValue("2027-01-09T18:23");
    await page.getByLabel("subject", { exact: true }).fill("Saved via keyboard");
    const saved = page.waitForResponse(
      (response) =>
        response.url().includes("/api/admin/communications") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "save stage", exact: true }).focus();
    await page.keyboard.press("Enter");
    expect((await saved).ok()).toBe(true);
    const row = (
      await database.query("select subject,send_at from communication_plan_stages where id=$1", [
        stageId,
      ])
    ).rows[0];
    expect(row.subject).toBe("Saved via keyboard");
    expect(row.send_at.toISOString()).toBe("2027-01-09T18:23:45.000Z");
    await page.getByRole("button", { name: "edit message", exact: true }).click();
    await page.getByLabel("subject", { exact: true }).fill("Preserve my local stage");
    await database.query(
      "update communication_plan_stages set subject='External edit',updated_at=now()+interval '1 second' where id=$1",
      [stageId],
    );
    await page.getByRole("button", { name: "save stage", exact: true }).click();
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: /changed|updated elsewhere/ })
        .first(),
    ).toBeVisible();
    await expect(page.getByLabel("subject", { exact: true })).toHaveValue(
      "Preserve my local stage",
    );
    expect(
      (await database.query("select subject from communication_plan_stages where id=$1", [stageId]))
        .rows[0].subject,
    ).toBe("External edit");
  } finally {
    await context.close();
    await database.query("delete from events where slug=$1", [slug]);
    await database.end();
  }
});

test("copied event workspaces preserve selection through keyboard navigation, Back and reload", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const slug = `workspace-${Date.now()}`;
  try {
    await database.query(
      "insert into events(slug,title,status,starts_at,timezone) values ($1,'Copied workspace QA','draft',now(),'UTC')",
      [slug],
    );
    await unlock(page);
    await page.goto(`/admin?view=events&event=${slug}&eventWorkspace=pitches`);
    await waitForAppHydration(page);
    await expect(page.getByRole("tab", { name: "pitches", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.getByRole("tab", { name: "tickets", exact: true }).focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(new RegExp(`event=${slug}`));
    await expect(page.getByRole("tab", { name: "tickets", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.goBack();
    await expect(page.getByRole("tab", { name: "pitches", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await page.reload();
    await waitForAppHydration(page);
    await expect(page).toHaveURL(new RegExp(`event=${slug}`));
    await expect(page.getByRole("tab", { name: "pitches", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  } finally {
    await database.query("delete from events where slug=$1", [slug]);
    await database.end();
  }
});

test("a content administrator sees only permitted workspaces and cannot call communications APIs", async ({
  page,
  context,
}, testInfo) => {
  test.setTimeout(120_000);
  const database = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const redis = new Redis(process.env.REDIS_URL ?? "redis://127.0.0.1:56379");
  const personId = randomUUID().slice(0, 14) + "7" + randomUUID().slice(15);
  const sessionId = randomUUID().replaceAll("-", "") + "browserfixture";
  const key = `event-scoring:attendee-session:${sessionId}`;
  const now = new Date().toISOString();
  try {
    await database.query(
      "insert into event_people(id,canonical_name) values ($1,'Content operator QA')",
      [personId],
    );
    await database.query(
      "insert into global_admin_grants(id,person_id,role_preset,status,issued_by_type,issued_by_id,activated_at) values ($1,$2,'content','active','root-owner','browser-fixture',now())",
      [randomUUID(), personId],
    );
    await redis.set(
      key,
      JSON.stringify({
        schemaVersion: 1,
        id: sessionId,
        personId,
        tickets: [],
        activeParticipantByEventId: {},
        authenticatedAt: now,
        passkeyAuthenticatedAt: now,
        authenticationMethod: "passkey",
        assurance: {
          primary: "passkey",
          factors: ["passkey"],
          phishingResistant: true,
          authenticatedAt: now,
        },
        createdAt: now,
        lastSeenAt: now,
      }),
      "EX",
      600,
    );
    await context.addCookies([
      {
        name: "mah-attendee-session",
        value: sessionId,
        url: String(testInfo.project.use.baseURL),
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.goto("/admin?view=events&eventWorkspace=events");
    await waitForAppHydration(page);
    await expect(page.getByRole("button", { name: "content", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "communications", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "games", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "+ new event", exact: true })).toHaveCount(0);
    await expect(page.locator("#event-workspace-panel #pitch-manager")).toBeVisible();
    const response = await context.request.get(
      "/api/admin/communications?scope=workspace&tab=compose",
    );
    expect([401, 403]).toContain(response.status());
    await page.goto("/admin?view=communications&communicationTab=compose");
    await waitForAppHydration(page);
    await expect(page.getByRole("textbox", { name: "subject", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "content", exact: true })).toBeVisible();
  } finally {
    await redis.del(key);
    redis.disconnect();
    await database.query("delete from global_admin_grants where person_id=$1", [personId]);
    await database.query("delete from event_people where id=$1", [personId]);
    await database.end();
  }
});
