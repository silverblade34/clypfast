import type { Metadata } from "next";
import { Inter, Space_Grotesk } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ClipFinder — Detector de momentos virales",
  description:
    "Analiza cualquier video de YouTube con IA y detecta los momentos con mayor potencial viral para TikTok, Reels y Shorts.",
  keywords: ["tiktok", "reels", "shorts", "viral", "video", "ai", "clips"],
  openGraph: {
    title: "ClipFinder",
    description: "Detecta momentos virales en videos con IA",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="es"
      data-scroll-behavior="smooth"
      className={`${inter.variable} ${spaceGrotesk.variable}`}
    >
      <body>{children}</body>
    </html>
  );
}
