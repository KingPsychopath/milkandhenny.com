import { chromium, devices, expect, test, webkit } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("keeps one attendee session coherent in mobile Chromium and WebKit", async () => {
  test.setTimeout(180_000);
  const alphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789";
  let source = Date.now();
  let suffix = "";
  for (let index = 0; index < 6; index += 1) {
    suffix = `${alphabet[source % alphabet.length]}${suffix}`;
    source = Math.floor(source / alphabet.length);
  }
  const eventSlug = `score-browser-${suffix.toLowerCase()}`;
  const firstTicket = `01ARZ3NDEK${suffix}`.slice(0, 16);
  const secondTicket = `01BRZ3NDEK${suffix}`.slice(0, 16);
  const pool = new Pool({ connectionString: databaseUrl });
  await pool.query(
    `insert into events (slug, title, status, starts_at, timezone)
     values ($1, 'Browser scoring', 'published', now(), 'Europe/London')`,
    [eventSlug],
  );
  await pool.query(
    `insert into ticket_types (event_slug, id, name, quantity)
     values ($1, 'standard', 'Standard', 4)`,
    [eventSlug],
  );
  await pool.query(
    `insert into tickets (id, event_slug, ticket_type_id, holder_name, order_id) values
       ($1,$3,'standard','First guest',$4),
       ($2,$3,'standard','Second guest',$4)`,
    [firstTicket, secondTicket, eventSlug, `browser-order-${suffix}`],
  );
  await pool.query(
    `insert into event_scoring_settings (event_slug, state, leaderboard_visibility)
     values ($1, 'ready', 'hidden')`,
    [eventSlug],
  );

  for (const [engine, device] of [
    [chromium, devices["Pixel 7"]],
    [webkit, devices["iPhone 15"]],
  ] as const) {
    const browser = await engine.launch();
    const context = await browser.newContext({ ...device });
    const page = await context.newPage();
    await page.goto(`/ticket/${firstTicket}`);
    await clickSessionAction(page, "this is my ticket", "selected for event scoring");

    const secondTab = await context.newPage();
    await secondTab.goto(`/ticket/${secondTicket}`);
    await clickSessionAction(secondTab, "I manage this ticket", "managing this ticket");
    await clickSessionAction(secondTab, "switch to this ticket", "selected for event scoring");

    await page.reload();
    await expect(page.getByRole("link", { name: "← Browser scoring" })).toBeVisible();
    await context.close();
    await browser.close();
  }

  const participants = await pool.query<{ count: string }>(
    `select count(*)::text as count from event_participants where event_slug = $1`,
    [eventSlug],
  );
  expect(participants.rows[0]?.count).toBe("2");
  const browser = await chromium.launch();
  const inAppContext = await browser.newContext({
    ...devices["Pixel 7"],
    userAgent: `${devices["Pixel 7"].userAgent} Instagram`,
  });
  const inAppPage = await inAppContext.newPage();
  await inAppPage.goto(`/ticket/${firstTicket}`);
  await expect(inAppPage.getByText(/Open the link in Safari or Chrome/)).toBeVisible();
  await expect(inAppPage.getByRole("link", { name: "open in browser" })).toBeVisible();
  await expect(inAppPage.getByRole("button", { name: "copy ticket link" })).toBeVisible();
  await inAppContext.close();
  await browser.close();
  await pool.end();
});

async function clickSessionAction(
  page: import("@playwright/test").Page,
  buttonName: string,
  expected: string,
) {
  await expect
    .poll(
      async () => {
        await page.getByRole("button", { name: buttonName }).click();
        return (
          (await page
            .getByRole("status")
            .textContent({ timeout: 250 })
            .catch(() => "")) ?? ""
        );
      },
      { timeout: 15_000 },
    )
    .toContain(expected);
}
