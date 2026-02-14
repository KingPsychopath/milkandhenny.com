import type { Metadata } from "next";
import { SITE_NAME } from "@/lib/config";

export const metadata: Metadata = {
  title: `${SITE_NAME} — First Ever Birthday`,
  description: `The party hub for ${SITE_NAME}'s first ever birthday`,
};

export default function PartyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
