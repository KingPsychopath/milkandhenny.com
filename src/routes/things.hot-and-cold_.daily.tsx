import { createFileRoute, useNavigate } from "@tanstack/react-router";

import { SoloHotAndCold } from "@/features/things/hot-and-cold/SoloHotAndCold";
import { getDailyHotAndColdFn } from "@/features/things/hot-and-cold/hot-and-cold.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";
import "@/features/things/hot-and-cold/hot-and-cold.css";

export const Route = createFileRoute("/things/hot-and-cold_/daily")({
  loader: () => getDailyHotAndColdFn(),
  component: DailyHotAndColdRoute,
  head: () =>
    buildSeoHead({
      title: `Today's Hot and Cold — ${SITE_NAME}`,
      description: "Guess today's hidden word. Lower numbers are hotter. Zero finds it.",
      path: "/things/hot-and-cold/daily",
      image: OG_IMAGES.hotAndCold,
      imageAlt: "Hot and Cold — guess today's hidden word",
    }),
});

function DailyHotAndColdRoute() {
  const navigate = useNavigate();
  const { puzzle } = Route.useLoaderData();
  return (
    <SoloHotAndCold
      puzzle={puzzle}
      onExit={() => void navigate({ to: "/things/hot-and-cold", replace: true })}
    />
  );
}
