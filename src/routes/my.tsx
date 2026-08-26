import { createFileRoute } from "@tanstack/react-router";

import {
  getMyAccountFn,
  requireAttendeeAccountFn,
} from "@/features/attendee-access/access.functions";
import { MyAccountPage } from "@/features/attendee-access/ui/MyAccountPage";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/my")({
  beforeLoad: () => requireAttendeeAccountFn(),
  loader: {
    handler: () => getMyAccountFn(),
    staleReloadMode: "blocking",
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: () =>
    buildSeoHead({
      title: `Account — ${SITE_NAME}`,
      description: "Your Milk & Henny tickets, scores and details.",
      path: "/my",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: MyAccountRoute,
});

function MyAccountRoute() {
  const { account, emailStepUpRequired, security } = Route.useLoaderData();
  return (
    <MyAccountPage
      account={account}
      emailStepUpRequired={emailStepUpRequired}
      security={security}
    />
  );
}
