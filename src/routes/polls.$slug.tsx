import { createFileRoute } from "@tanstack/react-router";

import { publicPollOptions } from "@/features/polls/polls.queries";
import { PollPage } from "@/features/polls/ui/PollPage";
import { SITE_BRAND } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/polls/$slug")({
  loader: async ({ context, params }) => {
    const poll = await context.queryClient.fetchQuery(publicPollOptions(params.slug));
    return poll ? { title: poll.title, intro: poll.intro, status: poll.status } : null;
  },
  preloadStaleTime: 0,
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
  return <PollPage slug={Route.useParams().slug} />;
}
