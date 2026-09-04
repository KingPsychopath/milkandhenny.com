import { expect, test } from "@playwright/test";
import { Pool } from "pg";

const databaseUrl =
  process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test";

test("viewing tickets in separate tabs never selects a retired points identity", async ({
  page,
  context,
}) => {
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

  try {
    await page.goto(`/ticket/${firstTicket}`);
    await expect(page.getByRole("img", { name: /Your ticket QR code/ })).toBeVisible();
    await expect(page.getByRole("button", { name: "use this ticket for points" })).toHaveCount(0);
    const secondTab = await context.newPage();
    await secondTab.goto(`/ticket/${secondTicket}`);
    await expect(secondTab.getByRole("img", { name: /Your ticket QR code/ })).toBeVisible();
    await page.reload();
    await expect(page.getByText("First guest", { exact: true })).toBeVisible();
    await expect(page.getByRole("region", { name: "event score" })).toHaveCount(0);
    const transactions = await pool.query(
      "select count(*)::integer as count from score_transactions where event_slug = $1",
      [eventSlug],
    );
    expect(transactions.rows[0].count).toBe(0);
  } finally {
    await pool.end();
  }
});

test("retired score and discovery links explain retirement and offer recovery", async ({
  page,
}) => {
  const slug = "retired-scoring-browser-check";
  await page.goto(`/events/${slug}/score`);
  await expect(page.getByRole("heading", { name: "Points have finished." })).toBeVisible();
  await expect(page.getByRole("link", { name: "return to event" })).toHaveAttribute(
    "href",
    `/events/${slug}`,
  );
  await page.goto(`/events/${slug}/discoveries`);
  await expect(page.getByRole("heading", { name: "This points link has finished." })).toBeVisible();
  await expect(page.getByRole("link", { name: "browse games" })).toHaveAttribute("href", "/things");
  const response = await page.request.get(`/api/events/${slug}/score`);
  expect(response.status()).toBe(410);
});
