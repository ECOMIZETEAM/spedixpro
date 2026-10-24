import type { NextConfig } from "next";

// LE PORTE DA CUI SHOPIFY CI MANDA UN LINK FIRMATO NON DEVONO LASCIARLO IN GIRO.
// Shopify apre l'app su /api/integrazioni/shopify/enter e torna dall'OAuth su .../callback con parametri
// firmati nell'indirizzo (shop, timestamp, hmac; code e state al ritorno). Per Shopify un indirizzo cosi'
// e' un token: "any app URL which accepts a token must ensure it includes a Referrer-Policy header ...
// preferably, no-referrer" (https://shopify.dev/docs/apps/build/security). no-store perche' quelle
// risposte possono portare i cookie della sessione appena aperta: non le deve tenere nessuna cache, ne'
// del browser ne' di mezzo (prima uscivano col default di Vercel, 'public, max-age=0, must-revalidate').
// Sta qui, sul prefisso, e non rotta per rotta: vale anche per /install e per ogni rotta che nascera'
// sotto lo stesso percorso, e un `return` nuovo non puo' dimenticarla. /shopify e' il vecchio ingresso che
// inoltra gli stessi parametri a /enter. Su Vercel un Cache-Control scritto dalla rotta stessa vince su
// questo ("Functions have priority over config files"): sotto questo prefisso non va scritto.
const SENZA_TRACCIA = [
  { key: 'Referrer-Policy', value: 'no-referrer' },
  { key: 'Cache-Control', value: 'no-store' },
]

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfjs-dist'],
  turbopack: {
    root: __dirname,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  async headers() {
    return [
      { source: '/api/integrazioni/shopify/:path*', headers: SENZA_TRACCIA },
      { source: '/shopify', headers: SENZA_TRACCIA },
    ]
  },
};
export default nextConfig;