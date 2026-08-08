#!/usr/bin/env tsx
/**
 * Downloads the sentence-embedding model into `models/`, where transformers.js looks by default.
 *
 * Run once locally before using `embedding` scoring in development, and once during the Docker build
 * so the runtime image carries the weights. Deliberately a build step rather than either alternative:
 *
 * - Not committed to git. It is 23MB of weights that will never change; a binary blob that size in
 *   history costs every clone forever, and nothing here needs it to be versioned.
 * - Not downloaded at boot or on first use. A live round would then depend on the Hugging Face CDN
 *   being up, which is a third party in the middle of somebody's party.
 *
 * Build-time network is already how `pnpm install` works, so this adds no new class of dependency.
 *
 * Usage:
 *   pnpm model:same-brain
 *   pnpm model:same-brain --force    (re-download even if the files are present)
 */

import fs from "node:fs";
import path from "node:path";

const REPO = "Xenova/all-MiniLM-L6-v2";
const REVISION = "main";

/**
 * The quantised weights plus the tokeniser. `model_quantized.onnx` is what `dtype: "q8"` resolves to;
 * the full-precision `model.onnx` is four times the size and measurably no better at deciding whether
 * two words are the same word.
 */
const FILES = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "onnx/model_quantized.onnx",
];

const DESTINATION = path.join(process.cwd(), "models", REPO);

async function download(file: string) {
  const target = path.join(DESTINATION, file);
  const force = process.argv.includes("--force");
  if (!force && fs.existsSync(target)) {
    console.log(`  have  ${file} (${(fs.statSync(target).size / 1_048_576).toFixed(1)}MB)`);
    return;
  }

  const url = `https://huggingface.co/${REPO}/resolve/${REVISION}/${file}`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${file}: ${response.status} ${response.statusText}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, bytes);
  console.log(`  saved ${file} (${(bytes.byteLength / 1_048_576).toFixed(1)}MB)`);
}

async function main() {
  console.log(`\nfetching ${REPO} into models/\n`);
  for (const file of FILES) await download(file);
  console.log(
    `\nDone. \`embedding\` scoring will now work offline.\n` +
      `Without these files the game scores on exact matches, which is a complete ruleset.\n`,
  );
}

main().catch((error: unknown) => {
  console.error(`\nCould not fetch the model: ${error instanceof Error ? error.message : error}`);
  console.error("The game still runs — it will score on exact matches until this succeeds.\n");
  process.exit(1);
});
