import { createFileRoute } from "@tanstack/react-router";
import { IcebreakerApp } from "@/features/things/icebreaker/IcebreakerApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/icebreaker")({
  component: IcebreakerApp,
  head: () => ({ meta: [{ title: `Icebreaker — ${SITE_NAME}` }] }),
});
