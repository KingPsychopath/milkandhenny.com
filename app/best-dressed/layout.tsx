import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Milk & Henny | Best Dressed",
  description: "Vote for the best dressed guest",
};

export default function BestDressedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
