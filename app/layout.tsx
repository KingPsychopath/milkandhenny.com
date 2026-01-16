import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Milk & Henny",
  description: "First Ever Birthday",
  icons: {
    icon: "/icon.svg",
    apple: "/MAHLogo.svg",
  },
  openGraph: {
    title: "Milk & Henny",
    description: "First Ever Birthday",
    siteName: "Milk & Henny",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Milk & Henny",
    description: "First Ever Birthday",
  },
};

export const viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
