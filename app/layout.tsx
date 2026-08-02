import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Slushy — un objet, quatre indices, un puzzle par jour",
  description:
    "Un nouveau puzzle chaque jour, le même pour toute la planète. Quatre indices, " +
    "une scène pleine d'objets, et un seul qui coche tout.",
  openGraph: {
    title: "Slushy",
    description: "Un objet. Quatre indices. Une chance par jour.",
    type: "website",
  },
};

export const viewport: Viewport = {
  // Le jeu se joue au doigt : le double-tap-zoom du navigateur entrerait en
  // conflit avec le zoom de la scène, qui est géré par le composant lui-même.
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#faf7f2" },
    { media: "(prefers-color-scheme: dark)", color: "#0c0c0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr" className={`${geistSans.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
