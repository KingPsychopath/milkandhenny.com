import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import sharp from "sharp";

const run = promisify(execFile);

const WIDTH = 480;
const HEIGHT = 132;
const CHARACTER_SIZE = 96;
const SURFACE_Y = 113;
const WALK_FRAMES = 24;
const HOLD_FRAMES = 8;
const FRAME_COUNT = WALK_FRAMES + HOLD_FRAMES;
const EVENT_MEDIA_DIR = new URL(
  "../public/media/events/after-school-club-2026-09-01/",
  import.meta.url,
);
const EMAIL_MASCOT_DIR = new URL("../public/media/email/mascots/", import.meta.url);
const CHARACTER_SOURCE = new URL("../assets/email/mascots/pixel-kid.png", import.meta.url);
const OUTPUT_GIF = new URL("arrival.gif", EVENT_MEDIA_DIR);
const OUTPUT_POSTER = new URL("arrival-poster.png", EVENT_MEDIA_DIR);
const STATIC_VARIANTS = ["ticket-confirmation", "preparation", "day-of", "feedback"].map(
  (kind) => ({
    kind,
    output: new URL(`${kind}.png`, EMAIL_MASCOT_DIR),
  }),
);

const colour = {
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone500: "#78716c",
  ink: "#292524",
  amber: "#b45309",
  cream: "#fef3c7",
};

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function ease(value) {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
}

function rect(x, y, width, height, fill, opacity) {
  const opacityAttribute = opacity === undefined ? "" : ` opacity="${opacity}"`;
  return `<rect x="${Math.round(x)}" y="${Math.round(y)}" width="${width}" height="${height}" fill="${fill}"${opacityAttribute}/>`;
}

function surfaceSvg({ characterX, icon, destination = false, sparkle = false }) {
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges">`,
    rect(48, 112, 384, 2, colour.stone300),
    rect(48, 114, 384, 1, colour.stone200),
    rect(characterX - 18, 109, 36, 3, colour.amber),
  ];

  if (destination) {
    pieces.push(
      rect(414, 76, 3, 37, colour.stone500),
      rect(417, 76, 18, 8, colour.amber),
      rect(417, 84, 12, 2, colour.cream),
    );
  }

  if (sparkle) {
    pieces.push(
      rect(characterX + 40, 72, 3, 10, colour.amber),
      rect(characterX + 36, 76, 11, 3, colour.amber),
      rect(characterX + 54, 92, 2, 6, colour.stone500),
      rect(characterX + 52, 94, 6, 2, colour.stone500),
    );
  }

  if (icon === "ticket-confirmation") {
    pieces.push(
      rect(315, 74, 48, 27, colour.amber),
      rect(319, 78, 40, 19, colour.cream),
      rect(326, 83, 10, 10, colour.amber),
      rect(330, 85, 2, 6, colour.cream),
      rect(328, 87, 6, 2, colour.cream),
      rect(345, 84, 3, 3, colour.stone500),
      rect(352, 84, 3, 3, colour.stone500),
      rect(345, 90, 10, 2, colour.stone500),
    );
  }

  if (icon === "preparation") {
    pieces.push(
      rect(318, 76, 16, 16, colour.amber),
      rect(322, 80, 8, 8, colour.cream),
      rect(342, 76, 16, 16, colour.amber),
      rect(346, 80, 8, 8, colour.cream),
      rect(324, 82, 4, 4, colour.ink),
      rect(348, 82, 4, 4, colour.ink),
      rect(324, 88, 4, 2, colour.ink),
      rect(348, 88, 4, 2, colour.ink),
    );
  }

  if (icon === "day-of") {
    pieces.push(
      rect(332, 72, 4, 28, colour.stone500),
      rect(336, 74, 28, 24, colour.amber),
      rect(340, 78, 20, 16, colour.cream),
      rect(348, 82, 4, 12, colour.ink),
      rect(356, 88, 4, 4, colour.amber),
      rect(326, 76, 2, 8, colour.amber),
      rect(322, 79, 10, 2, colour.amber),
    );
  }

  if (icon === "feedback") {
    pieces.push(
      rect(312, 75, 52, 27, colour.stone500),
      rect(316, 79, 44, 19, colour.cream),
      rect(322, 84, 6, 6, colour.amber),
      rect(334, 84, 6, 6, colour.amber),
      rect(346, 84, 6, 6, colour.amber),
      rect(322, 94, 20, 2, colour.stone500),
    );
  }

  pieces.push("</svg>");
  return pieces.join("");
}

async function renderFrame(character, options) {
  const overlay = Buffer.from(surfaceSvg(options));
  const left = Math.round(options.characterX - CHARACTER_SIZE / 2);
  const top = Math.round(SURFACE_Y - CHARACTER_SIZE + (options.bob ?? 0));
  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: overlay, left: 0, top: 0 },
      { input: character, left, top },
    ])
    .png({ palette: true, colours: 64, dither: 0 })
    .toBuffer();
}

function arrivalOptions(frame) {
  const walkingProgress = clamp(frame / (WALK_FRAMES - 1));
  const characterX = 56 + Math.round(336 * ease(walkingProgress));
  return {
    characterX,
    destination: true,
    sparkle: frame >= WALK_FRAMES - 4,
    bob: frame % 4 < 2 ? 0 : -1,
  };
}

async function renderPng(buffer, output) {
  await writeFile(output, buffer);
}

await mkdir(dirname(fileURLToPath(OUTPUT_GIF)), { recursive: true });
await mkdir(fileURLToPath(EMAIL_MASCOT_DIR), { recursive: true });

const character = await sharp(fileURLToPath(CHARACTER_SOURCE)).png().toBuffer();
const temporaryDirectory = await mkdtemp(
  join(process.env.TMPDIR ?? "/tmp", "milk-henny-pixel-email-"),
);

try {
  const framePaths = [];
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const path = join(temporaryDirectory, `frame-${String(frame).padStart(3, "0")}.png`);
    await renderPng(
      await renderFrame(character, arrivalOptions(Math.min(frame, WALK_FRAMES - 1))),
      path,
    );
    framePaths.push(path);
  }

  const poster = await renderFrame(character, {
    ...arrivalOptions(WALK_FRAMES - 1),
    sparkle: true,
    bob: 0,
  });
  await renderPng(poster, fileURLToPath(OUTPUT_POSTER));

  const staticPositions = {
    "ticket-confirmation": 158,
    preparation: 202,
    "day-of": 208,
    feedback: 188,
  };
  for (const variant of STATIC_VARIANTS) {
    const buffer = await renderFrame(character, {
      characterX: staticPositions[variant.kind],
      icon: variant.kind,
      bob: 0,
    });
    await renderPng(buffer, fileURLToPath(variant.output));
  }

  await run("magick", [
    "-delay",
    "10",
    "-dispose",
    "Background",
    ...framePaths,
    "-loop",
    "0",
    "-layers",
    "Optimize",
    fileURLToPath(OUTPUT_GIF),
  ]);

  const gif = await stat(fileURLToPath(OUTPUT_GIF));
  const posterStat = await stat(fileURLToPath(OUTPUT_POSTER));
  const variants = await Promise.all(
    STATIC_VARIANTS.map(async (variant) => ({
      path: fileURLToPath(variant.output),
      bytes: (await stat(fileURLToPath(variant.output))).size,
    })),
  );
  console.log(
    JSON.stringify({
      gif: { path: fileURLToPath(OUTPUT_GIF), bytes: gif.size, frames: framePaths.length },
      poster: { path: fileURLToPath(OUTPUT_POSTER), bytes: posterStat.size },
      variants,
      alpha: true,
      pixelSize: "96px character on a 480px transparent email surface",
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
