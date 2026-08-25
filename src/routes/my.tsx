import { createFileRoute, redirect } from "@tanstack/react-router";

import { getAttendeeIdentityStateFn } from "@/features/attendee-access/access.functions";
import { attendeeSignInHref } from "@/features/attendee-access/types";
import { MyAccountPage } from "@/features/attendee-access/ui/MyAccountPage";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/my")({
  loader: async () => {
    const { authenticated } = await getAttendeeIdentityStateFn();
    if (!authenticated) throw redirect({ href: attendeeSignInHref("/my") });
  },
  head: () =>
    buildSeoHead({
      title: `Account — ${SITE_NAME}`,
      description: "Your Milk & Henny tickets, scores and details.",
      path: "/my",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: MyAccountPage,
});
