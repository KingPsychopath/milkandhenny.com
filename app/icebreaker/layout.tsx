import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Milk & Henny | Ice Breaker",
  description: "Find your colour match",
};

export default function IcebreakerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}

