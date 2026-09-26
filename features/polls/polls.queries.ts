import { queryOptions } from "@tanstack/react-query";
import { getPollVoteFn, getPublicPollFn } from "./polls.functions";

export const pollQueryKeys = {
  public: (slug: string) => ["polls", slug, "public"] as const,
  deviceVote: (slug: string) => ["polls", slug, "device-vote"] as const,
};

export function publicPollOptions(slug: string) {
  return queryOptions({
    queryKey: pollQueryKeys.public(slug),
    queryFn: () => getPublicPollFn({ data: { slug } }),
    staleTime: 15_000,
  });
}

/** The voter ID stays in browser storage and never enters an SSR cache or query key. */
export function devicePollVoteOptions(slug: string, voterId: string | null) {
  return queryOptions({
    queryKey: pollQueryKeys.deviceVote(slug),
    queryFn: () => (voterId ? getPollVoteFn({ data: { slug, voterId } }) : Promise.resolve(null)),
    staleTime: Infinity,
  });
}
