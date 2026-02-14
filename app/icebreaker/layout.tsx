import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Ice Breaker`,
  description: "Find your colour match",
};

export default function IcebreakerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
