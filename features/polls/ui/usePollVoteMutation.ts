import { useMutation, useQueryClient } from "@tanstack/react-query";
import { submitPollVoteFn } from "../polls.functions";
import { pollQueryKeys } from "../polls.queries";

export function usePollVoteMutation(slug: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ voterId, selections }: { voterId: string; selections: string[] }) =>
      submitPollVoteFn({ data: { slug, voterId, selections } }),
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: pollQueryKeys.deviceVote(slug) });
    },
    onSuccess: (vote) => {
      queryClient.setQueryData(pollQueryKeys.deviceVote(slug), vote);
      void queryClient
        .invalidateQueries({ queryKey: pollQueryKeys.public(slug) })
        .catch(() => undefined);
    },
  });
}
