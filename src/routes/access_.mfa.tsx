import { createFileRoute, redirect } from "@tanstack/react-router";

import { getMfaChallengeFn } from "@/features/attendee-access/totp.functions";
import { MfaChallengePage } from "@/features/attendee-access/ui/MfaChallengePage";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/access_/mfa")({
  loader: async () => {
    const challenge = await getMfaChallengeFn();
    if (!challenge.required) {
      throw redirect({ to: "/access", search: { returnTo: "/my" }, replace: true });
    }
    return challenge;
  },
  staleTime: 0,
  gcTime: 0,
  preload: false,
  head: () =>
    buildSeoHead({
      title: `Verify sign-in — ${SITE_NAME}`,
      description: "Complete multi-factor authentication.",
      path: "/access/mfa",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
  component: MfaRoute,
});

function MfaRoute() {
  return <MfaChallengePage returnTo={Route.useLoaderData().returnTo} />;
}
