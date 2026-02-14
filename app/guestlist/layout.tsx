import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: `${SITE_NAME} | Guest List`,
  description: "Door staff check-in system",
};

export default function GuestListLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
