import { createFileRoute } from "@tanstack/react-router";
import { TwinDevHarness } from "@/features/things/twin/TwinDevHarness";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/twin_/dev")({
  component: TwinDevHarness,
  head: () => ({
    meta: [{ title: `Twin dev — ${SITE_NAME}` }, { name: "robots", content: "noindex,nofollow" }],
  }),
});
