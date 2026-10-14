import { createServer } from "node:http";
import { readFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve, extname, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const architecture = process.argv.includes("--architecture");
const animate = process.argv.includes("--animate");
if (animate && !architecture) throw new Error("Only the architecture diagram has a motion export.");
const directory = dirname(fileURLToPath(import.meta.url));
const root = resolve(directory, "../..");
const { chromium } = await import(process.env.README_PLAYWRIGHT_MODULE || "@playwright/test");
const css = await readFile(join(root, "src/styles/globals.css"), "utf8");
const tokens = css.match(/:root\s*\{[^}]+\}/)?.[0];
const darkTokens = css.match(/\[data-theme="dark"\]\s*\{[^}]+\}/)?.[0];
if (!tokens || (architecture && !darkTokens)) throw new Error("Site theme tokens were not found.");
const source = (
  await readFile(join(directory, architecture ? "architecture.html" : "product-study.html"), "utf8")
).replace("/* site-tokens */", architecture ? `${tokens}\n${darkTokens}` : tokens);
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
  const url = `http://127.0.0.1:${server.address().port}/`;
  const page = await browser.newPage({
    viewport: { width: 1200, height: architecture ? 860 : 680 },
    deviceScaleFactor: architecture ? 2 : 1,
  });
  await page.goto(url);
  await page.evaluate(() => document.fonts.ready);
  if (!architecture) {
    await page.screenshot({ path: join(directory, "milk-and-henny.png") });
  } else {
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await page.screenshot({ path: join(directory, `architecture-${theme}.png`) });
      if (!animate) continue;
      const motion = await browser.newPage({ viewport: { width: 1200, height: 860 } });
      await motion.goto(url);
      await motion.evaluate(() => document.fonts.ready);
      await motion.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      const frameDirectory = join(frames, theme);
      await mkdir(frameDirectory);
      for (let frame = 0; frame < 200; frame++) {
        await motion.evaluate((seconds) => window.renderFrame(seconds), frame / 10);
        await motion.screenshot({
          path: join(frameDirectory, `${String(frame).padStart(3, "0")}.png`),
        });
      }
      await run("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-framerate",
        "10",
        "-i",
        join(frameDirectory, "%03d.png"),
        "-c:v",
        "libx264",
        "-crf",
        "20",
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        join(directory, `architecture-flow-${theme}.mp4`),
      ]);
      await run("ffmpeg", [
        "-y",
        "-v",
        "error",
        "-framerate",
        "10",
        "-i",
        join(frameDirectory, "%03d.png"),
        "-filter_complex",
        "[0:v]scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3",
        "-loop",
        "0",
        join(directory, `architecture-flow-${theme}.gif`),
      ]);
      await motion.close();
    }
  }
  console.log(
    architecture
      ? "Rendered architecture diagrams and requested motion exports."
      : "Rendered README poster.",
  );
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
  await rm(frames, { recursive: true, force: true });
}
