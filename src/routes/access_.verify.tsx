import { createFileRoute, redirect } from "@tanstack/react-router";

import { verifyAttendeeAccessFn } from "@/features/attendee-access/access.functions";
import { AccessVerificationPending } from "@/features/attendee-access/ui/AccessPage";
import { safeReturnTo } from "@/features/attendee-access/types";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

type AccessVerificationSearch = {
  returnTo: string;
  challenge?: string;
  token?: string;
};

export const Route = createFileRoute("/access_/verify")({
  validateSearch: (search: Record<string, unknown>): AccessVerificationSearch => ({
    returnTo: safeReturnTo(search.returnTo),
    challenge: typeof search.challenge === "string" ? search.challenge : undefined,
    token: typeof search.token === "string" ? search.token : undefined,
  }),
  loaderDeps: ({ search }) => search,
  loader: async ({ deps }) => {
    if (!deps.challenge || !deps.token) {
      throw redirect({
        to: "/access",
        search: { returnTo: deps.returnTo, issue: "invalid" },
        replace: true,
      });
    }

    const result = await verifyAttendeeAccessFn({
      data: { challengeId: deps.challenge, token: deps.token },
    });
    if (!result.ok) {
      const issue = result.status === 410 ? "expired" : result.status === 409 ? "used" : "invalid";
      throw redirect({
        to: "/access",
        search: { returnTo: deps.returnTo, issue },
        replace: true,
      });
    }

    throw redirect({
      href: result.value.returnTo ?? deps.returnTo,
      replace: true,
      reloadDocument: true,
    });
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  pendingMs: 250,
  pendingMinMs: 300,
  pendingComponent: AccessVerificationPending,
  head: () =>
    buildSeoHead({
      title: `Signing in — ${SITE_NAME}`,
      description: "Verify a private Milk & Henny access link.",
      path: "/access/verify",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});
