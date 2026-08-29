import { heatBand, type HotAndColdJudgingVersion } from "./hot-and-cold-rules";
import { rankHotAndColdWord, resolveHotAndColdGuess } from "./hot-and-cold-lexicon.server";

export class HotAndColdInvalidGuessError extends Error {}

export async function scoreHotAndColdGuess(
  target: string,
  raw: string,
  judgingVersion: HotAndColdJudgingVersion,
) {
  const word = await resolveHotAndColdGuess(raw, judgingVersion);
  if (!word) throw new HotAndColdInvalidGuessError("That word is not in our dictionary");
  const rank = await rankHotAndColdWord(target, word, judgingVersion);
  return { word, rank, band: heatBand(rank), judgingVersion };
}
