import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";

import { currentAttendeeAccountView } from "@/features/attendee-access/access.server";
import { MyAccountPage } from "@/features/attendee-access/ui/MyAccountPage";
import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

const getMyAccount = createServerFn({ method: "GET" }).handler(() => currentAttendeeAccountView());

export const Route = createFileRoute("/my")({
  loader: async () => {
    const view = await getMyAccount();
    if (!view.account)
      throw redirect({ to: "/access", search: { returnTo: "/my" }, replace: true });
    return { account: view.account, emailStepUpRequired: view.emailStepUpRequired };
  },
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
  const { account, emailStepUpRequired } = Route.useLoaderData();
  return <MyAccountPage account={account} emailStepUpRequired={emailStepUpRequired} />;
}
