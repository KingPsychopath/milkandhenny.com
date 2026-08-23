import { createFileRoute } from "@tanstack/react-router";
import { getBestDressedSnapshotFn } from "@/features/best-dressed/best-dressed.functions";
import { BestDressedClient } from "@/features/best-dressed/ui/BestDressedClient";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/best-dressed")({
  component: BestDressedPage,
  loader: () => getBestDressedSnapshotFn(),
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
