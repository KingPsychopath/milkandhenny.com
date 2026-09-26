import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("public word detail hydrates and private share redirects retain the token", async ({
  page,
  request,
}) => {
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const publicSlug = `query-word-${Date.now()}`;
  const privateSlug = `${publicSlug}-private`;
  try {
    for (const [slug, visibility] of [
      [publicSlug, "public"],
      [privateSlug, "private"],
    ] as const) {
      await pool.query(
        `insert into words
         (slug, title, type, body_key, visibility, markdown, created_at, updated_at,
          published_at, reading_time, reading_time_version, author_role, revision)
         values ($1, $2, 'note', $3, $4, 'A hydrated word body.', now(), now(),
                 $5, 1, 2, 'admin', 1)`,
        [
          slug,
          visibility === "public" ? "Hydrated Word Journey" : "Private Word Journey",
          `words/${slug}`,
          visibility,
          visibility === "public" ? new Date() : null,
        ],
      );
    }

    const response = await request.get(`/words/${publicSlug}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("A hydrated word body.");
    await page.goto(`/words/${publicSlug}`);
    await waitForAppHydration(page);
    await expect(page.getByRole("heading", { name: "Hydrated Word Journey" })).toBeVisible();

    await page.goto(`/words/${privateSlug}?share=preserved-token`);
    await expect(page).toHaveURL(new RegExp(`/vault/${privateSlug}\\?share=preserved-token`));
  } finally {
    await pool.query("delete from words where slug = any($1::text[])", [[publicSlug, privateSlug]]);
    await pool.end();
  }
});
