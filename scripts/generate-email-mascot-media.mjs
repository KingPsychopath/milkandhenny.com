import { execFile } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import sharp from "sharp";

const run = promisify(execFile);
const ROOT = new URL("../", import.meta.url);
const SOURCE_DIR = fileURLToPath(new URL("assets/email/mascots/plant-watering/", ROOT));
const OUTPUT_DIR = fileURLToPath(new URL("public/media/email/mascots/", ROOT));
const PLANT_OUTPUT = `${OUTPUT_DIR}/plant-watering/walking-across.gif`;
const STUDIO_OUTPUT = `${OUTPUT_DIR}/walking-to-studio.gif`;
const TODAY_OUTPUT = `${OUTPUT_DIR}/today.png`;
const FEEDBACK_OUTPUT = `${OUTPUT_DIR}/feedback-card.png`;

const WIDTH = 640;
const HEIGHT = 240;
const CHARACTER_TOP = 135;
const BOTTLE_LEFT = 562;
const BOTTLE_TOP = 194;
const PLAY_COUNT = 1;
const FINAL_HOLD_CENTISECONDS = 260;
const WALKING_SEQUENCE = [
  ["walk-stride-a.png", 52],
  ["walk-passing-a.png", 92],
  ["walk-stride-b.png", 132],
  ["walk-passing-b.png", 172],
  ["walk-stride-c.png", 212],
  ["walk-passing-c.png", 252],
  ["walk-stride-a.png", 292],
  ["walk-passing-a.png", 332],
  ["walk-stride-b.png", 372],
  ["walk-passing-b.png", 412],
  ["walk-stride-c.png", 452],
  ["walk-passing-c.png", 492],
];
const ACTION_SEQUENCE = [
  ["action-arrive.png", 45],
  ["action-pour-a.png", 60],
  ["action-pour-b.png", 75],
  ["action-grow-a.png", 90],
  ["action-grow-b.png", 260],
];

const palette = {
  amber: "#b45309",
  cream: "#fef3c7",
  ink: "#292524",
  stone500: "#78716c",
};

function overlaySvg(kind) {
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges">`,
  ];

  if (kind === "studio") {
    pieces.push(
      `<rect x="552" y="132" width="3" height="108" fill="${palette.stone500}"/>`,
      `<rect x="555" y="136" width="58" height="22" fill="${palette.amber}"/>`,
      `<rect x="560" y="141" width="48" height="12" fill="${palette.cream}"/>`,
      `<rect x="568" y="144" width="3" height="6" fill="${palette.ink}"/>`,
      `<rect x="576" y="144" width="3" height="6" fill="${palette.ink}"/>`,
      `<rect x="584" y="144" width="3" height="6" fill="${palette.ink}"/>`,
    );
  }

  if (kind === "today") {
    pieces.push(
      `<rect x="514" y="143" width="4" height="97" fill="${palette.stone500}"/>`,
      `<rect x="518" y="147" width="58" height="93" fill="${palette.amber}"/>`,
      `<rect x="525" y="157" width="44" height="83" fill="${palette.cream}"/>`,
      `<rect x="541" y="199" width="8" height="41" fill="${palette.ink}"/>`,
      `<rect x="544" y="220" width="3" height="3" fill="${palette.cream}"/>`,
    );
  }

  if (kind === "feedback") {
    pieces.push(
      `<rect x="366" y="151" width="100" height="67" fill="${palette.stone500}"/>`,
      `<rect x="372" y="157" width="88" height="55" fill="${palette.cream}"/>`,
      `<rect x="384" y="170" width="8" height="8" fill="${palette.amber}"/>`,
      `<rect x="400" y="170" width="8" height="8" fill="${palette.amber}"/>`,
      `<rect x="416" y="170" width="8" height="8" fill="${palette.amber}"/>`,
      `<rect x="384" y="189" width="40" height="3" fill="${palette.stone500}"/>`,
    );
  }

  pieces.push("</svg>");
  return Buffer.from(pieces.join(""));
}

function transparentCanvas() {
  return sharp({
    create: {
      width: WIDTH,
      height: HEIGHT,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  });
}

async function composeFrame({ sprite, left, overlay, bottle, output }) {
  const layers = [];
  if (bottle)
    layers.push({ input: `${SOURCE_DIR}/bottle-tree.png`, left: BOTTLE_LEFT, top: BOTTLE_TOP });
  layers.push({ input: `${SOURCE_DIR}/${sprite}`, left, top: CHARACTER_TOP });
  if (overlay) layers.push({ input: overlaySvg(overlay), left: 0, top: 0 });
  await transparentCanvas().composite(layers).png().toFile(output);
}

async function buildGif(frames, delays, output) {
  const args = ["-dispose", "Background"];
  frames.forEach((frame, index) => args.push("-delay", String(delays[index]), frame));
  args.push("-loop", String(PLAY_COUNT), "-layers", "Optimize", output);
  await run("magick", args);
}

await mkdir(`${OUTPUT_DIR}/plant-watering`, { recursive: true });
const temporaryDirectory = await mkdtemp(`${process.env.TMPDIR ?? "/tmp"}/milk-henny-email-`);

try {
  const plantFrames = [];
  const plantDelays = [];
  for (const [sprite, left] of WALKING_SEQUENCE) {
    const output = `${temporaryDirectory}/plant-${String(plantFrames.length).padStart(2, "0")}.png`;
    await composeFrame({ sprite, left, bottle: true, output });
    plantFrames.push(output);
    plantDelays.push(26);
  }

  for (const [source, delay] of ACTION_SEQUENCE) {
    const output = `${temporaryDirectory}/plant-${String(plantFrames.length).padStart(2, "0")}.png`;
    await copyFile(`${SOURCE_DIR}/${source}`, output);
    plantFrames.push(output);
    plantDelays.push(delay);
  }
  await buildGif(plantFrames, plantDelays, PLANT_OUTPUT);

  const studioFrames = [];
  const studioDelays = [];
  for (const [sprite, left] of WALKING_SEQUENCE) {
    const output = `${temporaryDirectory}/studio-${String(studioFrames.length).padStart(2, "0")}.png`;
    await composeFrame({ sprite, left, overlay: "studio", output });
    studioFrames.push(output);
    studioDelays.push(26);
  }
  studioDelays[studioDelays.length - 1] = FINAL_HOLD_CENTISECONDS;
  await buildGif(studioFrames, studioDelays, STUDIO_OUTPUT);

  await composeFrame({
    sprite: "walk-passing-c.png",
    left: 420,
    overlay: "today",
    output: TODAY_OUTPUT,
  });
  await composeFrame({
    sprite: "walk-passing-b.png",
    left: 286,
    overlay: "feedback",
    output: FEEDBACK_OUTPUT,
  });

  console.log(
    JSON.stringify({
      plant: PLANT_OUTPUT,
      studio: STUDIO_OUTPUT,
      today: TODAY_OUTPUT,
      feedback: FEEDBACK_OUTPUT,
      plantFrames: plantFrames.length,
      studioFrames: studioFrames.length,
      playCount: PLAY_COUNT,
      finalHoldCentiseconds: FINAL_HOLD_CENTISECONDS,
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
