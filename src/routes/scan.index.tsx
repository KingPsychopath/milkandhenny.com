import { createFileRoute, redirect } from "@tanstack/react-router";

import { SITE_NAME } from "@/lib/shared/config";
import { buildSeoHead } from "@/lib/shared/seo";

/**
 * Scanner home for a helper's phone.
 *
 * Lists every scanner link this device has opened recently so a lost tab is
 * a one-tap recovery. Purely client-side: the tokens live in the device's
 * own storage and the server learns nothing until one is opened.
 */
export const Route = createFileRoute("/scan/")({
  beforeLoad: () => {
    throw redirect({ to: "/work", replace: true });
  },
  head: () =>
    buildSeoHead({
      title: `Scanner — ${SITE_NAME}`,
      description: "Private event scanner links saved on this phone.",
      path: "/scan",
      robots: "noindex, nofollow",
      referrer: "no-referrer",
    }),
});
