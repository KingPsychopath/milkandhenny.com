import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
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
const GIF_LOOP_VALUE = 2;
const TOTAL_PLAYS = 2;
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
  ["action-arrive.png", 45, null],
  ["action-pour-a.png", 60, "pour-a"],
  ["action-pour-b.png", 75, "pour-b"],
  ["action-grow-a.png", 90, null],
  ["action-grow-b.png", 260, null],
];

const palette = {
  amber: "#b45309",
  amberDark: "#78350f",
  amberLight: "#d97706",
  cream: "#fef3c7",
  ink: "#292524",
  leaf: "#4d7c0f",
  leafDark: "#365314",
  stone300: "#d6d3d1",
  stone500: "#78716c",
};

const pixelFont = {
  A: ["0110", "1001", "1111", "1001", "1001"],
  B: ["1110", "1001", "1110", "1001", "1110"],
  C: ["0111", "1000", "1000", "1000", "0111"],
  D: ["1110", "1001", "1001", "1001", "1110"],
  E: ["1111", "1000", "1110", "1000", "1111"],
  F: ["1111", "1000", "1110", "1000", "1000"],
  H: ["1001", "1001", "1111", "1001", "1001"],
  I: ["111", "010", "010", "010", "111"],
  K: ["1001", "1010", "1100", "1010", "1001"],
  L: ["1000", "1000", "1000", "1000", "1111"],
  M: ["10001", "11011", "10101", "10001", "10001"],
  O: ["0110", "1001", "1001", "1001", "0110"],
  S: ["0111", "1000", "0110", "0001", "1110"],
  T: ["11111", "00100", "00100", "00100", "00100"],
  U: ["1001", "1001", "1001", "1001", "0110"],
};

function pushPixelText(pieces, value, x, y, scale, fill) {
  let cursor = x;
  for (const character of value) {
    if (character === " ") {
      cursor += 3 * scale;
      continue;
    }
    const pattern = pixelFont[character];
    if (!pattern) continue;
    pattern.forEach((row, rowIndex) => {
      [...row].forEach((pixel, columnIndex) => {
        if (pixel === "1") {
          pieces.push(
            `<rect x="${cursor + columnIndex * scale}" y="${y + rowIndex * scale}" width="${scale}" height="${scale}" fill="${fill}"/>`,
          );
        }
      });
    });
    cursor += (pattern[0].length + 1) * scale;
  }
}

function bottleTreeSvg() {
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges">`,
    `<g transform="translate(0 5)">`,
    `<rect x="548" y="231" width="64" height="4" fill="${palette.stone300}"/>`,
    `<rect x="578" y="146" width="5" height="40" fill="${palette.stone500}"/>`,
    `<rect x="568" y="154" width="15" height="5" fill="${palette.stone500}"/>`,
    `<rect x="582" y="163" width="14" height="5" fill="${palette.stone500}"/>`,
    `<rect x="565" y="149" width="15" height="11" fill="${palette.leafDark}"/>`,
    `<rect x="562" y="153" width="11" height="10" fill="${palette.leaf}"/>`,
    `<rect x="583" y="157" width="18" height="11" fill="${palette.leafDark}"/>`,
    `<rect x="591" y="153" width="10" height="9" fill="${palette.leaf}"/>`,
    `<rect x="577" y="140" width="13" height="12" fill="${palette.leafDark}"/>`,
    `<rect x="581" y="136" width="10" height="8" fill="${palette.leaf}"/>`,
    `<path d="M557 203h6v-7h6v-18h6v-5h16v5h6v18h6v7h5v28h-51z" fill="${palette.ink}"/>`,
    `<path d="M562 205h5v-6h7v-18h10v18h7v6h5v22h-34z" fill="${palette.amberLight}"/>`,
    `<rect x="573" y="173" width="14" height="6" fill="${palette.ink}"/>`,
    `<rect x="575" y="175" width="10" height="4" fill="${palette.amberDark}"/>`,
    `<rect x="567" y="208" width="24" height="12" fill="${palette.cream}"/>`,
  ];
  pushPixelText(pieces, "H", 575, 211, 2, palette.amberDark);
  pieces.push(
    `<rect x="566" y="207" width="3" height="17" fill="${palette.amber}"/>`,
    `</g>`,
    "</svg>",
  );
  return Buffer.from(pieces.join(""));
}

function milkJugSvg(phase) {
  const tilt = phase === "pour-b" ? 18 : 10;
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges">`,
    `<g transform="rotate(${tilt} 550 198)">`,
    `<path d="M527 190h6v-7h6v-6h12v6h6v7h6v22h-36z" fill="${palette.ink}"/>`,
    `<path d="M532 192h5v-6h6v-4h6v4h6v6h5v16h-28z" fill="${palette.cream}"/>`,
    `<rect x="542" y="172" width="12" height="6" fill="${palette.ink}"/>`,
    `<rect x="544" y="173" width="8" height="3" fill="${palette.stone500}"/>`,
    `<path d="M557 190h8v4h5v12h-5v4h-8v-5h7v-10h-7z" fill="${palette.ink}"/>`,
    `<path d="M559 194h5v8h-5z" fill="${palette.cream}"/>`,
    `<rect x="536" y="195" width="22" height="9" fill="${palette.amberLight}"/>`,
  ];
  pushPixelText(pieces, "MILK", 538, 196, 1, palette.cream);
  pieces.push(`</g>`);
  if (phase === "pour-a" || phase === "pour-b") {
    pieces.push(
      `<rect x="563" y="202" width="3" height="5" fill="${palette.cream}"/>`,
      `<rect x="567" y="208" width="3" height="5" fill="${palette.cream}"/>`,
      phase === "pour-b"
        ? `<rect x="571" y="214" width="3" height="4" fill="${palette.cream}"/>`
        : "",
    );
  }
  pieces.push("</svg>");
  return Buffer.from(pieces.join(""));
}

function reactionSvg() {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges">
      <rect x="535" y="128" width="4" height="15" fill="${palette.amberLight}"/>
      <rect x="530" y="133" width="14" height="5" fill="${palette.amberLight}"/>
      <rect x="548" y="145" width="5" height="5" fill="${palette.amberLight}"/>
      <rect x="553" y="150" width="5" height="5" fill="${palette.amberLight}"/>
      <rect x="540" y="157" width="6" height="4" fill="${palette.amberLight}"/>
    </svg>`,
  );
}

async function cleanActionSource(source) {
  const sourceKind = source.includes("pour") ? "pour" : "plant";
  const { data, info } = await sharp(`${SOURCE_DIR}/${source}`)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  for (let y = 0; y < info.height; y += 1) {
    for (let x = 0; x < info.width; x += 1) {
      const index = (y * info.width + x) * info.channels;
      const red = data[index];
      const green = data[index + 1];
      const blue = data[index + 2];
      const alpha = data[index + 3];
      const greenLeaf = green > red * 1.25 && green > blue * 1.25 && green > 50;
      const plantCutoff = source === "action-grow-a.png" ? 548 : 550;
      const removeProp =
        alpha > 0 &&
        (sourceKind === "plant"
          ? (x >= plantCutoff && y >= 140) || (x >= 535 && greenLeaf)
          : x >= 545 && y >= 180);
      if (removeProp) data[index + 3] = 0;
    }
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

function overlaySvg(kind) {
  const pieces = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}" shape-rendering="crispEdges">`,
  ];

  if (kind === "studio") {
    pieces.push(
      `<rect x="540" y="113" width="96" height="58" fill="${palette.ink}"/>`,
      `<rect x="546" y="119" width="84" height="46" fill="${palette.cream}"/>`,
      `<rect x="546" y="119" width="84" height="7" fill="${palette.amber}"/>`,
      `<path d="M548 139h11v-5l8 8-8 8v-5h-11z" fill="${palette.amberLight}"/>`,
      `<rect x="576" y="229" width="7" height="11" fill="${palette.stone500}"/>`,
      `<rect x="554" y="229" width="50" height="5" fill="${palette.stone300}"/>`,
      `<rect x="579" y="171" width="7" height="63" fill="${palette.stone500}"/>`,
    );
    pushPixelText(pieces, "STUDIO", 569, 136, 2, palette.ink);
  }

  if (kind === "today") {
    pieces.push(
      `<rect x="480" y="229" width="144" height="6" fill="${palette.stone300}"/>`,
      `<rect x="490" y="96" width="130" height="134" fill="${palette.ink}"/>`,
      `<rect x="496" y="102" width="118" height="128" fill="${palette.cream}"/>`,
      `<rect x="486" y="96" width="134" height="10" fill="${palette.amber}"/>`,
      `<rect x="500" y="115" width="110" height="23" fill="${palette.amberLight}"/>`,
      `<rect x="506" y="121" width="98" height="11" fill="${palette.cream}"/>`,
      `<rect x="500" y="150" width="14" height="22" fill="${palette.stone500}"/>`,
      `<rect x="503" y="153" width="8" height="16" fill="${palette.cream}"/>`,
      `<rect x="518" y="145" width="66" height="85" fill="${palette.ink}"/>`,
      `<rect x="524" y="151" width="54" height="79" fill="${palette.amber}"/>`,
      `<rect x="532" y="158" width="38" height="27" fill="${palette.amberDark}"/>`,
      `<rect x="538" y="164" width="26" height="15" fill="${palette.cream}"/>`,
      `<rect x="565" y="194" width="6" height="6" fill="${palette.cream}"/>`,
      `<rect x="512" y="229" width="78" height="5" fill="${palette.stone500}"/>`,
    );
    pushPixelText(pieces, "STUDIO", 522, 123, 2, palette.ink);
  }

  if (kind === "feedback") {
    pieces.push(
      `<rect x="350" y="119" width="112" height="111" fill="${palette.ink}"/>`,
      `<rect x="358" y="128" width="96" height="94" fill="${palette.cream}"/>`,
      `<rect x="383" y="109" width="42" height="23" fill="${palette.ink}"/>`,
      `<rect x="389" y="113" width="30" height="13" fill="${palette.amber}"/>`,
      `<rect x="365" y="153" width="16" height="12" fill="${palette.amberLight}"/>`,
      `<rect x="388" y="157" width="49" height="3" fill="${palette.stone500}"/>`,
      `<rect x="365" y="174" width="16" height="12" fill="${palette.amberLight}"/>`,
      `<rect x="388" y="178" width="49" height="3" fill="${palette.stone500}"/>`,
      `<rect x="365" y="195" width="16" height="12" fill="${palette.amberLight}"/>`,
      `<rect x="388" y="199" width="49" height="3" fill="${palette.stone500}"/>`,
      `<rect x="450" y="197" width="10" height="26" fill="${palette.ink}" transform="rotate(38 455 210)"/>`,
      `<rect x="453" y="194" width="7" height="12" fill="${palette.amberLight}" transform="rotate(38 456 200)"/>`,
    );
    pushPixelText(pieces, "FEEDBACK", 366, 137, 1, palette.ink);
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
  if (bottle) layers.push({ input: bottleTreeSvg(), left: 0, top: 0 });
  layers.push({ input: `${SOURCE_DIR}/${sprite}`, left, top: CHARACTER_TOP });
  if (overlay) layers.push({ input: overlaySvg(overlay), left: 0, top: 0 });
  await transparentCanvas().composite(layers).png().toFile(output);
}

async function composeActionFrame({ source, milkJug, output }) {
  const sourceBuffer = await cleanActionSource(source);
  const layers = [
    { input: bottleTreeSvg(), left: 0, top: 0 },
    { input: sourceBuffer, left: 0, top: 0 },
  ];
  if (milkJug) layers.push({ input: milkJugSvg(milkJug), left: 0, top: 0 });
  if (source === "action-grow-b.png") layers.push({ input: reactionSvg(), left: 0, top: 0 });
  await transparentCanvas().composite(layers).png().toFile(output);
}

async function buildGif(frames, delays, output) {
  const args = ["-background", "none", "-dispose", "Background"];
  frames.forEach((frame, index) => args.push("-delay", String(delays[index]), frame));
  args.push("-loop", String(GIF_LOOP_VALUE), "-layers", "Optimize", output);
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

  for (const [source, delay, milkJug] of ACTION_SEQUENCE) {
    const output = `${temporaryDirectory}/plant-${String(plantFrames.length).padStart(2, "0")}.png`;
    await composeActionFrame({ source, milkJug, output });
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
      playCount: TOTAL_PLAYS,
      finalHoldCentiseconds: FINAL_HOLD_CENTISECONDS,
    }),
  );
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
