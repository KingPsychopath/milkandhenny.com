#!/usr/bin/env tsx
/**
 * Downloads the sentence-embedding model into `models/`, where transformers.js looks by default.
 *
 * Hot & Cold uses this model to make distance guesses. It is fetched during development or the
 * Docker build, never during a live round.
 *
 * Usage:
 *   pnpm model:semantic
 *   pnpm model:semantic --force
 */

import fs from "node:fs";
import path from "node:path";

const REPO = "Xenova/all-MiniLM-L6-v2";
const REVISION = "main";
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
  console.log("\nDone. Hot & Cold can now use semantic distance offline.\n");
}

main().catch((error: unknown) => {
  console.error(`\nCould not fetch the model: ${error instanceof Error ? error.message : error}`);
  console.error("Hot & Cold will fall back to its non-semantic path until this succeeds.\n");
  process.exit(1);
});
