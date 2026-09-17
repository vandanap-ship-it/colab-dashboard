import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Providers from "./providers";
import StagingBanner from "@/components/StagingBanner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Siddhi · White Lotus",
  description: "Planner dashboard and site engineer mobile app for White Lotus projects",
  applicationName: "Siddhi",
  appleWebApp: {
    capable: true,
    title: "Siddhi",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FBF7EE",
  // Native-app feel on phones: no pinch-zoom, no double-tap-to-zoom, no
  // iOS focus-zoom on inputs (paired with min-font-size: 16px in
  // globals.css). Desktop browsers ignore `userScalable: false` for
  // accessibility — Ctrl/Cmd zoom still works — so this only affects the
  // mobile PWA/browser experience, which is where the site engineer lives.
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-ivory text-ink">
        <StagingBanner />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
