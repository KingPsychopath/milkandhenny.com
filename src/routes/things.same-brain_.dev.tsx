import { createFileRoute, notFound } from "@tanstack/react-router";
import { SameBrainDevHarness } from "@/features/things/same-brain/SameBrainDevHarness";
import { SITE_NAME } from "@/lib/shared/config";

/**
 * Development only. The open question in this game is whether the scorer agrees with a human, and
 * that is only answerable by running the same answers through both methods and comparing the two
 * reveals side by side — which no arrangement of real phones makes convenient.
 */
export const Route = createFileRoute("/things/same-brain_/dev")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: SameBrainDevRoute,
  head: () => ({ meta: [{ title: `Same brain dev — ${SITE_NAME}` }] }),
});

function SameBrainDevRoute() {
  if (!import.meta.env.DEV) return null;
  return <SameBrainDevHarness />;
}
