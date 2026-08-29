#!/usr/bin/env tsx

import fs from "node:fs";
import path from "node:path";
import { getHotAndColdQualityReport } from "../features/things/hot-and-cold/hot-and-cold-review.server";
import { hotAndColdApprovalHash } from "../features/things/hot-and-cold/hot-and-cold-quality.server";
import {
  HOT_AND_COLD_ASSET_SCHEMA_VERSION,
  HOT_AND_COLD_LATEST_JUDGING_VERSION,
} from "../features/things/hot-and-cold/hot-and-cold-rules";
import { HOT_AND_COLD_TARGETS } from "../features/things/hot-and-cold/hot-and-cold-words.server";
import type { HotAndColdTargetReview } from "../features/things/hot-and-cold/hot-and-cold-review";

interface QualityManifest {
  aliases: Record<string, string>;
  formatVersion: number;
  hints: Record<string, string[]>;
  judgingVersion: string;
  rankPacks: Record<string, { file: string; offset: number }>;
  review: Record<string, HotAndColdTargetReview>;
  trails: Record<string, string[]>;
  words: string[];
}

function argument(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseDate() {
  const value = argument("--date");
  if (!value) return new Date();
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid --date value: ${value}`);
  return date;
}

function parseManifest(value: unknown): QualityManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("formatVersion" in value) ||
    value.formatVersion !== HOT_AND_COLD_ASSET_SCHEMA_VERSION ||
    !("judgingVersion" in value) ||
    value.judgingVersion !== HOT_AND_COLD_LATEST_JUDGING_VERSION ||
    !("words" in value) ||
    !Array.isArray(value.words) ||
    !("aliases" in value) ||
    typeof value.aliases !== "object" ||
    value.aliases === null ||
    !("hints" in value) ||
    typeof value.hints !== "object" ||
    value.hints === null ||
    !("rankPacks" in value) ||
    typeof value.rankPacks !== "object" ||
    value.rankPacks === null ||
    !("review" in value) ||
    typeof value.review !== "object" ||
    value.review === null ||
    !("trails" in value) ||
    typeof value.trails !== "object" ||
    value.trails === null
  )
    throw new Error("The generated Hot and Cold quality manifest is invalid");
  return value as QualityManifest;
}

function verifyGeneratedAssets(manifest: QualityManifest, assetDirectory: string) {
  const failures: string[] = [];
  const words = manifest.words;
  const wordIndex = new Map(words.map((word, index) => [word, index]));
  if (wordIndex.size !== words.length) failures.push("the dictionary contains duplicate words");
  for (const [alias, canonical] of Object.entries(manifest.aliases)) {
    if (wordIndex.has(alias) || !wordIndex.has(canonical))
      failures.push(`ambiguous alias ${alias} → ${canonical}`);
  }
  const packs = new Map<string, Buffer>();
  for (const target of HOT_AND_COLD_TARGETS) {
    const location = manifest.rankPacks[target];
    const hints = manifest.hints[target];
    const trail = manifest.trails[target];
    const review = manifest.review[target];
    if (!location || !hints || !trail || !review) {
      failures.push(`${target}: generated evidence is incomplete`);
      continue;
    }
    let pack = packs.get(location.file);
    if (!pack) {
      pack = fs.readFileSync(path.join(assetDirectory, location.file));
      packs.set(location.file, pack);
    }
    const byteLength = words.length * Uint16Array.BYTES_PER_ELEMENT;
    if (
      location.offset < 0 ||
      location.offset % Uint16Array.BYTES_PER_ELEMENT !== 0 ||
      location.offset + byteLength > pack.byteLength
    ) {
      failures.push(`${target}: rank table points outside ${location.file}`);
      continue;
    }
    const seen = new Uint8Array(words.length);
    const byRank = new Array<string>(30);
    const rankOf = (word: string) => {
      const index = wordIndex.get(word);
      return index === undefined ? -1 : pack.readUInt16LE(location.offset + index * 2);
    };
    for (let index = 0; index < words.length; index += 1) {
      const rank = pack.readUInt16LE(location.offset + index * 2);
      if (rank >= words.length || seen[rank]) {
        failures.push(`${target}: rank table is not a complete permutation`);
        break;
      }
      seen[rank] = 1;
      if (rank < byRank.length) byRank[rank] = words[index];
    }
    if (rankOf(target) !== 0) failures.push(`${target}: target is not rank zero`);
    if (trail.length !== 30 || trail.some((word, index) => word !== byRank[index]))
      failures.push(`${target}: stored top-30 trail does not match ranks`);
    const hintRanks = hints.map(rankOf);
    if (
      hints.length !== 3 ||
      hintRanks.some((rank, index) => rank < 0 || (index > 0 && rank >= hintRanks[index - 1]))
    )
      failures.push(`${target}: official hints are not progressively closer`);
    if (hints.some((hint) => hint.includes(target) || target.includes(hint)))
      failures.push(`${target}: an official hint exposes the target as a substring`);
    const hash = hotAndColdApprovalHash(target, trail, hints);
    if (hash !== review.approvalHash)
      failures.push(`${target}: review hash does not match its trail and hints`);
    if (
      review.top.length !== 30 ||
      review.top.some(({ word, rank }, index) => word !== trail[index] || rank !== index)
    )
      failures.push(`${target}: top-word review does not match its trail`);
    for (const comparison of review.comparisons) {
      const closerRank = rankOf(comparison.closer);
      const fartherRank = rankOf(comparison.farther);
      if (
        closerRank !== comparison.closerRank ||
        fartherRank !== comparison.fartherRank ||
        comparison.passes !== closerRank < fartherRank ||
        !comparison.passes
      )
        failures.push(
          `${target}: comparison failed (${comparison.closer} #${closerRank} < ${comparison.farther} #${fartherRank})`,
        );
    }
  }
  return failures;
}

async function main() {
  const assetDirectory = path.join(
    process.cwd(),
    "runtime-assets",
    "hot-and-cold",
    HOT_AND_COLD_LATEST_JUDGING_VERSION,
  );
  const manifest = parseManifest(
    JSON.parse(fs.readFileSync(path.join(assetDirectory, "lexicon.data"), "utf8")) as unknown,
  );
  const generatedFailures = verifyGeneratedAssets(manifest, assetDirectory);
  const report = await getHotAndColdQualityReport(parseDate());
  const approvalFailures = report.upcoming
    .filter(({ approved }) => !approved)
    .map(({ puzzle, target }) => `daily #${puzzle} (${target}) needs renewed human approval`);
  const failures = [...generatedFailures, ...approvalFailures];
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ ...report, failures }, null, 2));
  } else if (failures.length > 0) {
    console.error(`Hot and Cold quality check failed:\n\n${failures.join("\n")}`);
  } else {
    const first = report.upcoming[0];
    const last = report.upcoming.at(-1);
    console.log(
      `Hot and Cold ${report.judgingVersion} is complete and approved for daily #${first.puzzle}–#${last?.puzzle} (${first.date}–${last?.date})`,
    );
  }
  if (failures.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
