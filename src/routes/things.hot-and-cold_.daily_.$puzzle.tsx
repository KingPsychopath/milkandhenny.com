import { createFileRoute, notFound, useNavigate } from "@tanstack/react-router";
import { SoloHotAndCold } from "@/features/things/hot-and-cold/SoloHotAndCold";
import { getHotAndColdPuzzleFn } from "@/features/things/hot-and-cold/hot-and-cold.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";
import "@/features/things/hot-and-cold/hot-and-cold.css";

export const Route = createFileRoute("/things/hot-and-cold_/daily_/$puzzle")({
  loader: async ({ params }) => {
    const puzzle = Number(params.puzzle);
    if (!Number.isSafeInteger(puzzle)) throw notFound();
    try {
      return await getHotAndColdPuzzleFn({ data: { puzzle } });
    } catch {
      throw notFound();
    }
  },
  component: HistoricalHotAndColdRoute,
  head: ({ loaderData }) =>
    buildSeoHead({
      title: `Hot and Cold daily #${loaderData?.puzzle ?? ""} — ${SITE_NAME}`,
      description: "Play a past hidden word. Lower numbers are hotter. Zero finds it.",
      path: `/things/hot-and-cold/daily/${loaderData?.puzzle ?? ""}`,
      image: OG_IMAGES.hotAndCold,
      imageAlt: "Hot and Cold — play a past hidden word",
    }),
});

function HistoricalHotAndColdRoute() {
  const navigate = useNavigate();
  const { judgingVersion, puzzle } = Route.useLoaderData();
  return (
    <SoloHotAndCold
      puzzle={puzzle}
      judgingVersion={judgingVersion}
      onExit={() => void navigate({ to: "/things/hot-and-cold", replace: true })}
    />
  );
}
