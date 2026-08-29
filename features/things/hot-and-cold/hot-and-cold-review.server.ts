import { readFile } from "node:fs/promises";
import path from "node:path";
import type { HotAndColdQualityReport, HotAndColdTargetReview } from "./hot-and-cold-review";
import { HOT_AND_COLD_HUMAN_TRAILS } from "./hot-and-cold-quality.server";
import {
  HOT_AND_COLD_LATEST_JUDGING_VERSION,
  hotAndColdJudgingVersionForPuzzle,
} from "./hot-and-cold-rules";
import {
  hotAndColdPuzzleDate,
  hotAndColdPuzzleNumber,
  hotAndColdTargetForPuzzle,
} from "./hot-and-cold-words.server";

const REVIEW_WINDOW_SIZE = 30;

interface ReviewManifest {
  hints: Record<string, string[]>;
  judgingVersion: string;
  review: Record<string, HotAndColdTargetReview>;
}

function assetRoot() {
  return process.env.NODE_ENV === "production"
    ? path.join(process.cwd(), ".output", "server", "assets", "hot-and-cold")
    : path.join(process.cwd(), "runtime-assets", "hot-and-cold");
}

function parseManifest(value: unknown): ReviewManifest {
  if (
    typeof value !== "object" ||
    value === null ||
    !("judgingVersion" in value) ||
    value.judgingVersion !== HOT_AND_COLD_LATEST_JUDGING_VERSION ||
    !("hints" in value) ||
    typeof value.hints !== "object" ||
    value.hints === null ||
    !("review" in value) ||
    typeof value.review !== "object" ||
    value.review === null
  )
    throw new Error("The Hot and Cold quality manifest is invalid");
  return value as ReviewManifest;
}

async function loadReviewManifest() {
  const file = path.join(assetRoot(), HOT_AND_COLD_LATEST_JUDGING_VERSION, "lexicon.data");
  return parseManifest(JSON.parse(await readFile(file, "utf8")) as unknown);
}

function sameWords(left: readonly string[], right: readonly string[]) {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

export async function getHotAndColdQualityReport(
  date = new Date(),
): Promise<HotAndColdQualityReport> {
  const manifest = await loadReviewManifest();
  const currentPuzzle = hotAndColdPuzzleNumber(date);
  const upcoming = Array.from({ length: REVIEW_WINDOW_SIZE }, (_unused, index) => {
    const puzzle = currentPuzzle + index + 1;
    const target = hotAndColdTargetForPuzzle(puzzle);
    const review = manifest.review[target];
    const human = HOT_AND_COLD_HUMAN_TRAILS[target];
    const hints = manifest.hints[target];
    if (!review || !hints) throw new Error(`Quality evidence is missing for ${target}`);
    const approved = Boolean(
      hotAndColdJudgingVersionForPuzzle(puzzle) === HOT_AND_COLD_LATEST_JUDGING_VERSION &&
      human?.approvalHash &&
      human.approvalHash === review.approvalHash &&
      sameWords(human.approvedHints, hints) &&
      review.comparisons.every(({ passes }) => passes) &&
      !hints.some((hint) => human.forbiddenHints?.includes(hint)),
    );
    return {
      ...review,
      approved,
      date: hotAndColdPuzzleDate(puzzle),
      hints,
      puzzle,
      target,
    };
  });
  return {
    currentPuzzle,
    judgingVersion: manifest.judgingVersion,
    releaseReady: upcoming.every(({ approved }) => approved),
    upcoming,
    windowSize: REVIEW_WINDOW_SIZE,
  };
}
