import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SPELLING_DECKS } from "../features/things/spelling/decks";
import { partyAudioAssetKey, partyDeck } from "../features/things/spelling-party/party-content.server";

const outputDirectory = join(process.cwd(), "assets/party-spelling-audio");
const force = process.argv.includes("--force");
mkdirSync(outputDirectory, { recursive: true });

let generated = 0;
for (const summary of SPELLING_DECKS) {
  const deck = partyDeck(summary.id);
  if (!deck) continue;
  const voice = summary.id === "american-english" ? "Samantha" : "Daniel";
  const workDirectory = mkdtempSync(join(tmpdir(), "spelling-audio-"));
  try {
    for (const word of deck.words) {
      const clips = {
        word: word.speakAs ?? word.word,
        definition: word.definition ?? `No definition is available for ${word.word}.`,
        sentence: word.sentence,
      } as const;
      for (const [kind, text] of Object.entries(clips) as Array<[keyof typeof clips, string]>) {
        const output = join(outputDirectory, partyAudioAssetKey(word, kind));
        if (!force && existsSync(output)) continue;
        const source = join(workDirectory, `${word.id}-${kind}.aiff`);
        execFileSync("say", ["-v", voice, "-r", "175", "-o", source, "--", text]);
        execFileSync("ffmpeg", ["-loglevel", "error", "-y", "-i", source, "-ar", "24000", "-ac", "1", "-b:a", "48k", output]);
        generated += 1;
      }
    }
  } finally {
    rmSync(workDirectory, { recursive: true, force: true });
  }
}

console.log(`Generated ${generated} spelling audio clips.`);
