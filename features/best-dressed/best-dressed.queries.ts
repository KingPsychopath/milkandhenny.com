import { queryOptions } from "@tanstack/react-query";
import { getBestDressedLeaderboardFn } from "./best-dressed.functions";

export const bestDressedLeaderboardQuery = queryOptions({
  queryKey: ["public", "best-dressed", "leaderboard"] as const,
  queryFn: () => getBestDressedLeaderboardFn(),
  staleTime: 10_000,
});
