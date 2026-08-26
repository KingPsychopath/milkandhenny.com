import { createFileRoute } from "@tanstack/react-router";

import { AccessPage } from "@/features/attendee-access/ui/AccessPage";
import { safeReturnTo } from "@/features/attendee-access/types";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

type AccessSearch = {
  returnTo: string;
  issue?: "expired" | "used" | "invalid";
};

export const Route = createFileRoute("/access")({
  validateSearch: (search: Record<string, unknown>): AccessSearch => ({
    returnTo: safeReturnTo(search.returnTo),
    issue:
      search.issue === "expired" || search.issue === "used" || search.issue === "invalid"
        ? search.issue
        : undefined,
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
  const { returnTo, issue } = Route.useSearch();
  const initialMessage =
    issue === "expired"
      ? "That sign-in link has expired. Request a new one below."
      : issue === "used"
        ? "That sign-in link has already been used. Request a new one below."
        : issue === "invalid"
          ? "That sign-in link is not valid. Request a new one below."
          : undefined;
  return <AccessPage returnTo={returnTo} initialMessage={initialMessage} />;
}
