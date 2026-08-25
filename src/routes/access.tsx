import { createFileRoute } from "@tanstack/react-router";

import { AccessPage } from "@/features/attendee-access/ui/AccessPage";
import { safeReturnTo } from "@/features/attendee-access/types";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/access")({
  validateSearch: (search: Record<string, unknown>) => ({
    returnTo: safeReturnTo(search.returnTo),
  }),
  head: () =>
    buildSeoHead({
      title: `Sign in — ${SITE_NAME}`,
      description: "Sign in to Milk & Henny with a private one-time link or code.",
      path: "/access",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: AccessRoute,
});

function AccessRoute() {
  const { returnTo } = Route.useSearch();
  return <AccessPage returnTo={returnTo} />;
}
