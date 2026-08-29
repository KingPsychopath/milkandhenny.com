import { heatBand, HOT_AND_COLD_JUDGING_VERSION } from "./hot-and-cold-rules";
import { rankHotAndColdWord, resolveHotAndColdGuess } from "./hot-and-cold-lexicon.server";

export class HotAndColdInvalidGuessError extends Error {}

export async function scoreHotAndColdGuess(target: string, raw: string) {
  const word = await resolveHotAndColdGuess(raw);
  if (!word) throw new HotAndColdInvalidGuessError("That word is not in our dictionary");
  const rank = await rankHotAndColdWord(target, word);
  return { word, rank, band: heatBand(rank), judgingVersion: HOT_AND_COLD_JUDGING_VERSION };
}
