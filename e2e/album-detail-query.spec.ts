import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("album and photo pages share a hydrated detail view", async ({ page, request }) => {
  const pool = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const slug = `query-album-${Date.now()}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(
      `insert into gallery_albums
       (slug, title, album_date, cover_photo_id, status, updated_at)
       values ($1, 'Query Album Journey', '2026-09-26', 'cover', 'published', now())`,
      [slug],
    );
    await client.query(
      `insert into gallery_album_photos
       (album_slug, photo_id, position, width, height, version, widths, placeholder, title)
       values ($1, 'cover', 0, 100, 100, 'v1', array[100], '{"color":"#777777"}'::jsonb,
               'Query Cover Photo')`,
      [slug],
    );
    await client.query("commit");

    const albumResponse = await request.get(`/pics/${slug}`);
    expect(albumResponse.ok()).toBe(true);
    expect(await albumResponse.text()).toContain("Query Album Journey");
    const photoResponse = await request.get(`/pics/${slug}/cover`);
    expect(photoResponse.ok()).toBe(true);
    expect(await photoResponse.text()).toContain("Query Cover Photo");

    await page.goto(`/pics/${slug}`);
    await waitForAppHydration(page);
    await page.getByRole("link", { name: "Open Photo 1 from Query Album Journey" }).click();
    await expect(page.getByRole("heading", { name: "Query Cover Photo" })).toBeVisible();
    await page.goBack();
    await expect(page.getByRole("heading", { name: "Query Album Journey" })).toBeVisible();
  } finally {
    await client.query("rollback");
    client.release();
    await pool.query("delete from gallery_albums where slug = $1", [slug]);
    await pool.end();
  }
});
