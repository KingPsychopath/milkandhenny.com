import { createFileRoute } from "@tanstack/react-router";
import { getBestDressedSnapshotFn } from "@/features/best-dressed/best-dressed.functions";
import { BestDressedClient } from "@/features/best-dressed/ui/BestDressedClient";

export const Route = createFileRoute("/best-dressed")({
  component: BestDressedPage,
  loader: () => getBestDressedSnapshotFn(),
  head: () => ({ meta: [{ title: "Best dressed" }] }),
});

function BestDressedPage() {
  const snapshot = Route.useLoaderData();
  return <BestDressedClient initialSnapshot={snapshot} />;
}
