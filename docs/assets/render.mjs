import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const architecture = process.argv.includes("--architecture");
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
// Optional module path lets an artifact runtime render without changing project dependencies.
const { chromium } = await import(process.env.README_PLAYWRIGHT_MODULE || "@playwright/test");
const css = await readFile(join(root, "src/styles/globals.css"), "utf8");
const tokens = css.match(/:root\s*\{[^}]+\}/)?.[0];
const darkTokens = css.match(/\[data-theme="dark"\]\s*\{[^}]+\}/)?.[0];
if (!tokens) throw new Error("Site theme tokens were not found.");
const source = (
  await readFile(join(directory, architecture ? "architecture.html" : "product-study.html"), "utf8")
).replace("/* site-tokens */", architecture ? `${tokens}\n${darkTokens ?? ""}` : tokens);
const server = createServer(async (request, response) => {
  try {
    if (request.url === "/") {
      response.setHeader("Content-Type", "text/html; charset=utf-8");
      response.end(source);
      return;
    }
    const path = resolve(root, `.${decodeURIComponent(request.url.split("?")[0])}`);
    if (!path.startsWith(`${join(root, "public/fonts")}${sep}`) || extname(path) !== ".woff2") {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("Content-Type", "font/woff2");
    response.end(await readFile(path));
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
let browser;
const frames = await mkdtemp(join(tmpdir(), "milk-henny-readme-"));
try {
  browser = await chromium.launch({ headless: true, channel: process.env.README_BROWSER_CHANNEL });
  const page = await browser.newPage({
    viewport: { width: 1200, height: architecture ? 860 : 680 },
    deviceScaleFactor: architecture ? 2 : 1,
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.evaluate(() => document.fonts.ready);
  if (architecture) {
    if (!darkTokens) throw new Error("Site dark theme tokens were not found.");
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({ path: join(directory, `architecture-${theme}.png`) });
    }
    console.log("Rendered light and dark architecture diagrams.");
  } else {
    await page.screenshot({ path: join(directory, "milk-and-henny.png") });
    // 8-second closed loop, with a long readable hold and no flashing or camera movement.
    for (let frame = 0; frame < 96; frame++) {
      await page.evaluate((seconds) => window.renderFrame(seconds), frame / 12);
      await page.screenshot({ path: join(frames, `${String(frame).padStart(3, "0")}.png`) });
    }
    await run("ffmpeg", [
      "-y",
      "-v",
      "error",
      "-framerate",
      "12",
      "-i",
      join(frames, "%03d.png"),
      "-filter_complex",
      "[0:v]split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
      "-loop",
      "0",
      join(directory, "milk-and-henny.gif"),
    ]);
    // Keep four full-size review frames outside the repository when requested.
    if (process.env.README_REVIEW_DIR) {
      await mkdir(process.env.README_REVIEW_DIR, { recursive: true });
      for (const seconds of [0, 2.85, 4.2, 7.9]) {
        await page.evaluate((time) => window.renderFrame(time), seconds);
        await page.screenshot({ path: join(process.env.README_REVIEW_DIR, `${seconds}.png`) });
      }
    }
    console.log("Rendered README poster and motion study.");
  }
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await rm(frames, { recursive: true, force: true });
}
