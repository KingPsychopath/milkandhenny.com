import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Lora } from "next/font/google";
import { LampToggle } from "@/components/LampToggle";
import { BackToTop } from "@/components/BackToTop";
import { Analytics } from "@vercel/analytics/react";
import { BASE_URL } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const lora = Lora({
  variable: "--font-lora",
  subsets: ["latin"],
  style: ["normal", "italic"],
});

export const metadata: Metadata = {
  metadataBase: new URL(BASE_URL),
  title: "Milk & Henny",
  description: "Thoughts, stories, and things worth sharing.",
  icons: {
    icon: "/icon.svg",
    apple: "/MAHLogo.svg",
  },
  openGraph: {
    title: "Milk & Henny",
    description: "Thoughts, stories, and things worth sharing.",
    url: "/",
    siteName: "Milk & Henny",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Milk & Henny",
    description: "Thoughts, stories, and things worth sharing.",
  },
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} antialiased`}
      >
        <LampToggle />
        <BackToTop />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
