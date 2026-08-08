import { createFileRoute } from "@tanstack/react-router";
import { CentreDevHarness } from "@/features/things/centre/CentreDevHarness";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/centre_/dev")({
  component: CentreDevHarness,
  head: () => ({
    meta: [{ title: `Centre dev — ${SITE_NAME}` }, { name: "robots", content: "noindex,nofollow" }],
  }),
});
