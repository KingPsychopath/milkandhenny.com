import { mkdir, writeFile } from "node:fs/promises";
import sharp from "sharp";

const outputDirectory = new URL("../public/og/", import.meta.url);

const cards = {
  "default.png": [
    "milk & henny",
    "thoughts, stories, and things worth sharing",
    "the useful drawer",
  ],
  "events.png": ["events", "upcoming nights, games, and gatherings", "milk & henny"],
  "pics.png": ["pics", "photos from the motives", "milk & henny"],
  "words.png": ["words", "essays, recipes, reviews, and notes", "milk & henny"],
  "things.png": ["things+", "small tools, games, and experiments", "made to be used together"],
  "centre.png": ["centre", "trace the maze. reach the middle first.", "maze race"],
  "draw-country.png": ["draw the country", "how close can you get from memory?", "drawing game"],
  "forehead.png": ["forehead", "guess the card from your friends' clues", "party game"],
  "icebreaker.png": ["icebreaker", "reveal a colour. find your people.", "social tool"],
  "hot-and-cold.png": [
    "hot and cold",
    "guess the hidden word. lower numbers are hotter.",
    "daily word game",
    "0 finds it",
  ],
  "liars.png": ["liars", "mafia or imposter. leave the arguing to the room.", "social deduction"],
  "pitch-night.png": ["after school club", "pitches · games · music · food", "milk & henny"],
  "pitch-studio.png": [
    "pitch night studio",
    "make six slides. make the room believe you.",
    "draw · type · paste",
  ],
  "same-brain.png": ["same brain", "answer like everyone else", "try not to be the odd one out"],
  "spelling-bee.png": [
    "spelling bee",
    "hear it. spell it. say it aloud—or type together.",
    "word game",
  ],
  "spelling-party.png": [
    "type together",
    "a multiplayer spelling bee for a shared screen",
    "player phones welcome",
  ],
  "twin.png": ["twin", "two cards. one shared symbol.", "find it first"],
};

function escapeXml(value) {
  return value.replace(
    /[<>&'"]/g,
    (character) =>
      ({
        "<": "&lt;",
        ">": "&gt;",
        "&": "&amp;",
        "'": "&apos;",
        '"': "&quot;",
      })[character],
  );
}

function wrapText(value, maxCharacters) {
  const words = value.split(" ");
  const lines = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (current && next.length > maxCharacters) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function cardSvg([title, subtitle, eyebrow, footer = "1200 × 630"]) {
  const titleLines = wrapText(title, 24);
  const subtitleLines = wrapText(subtitle, 38);
  const titleStart = titleLines.length === 1 ? 282 : 245;
  const titleMarkup = titleLines
    .map(
      (line, index) =>
        `<text x="96" y="${titleStart + index * 82}" class="title">${escapeXml(line)}</text>`,
    )
    .join("");
  const subtitleMarkup = subtitleLines
    .map(
      (line, index) =>
        `<text x="100" y="${420 + index * 34}" class="subtitle">${escapeXml(line)}</text>`,
    )
    .join("");

  return `<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#fafaf9"/>
  <circle cx="1070" cy="70" r="250" fill="#fef3c7"/>
  <circle cx="1070" cy="70" r="170" fill="none" stroke="#b45309" stroke-opacity=".22" stroke-width="2"/>
  <circle cx="1070" cy="70" r="90" fill="none" stroke="#b45309" stroke-opacity=".28" stroke-width="2"/>
  <path d="M0 566H1200" stroke="#d6d3d1" stroke-width="2"/>
  <path d="M870 630L1200 300" stroke="#b45309" stroke-opacity=".16" stroke-width="3"/>
  <path d="M980 630L1200 410" stroke="#1c1917" stroke-opacity=".09" stroke-width="3"/>
  <style>
    .eyebrow { font: 600 20px 'Courier New', monospace; letter-spacing: 4px; fill: #78716c; text-transform: uppercase; }
    .title { font: 700 72px Georgia, serif; fill: #1c1917; }
    .subtitle { font: 400 25px 'Courier New', monospace; fill: #57534e; }
    .brand { font: 700 22px 'Courier New', monospace; letter-spacing: 2px; fill: #1c1917; }
  </style>
  <text x="100" y="100" class="eyebrow">${escapeXml(eyebrow)}</text>
  ${titleMarkup}
  ${subtitleMarkup}
  <text x="100" y="584" class="brand">milk &amp; henny</text>
  <text x="1100" y="584" text-anchor="end" class="eyebrow">${escapeXml(footer)}</text>
</svg>`;
}

await mkdir(outputDirectory, { recursive: true });
await Promise.all(
  Object.entries(cards).map(async ([filename, copy]) => {
    const buffer = await sharp(Buffer.from(cardSvg(copy)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    await writeFile(new URL(filename, outputDirectory), buffer);
  }),
);

console.log(`Generated ${Object.keys(cards).length} OG cards in public/og/`);
