import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { Pool } from "pg";
import { waitForAppHydration } from "./support/multiplayer";

test("server-renders a poll, records a vote, and restores the device view", async ({
  page,
  request,
}) => {
  const database = new Pool({
    connectionString:
      process.env.TEST_DATABASE_URL ?? "postgres://postgres:test@127.0.0.1:55432/mah_test",
  });
  const id = randomUUID();
  const slug = `query-poll-${id.slice(0, 8)}`;
  try {
    await database.query(
      `insert into polls
       (id, slug, title, intro, question, options, selection_mode,
        result_visibility, show_percentages, status)
       values ($1, $2, 'A night to gather', 'Help us choose.', 'Which day works?',
               $3::jsonb, 'single', 'after_vote', false, 'open')`,
      [
        id,
        slug,
        JSON.stringify([
          { id: "tuesday", label: "Tuesday" },
          { id: "wednesday", label: "Wednesday" },
        ]),
      ],
    );

    const response = await request.get(`/polls/${slug}`);
    expect(response.ok()).toBe(true);
    expect(await response.text()).toContain("Which day works?");

    const hydrationRequests: string[] = [];
    page.on("request", (request) => {
      if (request.resourceType() === "fetch" || request.resourceType() === "xhr")
        hydrationRequests.push(request.url());
    });
    await page.goto(`/polls/${slug}`);
    await waitForAppHydration(page);
    expect(hydrationRequests).toEqual([]);
    await page.getByText("Tuesday", { exact: true }).click();
    await page.getByRole("button", { name: "show me the shape" }).click();
    await expect(page.getByText("Your answer is in.", { exact: false })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The shape so far" })).toBeVisible();

    await page.reload();
    await waitForAppHydration(page);
    await expect(page.getByRole("radio", { name: "Tuesday" })).toBeChecked();
    await expect(page.getByRole("button", { name: "update my answer" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "The shape so far" })).toBeVisible();
  } finally {
    await database.query("delete from polls where id=$1", [id]);
    await database.end();
  }
});
