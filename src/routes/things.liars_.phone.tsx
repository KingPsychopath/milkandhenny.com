import { createFileRoute } from "@tanstack/react-router";
import { LiarsPassPhoneApp } from "@/features/things/liars/LiarsPassPhoneApp";
import { SITE_NAME } from "@/lib/shared/config";

export const Route = createFileRoute("/things/liars_/phone")({
  component: LiarsPassPhoneRoute,
  head: () => ({
    meta: [
      { title: `Imposter on one phone — ${SITE_NAME}` },
      {
        name: "description",
        content:
          "Imposter with no room code and no second device. Pass one phone round the circle, everyone taps to see their word, then put it down and argue.",
      },
    ],
  }),
});

function LiarsPassPhoneRoute() {
  return <LiarsPassPhoneApp />;
}
