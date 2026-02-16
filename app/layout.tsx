import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Lora } from "next/font/google";
import { LampToggle } from "@/components/LampToggle";
import { BackToTop } from "@/components/BackToTop";
import { Analytics } from "@vercel/analytics/react";
import { BASE_URL, SITE_NAME } from "@/lib/shared/config";
import { LOCAL_KEYS } from "@/lib/shared/storage-keys";
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
  title: SITE_NAME,
  description: "Thoughts, stories, and things worth sharing.",
  icons: {
    icon: "/icon.svg",
    apple: "/MAHLogo.svg",
  },
  openGraph: {
    title: SITE_NAME,
    description: "Thoughts, stories, and things worth sharing.",
    url: "/",
    siteName: SITE_NAME,
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_NAME,
    description: "Thoughts, stories, and things worth sharing.",
  },
  alternates: {
    types: {
      "application/rss+xml": "/feed.xml",
    },
  },
  manifest: "/manifest.json",
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
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){var t=localStorage.getItem("${LOCAL_KEYS.theme}");if(t==="dark")document.documentElement.setAttribute("data-theme","dark");})();`,
          }}
        />
      </head>
      <body
        className={`${geistSans.variable} ${geistMono.variable} ${lora.variable} antialiased`}
      >
        <a
          href="#main"
          className="skip-link"
        >
          Skip to main content
        </a>
        <LampToggle />
        <BackToTop />
        {children}
        <Analytics />
      </body>
    </html>
  );
}
