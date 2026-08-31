import { createFileRoute } from "@tanstack/react-router";
import { LiarsPassPhoneApp } from "@/features/things/liars/LiarsPassPhoneApp";
import { SITE_NAME } from "@/lib/shared/config";
import { OG_IMAGES, buildSeoHead } from "@/lib/shared/seo";

export const Route = createFileRoute("/things/imposter_/phone")({
  component: ImposterPassPhoneRoute,
  head: () =>
    buildSeoHead({
      title: `Imposter on one phone — ${SITE_NAME}`,
      description:
        "Pass one phone round the circle, reveal the word, and argue without a room code.",
      path: "/things/imposter/phone",
      image: OG_IMAGES.liars,
      imageAlt: "Imposter on one phone — a social deduction game from Milk & Henny",
    }),
});

function ImposterPassPhoneRoute() {
  return <LiarsPassPhoneApp />;
}
