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
  metadataBase: new URL("https://moovexpress.com"),
  title: {
    default: "MoovExpress — Gestione Spedizioni e Logistica",
    template: "%s · MoovExpress",
  },
  description:
    "MoovExpress è la piattaforma per gestire spedizioni, corrieri, contrassegni e resi. Importa gli ordini dai tuoi canali di vendita e spedisci con i migliori corrieri, tutto in un unico posto.",
  applicationName: "MoovExpress",
  keywords: [
    "spedizioni", "gestione spedizioni", "logistica", "corrieri", "contrassegno",
    "resi", "tracking spedizioni", "importazione ordini", "Shopify", "MoovExpress",
  ],
  openGraph: {
    type: "website",
    locale: "it_IT",
    url: "https://moovexpress.com",
    siteName: "MoovExpress",
    title: "MoovExpress — Gestione Spedizioni e Logistica",
    description:
      "Gestisci spedizioni, corrieri, contrassegni e resi. Importa gli ordini e spedisci con i migliori corrieri.",
  },
  twitter: {
    card: "summary_large_image",
    title: "MoovExpress — Gestione Spedizioni e Logistica",
    description: "Gestisci spedizioni, corrieri, contrassegni e resi in un unico posto.",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="it"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
