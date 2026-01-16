import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Milk & Henny | Guest List",
  description: "Door staff check-in system",
};

export default function GuestListLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
