import { createFileRoute } from "@tanstack/react-router";

import { requireAttendeeAccountFn } from "@/features/attendee-access/access.functions";
import { myAccountQuery } from "@/features/attendee-access/account.queries";
import { MyAccountPage } from "@/features/attendee-access/ui/MyAccountPage";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/my")({
  beforeLoad: () => requireAttendeeAccountFn(),
  loader: {
    handler: async ({ context }) => {
      await context.queryClient.fetchQuery(myAccountQuery);
    },
    staleReloadMode: "blocking",
  },
  preloadStaleTime: 0,
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: () =>
    buildSeoHead({
      title: `Account — ${SITE_NAME}`,
      description: "Your Milk & Henny tickets, staff access and event details.",
      path: "/my",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: MyAccountRoute,
});

function MyAccountRoute() {
  return <MyAccountPage />;
}
