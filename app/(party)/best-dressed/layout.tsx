import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/shared/config";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Best Dressed`,
  description: "Vote for the best dressed guest",
};

export default function BestDressedLayout({ children }: { children: React.ReactNode }) {
  return children;
}

