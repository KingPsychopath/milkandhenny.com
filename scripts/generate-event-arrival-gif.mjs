import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { promisify } from "node:util";
import { dirname, join } from "node:path";
import sharp from "sharp";

const run = promisify(execFile);

const WIDTH = 240;
const HEIGHT = 135;
const FRAME_COUNT = 42;
const FINAL_HOLD_FRAMES = 5;
const OUTPUT_DIR = new URL("../public/media/", import.meta.url);
const OUTPUT_GIF = new URL("after-school-club-arrival.gif", OUTPUT_DIR);
const OUTPUT_POSTER = new URL("after-school-club-arrival-poster.png", OUTPUT_DIR);

const colour = {
  paper: "#fafaf9",
  stone100: "#f5f5f4",
  stone200: "#e7e5e4",
  stone300: "#d6d3d1",
  stone400: "#a8a29e",
  stone500: "#78716c",
  ink: "#1c1917",
  amber: "#b45309",
  cream: "#fef3c7",
  skin: "#6f3f2f",
  skinDark: "#4a281f",
  shirt: "#7c3f22",
  bag: "#596b61",
};

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function ease(value) {
  const progress = clamp(value);
  return progress * progress * (3 - 2 * progress);
}

function mix(from, to, progress) {
  return from + (to - from) * ease(progress);
}

function rect(x, y, width, height, fill, extra = "") {
  return `<rect x="${x}" y="${y}" width="${width}" height="${height}" fill="${fill}" ${extra}/>`;
}

function line(x1, y1, x2, y2, stroke, width = 1, extra = "") {
  return `<path d="M${x1} ${y1}L${x2} ${y2}" fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linecap="square" ${extra}/>`;
}

function drawBackground() {
  const pieces = [
    rect(0, 0, WIDTH, 91, colour.stone100),
    rect(0, 91, WIDTH, 44, colour.stone200),
    rect(0, 89, WIDTH, 3, colour.stone300),
    rect(12, 27, 45, 62, colour.paper),
    rect(15, 34, 15, 19, colour.stone200),
    rect(34, 34, 17, 19, colour.stone200),
    rect(12, 27, 45, 3, colour.stone400),
    rect(20, 62, 3, 27, colour.stone300),
    rect(46, 62, 3, 27, colour.stone300),
    rect(7, 82, 12, 7, colour.stone300),
    rect(22, 82, 12, 7, colour.stone300),
    rect(38, 82, 12, 7, colour.stone300),
    rect(62, 53, 3, 36, colour.stone300),
    rect(69, 49, 3, 40, colour.stone300),
    rect(76, 57, 3, 32, colour.stone300),
    rect(211, 19, 2, 34, colour.stone300),
    rect(218, 25, 2, 28, colour.stone300),
    rect(224, 14, 2, 39, colour.stone300),
    `<circle cx="191" cy="25" r="11" fill="${colour.cream}"/>`,
    `<circle cx="191" cy="25" r="6" fill="${colour.amber}" opacity=".22"/>`,
    line(0, 91, WIDTH, 91, colour.stone500),
  ];

  for (let x = 0; x < WIDTH; x += 24) {
    pieces.push(line(x, 102, x + 12, 102, colour.stone400));
    pieces.push(line(x + 7, 118, x + 21, 118, colour.stone400));
  }
  return pieces.join("");
}

function drawVenue() {
  return [
    rect(181, 42, 48, 49, colour.stone500),
    rect(185, 46, 40, 45, colour.paper),
    rect(193, 58, 24, 33, colour.ink),
    rect(196, 61, 18, 30, colour.stone500),
    rect(199, 65, 12, 26, colour.ink),
    rect(181, 35, 48, 8, colour.amber),
    rect(185, 31, 40, 4, colour.cream),
    rect(190, 22, 30, 9, colour.paper),
    rect(190, 22, 30, 1, colour.stone500),
    rect(190, 30, 30, 1, colour.stone500),
    `<text x="205" y="27.4" text-anchor="middle" fill="${colour.ink}" font-family="ui-monospace, SFMono-Regular, Menlo, monospace" font-size="4.4" letter-spacing=".25">STUDIO</text>`,
    rect(176, 91, 58, 3, colour.stone400),
    rect(199, 80, 3, 3, colour.cream),
  ].join("");
}

function drawMarker(x, height, accent) {
  const top = 91 - height;
  return [
    rect(x, top + 4, 10, height - 4, colour.stone500),
    `<rect x="${x - 2}" y="${top}" width="14" height="8" rx="4" fill="${accent}"/>`,
    rect(x + 3, top + 8, 4, height - 12, colour.stone300),
    rect(x + 4, top + 10, 2, height - 16, colour.stone100),
  ].join("");
}

function drawCharacter({ x, footY, walking, jumping, waving, frame }) {
  const step = walking ? (Math.floor(frame / 2) % 2 === 0 ? 1 : -1) : 0;
  const wave = waving ? Math.sin(frame / 2.2) * 5 : 0;
  const parts = [
    `<ellipse cx="${x}" cy="${footY + 2}" rx="9" ry="2" fill="${colour.stone500}" opacity=".28"/>`,
    `<g transform="translate(${x} ${footY})">`,
    `<path d="M-8 -21L-13 -12L-8 -10Z" fill="${colour.bag}"/>`,
    `<path d="M-7 -21L-2 -24L3 -19L0 -11L-7 -13Z" fill="${colour.bag}"/>`,
    `<path d="M${-5 + step} -10L${-7 - step} -1L${-2 - step} -1L${1 + step} -9Z" fill="${colour.ink}"/>`,
    `<path d="M${4 - step} -10L${2 + step} -1L${7 + step} -1L${9 - step} -9Z" fill="${colour.ink}"/>`,
    `<path d="M${-8 - step} -1L${-2 - step} -1L${-1 - step} 1L${-8 - step} 1Z" fill="${colour.ink}"/>`,
    `<path d="M${2 + step} -1L${8 + step} -1L${10 + step} 1L${3 + step} 1Z" fill="${colour.ink}"/>`,
    `<rect x="-7" y="-27" width="13" height="16" rx="3" fill="${colour.shirt}"/>`,
    `<rect x="-4" y="-25" width="7" height="4" rx="1" fill="${colour.amber}" opacity=".8"/>`,
    `<path d="M-7 -23L-12 -17L-9 -15L-4 -20Z" fill="${colour.skin}"/>`,
    `<path d="M5 -23L${8 + wave} -17L${11 + wave} -19L8 -26Z" fill="${colour.skin}"/>`,
    `<circle cx="0" cy="-34" r="8" fill="${colour.skin}"/>`,
    `<path d="M-8 -34C-8 -43 7 -45 9 -35L5 -37L3 -41L0 -38L-3 -42L-6 -38Z" fill="${colour.skinDark}"/>`,
    `<rect x="-5" y="-33" width="2" height="2" fill="${colour.ink}"/>`,
    `<rect x="3" y="-33" width="2" height="2" fill="${colour.ink}"/>`,
    `<path d="M-2 -29L3 -29" fill="none" stroke="${colour.skinDark}" stroke-width="1" stroke-linecap="square"/>`,
    `<rect x="-6" y="-43" width="12" height="3" rx="1" fill="${colour.amber}"/>`,
    `<rect x="2" y="-44" width="6" height="2" fill="${colour.amber}"/>`,
    `</g>`,
  ];

  if (jumping) {
    const airborne = [
      `<path d="M${x - 8} ${footY - 9}L${x - 14} ${footY - 5}L${x - 10} ${footY - 2}" fill="none" stroke="${colour.ink}" stroke-width="3" stroke-linecap="square"/>`,
      `<path d="M${x + 4} ${footY - 9}L${x + 10} ${footY - 4}L${x + 14} ${footY - 7}" fill="none" stroke="${colour.ink}" stroke-width="3" stroke-linecap="square"/>`,
    ];
    parts.splice(2, 6, ...airborne);
  }
  if (waving) {
    parts.push(line(x + 8, footY - 17, x + 12 + wave, footY - 28, colour.skin, 3));
    parts.push(line(x + 12 + wave, footY - 28, x + 15 + wave, footY - 32, colour.skin, 2));
  }
  return parts.join("");
}

function drawSparkles(x, y, progress) {
  const opacity = Math.sin(progress * Math.PI);
  return [
    `<path d="M${x - 12} ${y - 8}v6M${x - 15} ${y - 5}h6" stroke="${colour.amber}" stroke-width="1" opacity="${opacity}"/>`,
    `<path d="M${x + 14} ${y + 2}v7M${x + 11} ${y + 5}h6" stroke="${colour.stone500}" stroke-width="1" opacity="${opacity}"/>`,
  ].join("");
}

function frameSvg(frame) {
  const progress = clamp(frame / (FRAME_COUNT - 1));
  let x = 18;
  let footY = 96;
  let walking = true;
  let jumping = false;
  let waving = false;
  let sparks = "";

  if (progress < 0.18) {
    x = mix(18, 54, progress / 0.18);
  } else if (progress < 0.34) {
    x = mix(54, 72, (progress - 0.18) / 0.16);
    walking = false;
  } else if (progress < 0.53) {
    const jumpProgress = (progress - 0.34) / 0.19;
    x = mix(72, 105, jumpProgress);
    footY = 96 - Math.sin(jumpProgress * Math.PI) * 25;
    walking = false;
    jumping = true;
    sparks = drawSparkles(x, footY, jumpProgress);
  } else if (progress < 0.68) {
    x = mix(105, 134, (progress - 0.53) / 0.15);
  } else if (progress < 0.85) {
    const jumpProgress = (progress - 0.68) / 0.17;
    x = mix(134, 169, jumpProgress);
    footY = 96 - Math.sin(jumpProgress * Math.PI) * 23;
    walking = false;
    jumping = true;
    sparks = drawSparkles(x, footY, jumpProgress);
  } else if (progress < 0.92) {
    x = mix(169, 198, (progress - 0.85) / 0.07);
  } else {
    x = 201;
    walking = false;
    waving = true;
  }

  const scene = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" viewBox="0 0 ${WIDTH} ${HEIGHT}">`,
    `<title>A little illustrated arrival at the studio</title>`,
    drawBackground(),
    drawVenue(),
    drawMarker(76, 18, colour.amber),
    drawMarker(138, 22, colour.cream),
    sparks,
    drawCharacter({ x, footY, walking, jumping, waving, frame }),
    `</svg>`,
  ];
  return scene.join("");
}

async function renderPng(svg, output) {
  await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toFile(output);
}

await mkdir(dirname(OUTPUT_GIF.pathname), { recursive: true });
const temporaryDirectory = await mkdtemp(join(process.env.TMPDIR ?? "/tmp", "milk-henny-arrival-"));

try {
  const framePaths = [];
  for (let frame = 0; frame < FRAME_COUNT; frame += 1) {
    const path = join(temporaryDirectory, `frame-${String(frame).padStart(3, "0")}.png`);
    await renderPng(frameSvg(frame), path);
    framePaths.push(path);
  }

  const finalFrame = join(temporaryDirectory, "frame-final.png");
  await renderPng(frameSvg(FRAME_COUNT - 1), finalFrame);
  for (let hold = 0; hold < FINAL_HOLD_FRAMES; hold += 1) framePaths.push(finalFrame);

  await renderPng(frameSvg(FRAME_COUNT - 1), OUTPUT_POSTER.pathname);
  await run("magick", [
    "-delay",
    "12",
    ...framePaths,
    "-loop",
    "0",
    "-layers",
    "Optimize",
    OUTPUT_GIF.pathname,
  ]);

  const gif = await stat(OUTPUT_GIF.pathname);
  const poster = await stat(OUTPUT_POSTER.pathname);
  console.log(
    JSON.stringify({
      gif: { path: OUTPUT_GIF.pathname, bytes: gif.size, frames: framePaths.length },
      poster: { path: OUTPUT_POSTER.pathname, bytes: poster.size },
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
