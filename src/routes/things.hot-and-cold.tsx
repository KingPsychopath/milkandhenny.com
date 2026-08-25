import { createFileRoute } from "@tanstack/react-router";
import { HotAndColdApp } from "@/features/things/hot-and-cold/HotAndColdApp";
import { getDailyHotAndColdFn } from "@/features/things/hot-and-cold/hot-and-cold.functions";
import { getDefaultGamePoolLaunchFn } from "@/features/things/pool/pool.functions";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead, OG_IMAGES } from "@/lib/shared/seo";
import "@/features/things/hot-and-cold/hot-and-cold.css";

export const Route = createFileRoute("/things/hot-and-cold")({
  loader: async () => {
    const [daily, defaultPool] = await Promise.all([
      getDailyHotAndColdFn(),
      getDefaultGamePoolLaunchFn({ data: { game: "hot-and-cold" } }).catch(() => null),
    ]);
    return { ...daily, defaultPool };
  },
  component: Page,
  head: () =>
    buildSeoHead({
      title: `Hot and Cold — ${SITE_NAME}`,
      description: "Guess the hidden word. Lower numbers are hotter. Zero finds it.",
      path: "/things/hot-and-cold",
      image: OG_IMAGES.hotAndCold,
      imageAlt: "Hot and Cold — guess the hidden word; lower numbers are hotter and zero wins.",
    }),
});
function Page() {
  const data = Route.useLoaderData();
  return <HotAndColdApp puzzle={data.puzzle} defaultPool={data.defaultPool} />;
}
