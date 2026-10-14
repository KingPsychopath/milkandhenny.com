import { chromium, expect } from "@playwright/test";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { setTimeout as delay } from "node:timers/promises";
import { createPairsGame } from "../../features/things/pairs/pairs-rules.ts";

const run = promisify(execFile);
const directory = dirname(fileURLToPath(import.meta.url));
const baseURL = process.env.README_DEMO_URL || "http://127.0.0.1:4179";
if (!["127.0.0.1", "localhost"].includes(new URL(baseURL).hostname))
  throw new Error("Capture must use a local app, never a production session.");
const css = await readFile(join(directory, "../../src/styles/globals.css"), "utf8");
const tokens = css.match(/:root\s*\{[^}]+\}/)?.[0];
if (!tokens) throw new Error("Site theme tokens were not found.");
const shell = (await readFile(join(directory, "demo-frame.html"), "utf8")).replace(
  "/* site-tokens */",
  tokens,
);
const browser = await chromium.launch({
  headless: true,
  channel: process.env.README_BROWSER_CHANNEL,
});
const frames = await mkdtemp(join(tmpdir(), "milk-henny-pairs-"));
let recording;
let stopRecording = false;
let captureFailure;
try {
  const page = await browser.newPage({
    viewport: { width: 1000, height: 900 },
    deviceScaleFactor: 1,
  });
  await page.route(`${baseURL}/__readme_demo`, (route) =>
    route.fulfill({ contentType: "text/html", body: shell }),
  );
  await page.goto(`${baseURL}/__readme_demo`);
  const app = await browser.newPage({
    viewport: { width: 1000, height: 780 },
    deviceScaleFactor: 1,
  });
  await app.goto(`${baseURL}/things/pairs`);
  await app.locator("html[data-app-hydrated]").waitFor({ state: "attached", timeout: 60_000 });
  await page.evaluate(() => document.fonts.ready);
  await app.evaluate(() => document.fonts.ready);
  // Ordinary UI setup. No storage seeding, response fixtures, or replacement game engine.
  await app.getByRole("button", { name: "with friends one device" }).click();
  await app.getByRole("button", { name: "3 a quick hand" }).click();
  await app.getByLabel("player 1", { exact: true }).fill("Alex");
  await app.getByLabel("player 2", { exact: true }).fill("Jo");
  await app.getByRole("button", { name: "deal us in" }).click();
  await expect(app.getByRole("heading", { name: "Alex’s turn." })).toBeVisible();
  await app.evaluate(() => window.scrollTo(0, 0));
  const readRecord = () =>
    app.evaluate(() => JSON.parse(sessionStorage.getItem("things:pairs:table:v1")).record);
  const record = await readRecord();
  // Read the actual random shuffle only to choose the two demonstration clicks.
  const deal = createPairsGame(record.seed, record.pairCount, record.names);
  const partner = deal.cards.findIndex(
    (card, index) => index > 0 && card.rank === deal.cards[0].rank,
  );
  const step = (id, detail) =>
    page.evaluate(
      ({ id, detail }) => {
        document.querySelector("[aria-current]")?.removeAttribute("aria-current");
        document.getElementById(id).setAttribute("aria-current", "step");
        document.getElementById("detail").textContent = detail;
      },
      { id, detail },
    );
  for (const [index, id, detail] of [
    [0, "play", "one device · two players"],
    [1, "refresh", "a real page reload"],
    [2, "resume", "same score · same cleared pair"],
  ]) {
    await step(id, detail);
    await page.screenshot({ path: join(frames, `caption-${index}.png`), omitBackground: true });
  }
  const start = performance.now();
  const at = async (seconds) => delay(Math.max(0, seconds * 1000 - (performance.now() - start)));
  // Capture the live viewport on a fixed cadence while real interactions and navigation occur.
  recording = (async () => {
    for (let frame = 0; frame < 180; frame++) {
      await at(frame / 10);
      if (stopRecording) break;
      await app.screenshot({ path: join(frames, `${String(frame).padStart(3, "0")}.png`) });
    }
  })().catch((cause) => {
    captureFailure = cause;
  });
  await at(1.2);
  await app.getByRole("button", { name: "Card 1: face down", exact: true }).click();
  await at(2.6);
  await app.getByRole("button", { name: `Card ${partner + 1}: face down`, exact: true }).click();
  await expect(app.getByRole("heading", { name: "A pair. All yours." })).toBeVisible();
  await at(4.8);
  await app.getByRole("button", { name: "Alex, go again" }).click();
  await expect(app.locator(".pairs-scores li").first()).toContainText("1pair");
  await expect(app.getByRole("button", { name: /face down/ })).toHaveCount(4);
  const before = await readRecord();
  await at(7);
  await step("refresh", "a real page reload");
  await at(7.5);
  await app.evaluate(() => window.location.reload());
  await app.locator("html[data-app-hydrated]").waitFor({ state: "attached" });
  await expect(app.getByRole("button", { name: "resume saved table" })).toBeVisible();
  await at(10.5);
  await step("resume", "same score · same cleared pair");
  await app.getByRole("button", { name: "resume saved table" }).click();
  await app.evaluate(() => window.scrollTo(0, 0));
  await expect(app.getByRole("heading", { name: "Alex’s turn." })).toBeVisible();
  await expect(app.locator(".pairs-scores li").first()).toContainText("1pair");
  await expect(app.getByRole("button", { name: /face down/ })).toHaveCount(4);
  expect(await readRecord()).toEqual(before);
  await at(13);
  await app.screenshot({ path: join(frames, "poster.png") });
  await recording;
  if (captureFailure) throw captureFailure;
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-framerate",
    "10",
    "-i",
    join(frames, "%03d.png"),
    "-i",
    join(frames, "caption-0.png"),
    "-i",
    join(frames, "caption-1.png"),
    "-i",
    join(frames, "caption-2.png"),
    "-filter_complex",
    "[0:v]pad=1000:900:0:65[base];[base][1:v]overlay=0:0:enable='lt(t,7)'[a];[a][2:v]overlay=0:0:enable='between(t,7,10.5)'[b];[b][3:v]overlay=0:0:enable='gte(t,10.5)'[v]",
    "-map",
    "[v]",
    "-c:v",
    "libx264",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    join(directory, "pairs-recovery.mp4"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    join(directory, "pairs-recovery.mp4"),
    "-filter_complex",
    "[0:v]scale=850:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
    "-loop",
    "0",
    join(directory, "pairs-recovery.gif"),
  ]);
  await run("ffmpeg", [
    "-y",
    "-v",
    "error",
    "-i",
    join(frames, "poster.png"),
    "-i",
    join(frames, "caption-2.png"),
    "-filter_complex",
    "[0:v]pad=1000:900:0:65[base];[base][1:v]overlay=0:0[v]",
    "-map",
    "[v]",
    "-frames:v",
    "1",
    join(directory, "pairs-recovery.png"),
  ]);
  await writeFile(
    join(directory, "pairs-recovery.json"),
    JSON.stringify(
      {
        sourceCommit: process.env.README_DEMO_COMMIT || "unrecorded",
        route: "/things/pairs",
        environment: "isolated local development",
        durationSeconds: 18,
        setup: { players: ["Alex", "Jo"], pairCount: 3 },
        verified: [
          "one pair credited",
          "four unmatched cards remain",
          "real page reload",
          "resume restores exact command journal",
          "score and cleared pair preserved",
        ],
        presentation:
          "Direct live-page capture with editorial captions composited outside the application; no app responses or state were mocked. Setup before recording; two match clicks selected from the actual generated shuffle.",
      },
      null,
      2,
    ) + "\n",
  );
  await run("pnpm", ["exec", "oxfmt", "--write", join(directory, "pairs-recovery.json")]);
  console.log("Captured Pairs gameplay and verified exact recovery after reload.");
} finally {
  stopRecording = true;
  await recording;
  await browser.close();
  await rm(frames, { recursive: true, force: true });
}
