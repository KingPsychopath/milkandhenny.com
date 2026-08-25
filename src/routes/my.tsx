import { createFileRoute } from "@tanstack/react-router";

import { MyAccountPage } from "@/features/attendee-access/ui/MyAccountPage";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/my")({
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
