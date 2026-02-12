import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Milk & Henny — First Ever Birthday",
  description: "The party hub for Milk & Henny's first ever birthday",
};

export default function PartyLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return children;
}
