import { createFileRoute } from "@tanstack/react-router";
import { getBestDressedSnapshotFn } from "@/features/best-dressed/best-dressed.functions";
import { BestDressedClient } from "@/features/best-dressed/ui/BestDressedClient";
import { bestDressedLeaderboardQuery } from "@/features/best-dressed/best-dressed.queries";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/best-dressed")({
  component: BestDressedPage,
  loader: async ({ context }) => {
    const snapshot = await getBestDressedSnapshotFn();
    context.queryClient.setQueryData(bestDressedLeaderboardQuery.queryKey, {
      leaderboard: snapshot.leaderboard,
      totalVotes: snapshot.totalVotes,
      session: snapshot.session,
      codeRequired: snapshot.codeRequired,
      openUntil: snapshot.openUntil,
    });
    return {
      session: snapshot.session,
      voteToken: snapshot.voteToken,
      votedFor: snapshot.votedFor,
      codeRequired: snapshot.codeRequired,
      openUntil: snapshot.openUntil,
    };
  },
  head: () =>
    buildSeoHead({
      title: "Best dressed — Milk & Henny",
      description: "Vote for the best dressed person at this Milk & Henny event.",
      path: "/best-dressed",
      robots: "noindex, nofollow",
    }),
});

function BestDressedPage() {
  const snapshot = Route.useLoaderData();
  return <BestDressedClient initialSnapshot={snapshot} />;
}
