import { semanticSimilarity } from "../shared/semantic-embeddings.server";
import { heatBand, similarityRank } from "./hot-and-cold-rules";

export async function scoreHotAndColdGuess(target: string, guess: string) {
  if (target === guess) return { rank: 0, band: "found" as const };
  const similarity = await semanticSimilarity(target, guess);
  if (similarity === null) throw new Error("The word scorer is unavailable");
  const rank = similarityRank(similarity);
  return { rank, band: heatBand(rank) };
}
