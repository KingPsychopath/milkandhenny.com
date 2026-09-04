import { createFileRoute } from "@tanstack/react-router";

import { getPublicPollFn } from "@/features/polls/polls.functions";
import { PollPage } from "@/features/polls/ui/PollPage";
import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/polls/$slug")({
  loader: ({ params }) => getPublicPollFn({ data: { slug: params.slug } }),
  component: PollRoute,
  head: ({ loaderData, params }) =>
    buildSeoHead({
      title: loaderData ? `${loaderData.title} — ${SITE_BRAND}` : `Poll — ${SITE_BRAND}`,
      description: loaderData?.intro || "A small question from Milk & Henny.",
      path: `/polls/${params.slug}`,
      robots: loaderData?.status === "open" ? "index, follow" : "noindex, nofollow",
    }),
});

function PollRoute() {
  return <PollPage initialPoll={Route.useLoaderData()} />;
}
