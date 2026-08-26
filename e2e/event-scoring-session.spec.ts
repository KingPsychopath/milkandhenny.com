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
    await expect(page.getByRole("button", { name: "use this ticket for points" })).toBeVisible();
    await expect(page.getByRole("button", { name: "I manage this ticket" })).toHaveCount(0);
    await clickSessionAction(
      page,
      "use this ticket for points",
      "Event points now go to this ticket",
    );

    const secondTab = await context.newPage();
    await secondTab.goto(`/ticket/${secondTicket}`);
    await clickSessionAction(
      secondTab,
      "use this ticket for points",
      "Event points now go to this ticket",
    );

    await page.reload();
    await expect(page.getByRole("link", { name: "← Browser scoring" })).toBeVisible();
    await expect(page.getByRole("button", { name: "use this ticket for points" })).toBeVisible();
    await expect(
      page.getByText("This switches event points from your other ticket."),
    ).toBeVisible();
    const accountLink = page.getByRole("link", { name: "account", exact: true });
    await expect(accountLink).toHaveAttribute("href", "/access?returnTo=%2Fmy");
    const mobileAccountBox = await page
      .getByRole("link", { name: "account", exact: true })
      .boundingBox();
    const mobileLampBox = await page
      .getByRole("button", { name: /Switch to .* mode/ })
      .boundingBox();
    expect(mobileAccountBox).not.toBeNull();
    expect(mobileLampBox).not.toBeNull();
    expect(boxesOverlap(mobileAccountBox!, mobileLampBox!)).toBe(false);
    await context.close();
    await browser.close();
  }

  const participants = await pool.query<{ count: string }>(
    `select count(*)::text as count from event_participants where event_slug = $1`,
    [eventSlug],
  );
  expect(participants.rows[0]?.count).toBe("2");

  const desktopBrowser = await chromium.launch();
  const desktopContext = await desktopBrowser.newContext({
    viewport: { width: 1365, height: 768 },
  });
  const desktopPage = await desktopContext.newPage();
  await desktopPage.goto(`/ticket/${firstTicket}`);
  const accountBox = await desktopPage
    .getByRole("link", { name: "account", exact: true })
    .boundingBox();
  const lampBox = await desktopPage
    .getByRole("button", { name: /Switch to .* mode/ })
    .boundingBox();
  expect(accountBox).not.toBeNull();
  expect(lampBox).not.toBeNull();
  expect(boxesOverlap(accountBox!, lampBox!)).toBe(false);
  await desktopContext.close();
  await desktopBrowser.close();

  const browser = await chromium.launch();
  const inAppContext = await browser.newContext({
    ...devices["Pixel 7"],
    userAgent: `${devices["Pixel 7"].userAgent} Instagram`,
  });
  const inAppPage = await inAppContext.newPage();
  await inAppPage.goto(`/ticket/${firstTicket}`);
  await expect(inAppPage.getByText("using an in-app browser?")).toBeVisible();
  await expect(inAppPage.getByRole("link", { name: "open in Safari or Chrome" })).toBeVisible();
  await expect(inAppPage.getByRole("button", { name: "copy ticket link" })).toHaveCount(0);
  await inAppContext.close();
  await browser.close();
  await pool.end();
});

function boxesOverlap(
  left: { x: number; y: number; width: number; height: number },
  right: { x: number; y: number; width: number; height: number },
) {
  return !(
    left.x + left.width <= right.x ||
    right.x + right.width <= left.x ||
    left.y + left.height <= right.y ||
    right.y + right.height <= left.y
  );
}

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
