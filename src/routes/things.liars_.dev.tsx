import { createFileRoute, notFound } from "@tanstack/react-router";
import { LiarsDevHarness } from "@/features/things/liars/LiarsDevHarness";
import { SITE_NAME } from "@/lib/shared/config";

/**
 * Development only. Five phones and a stopwatch is a poor loop for a game whose whole design is
 * about what each player can and cannot see; this puts the entire table on one screen.
 */
export const Route = createFileRoute("/things/liars_/dev")({
  beforeLoad: () => {
    if (!import.meta.env.DEV) throw notFound();
  },
  component: LiarsDevRoute,
  head: () => ({ meta: [{ title: `Liars dev — ${SITE_NAME}` }] }),
});

function LiarsDevRoute() {
  if (!import.meta.env.DEV) return null;
  return <LiarsDevHarness />;
}
