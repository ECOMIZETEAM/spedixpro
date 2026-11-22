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

// Header di sicurezza validi OVUNQUE, aggiunti a ogni risposta (non sostituiscono SENZA_TRACCIA sui
// percorsi Shopify: Next applica tutte le regole che combaciano). nosniff ferma lo sniffing del
// tipo di contenuto (un .json servito come HTML che diventa pagina); HSTS impone https. Nessuna CSP
// qui: su quest'app (script inline di Next, Stripe, recharts...) va tarata e provata, altrimenti
// rompe pagine — resta un passo a parte.
const SICUREZZA_GLOBALE = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
]
// Solo i portali interni non devono poter finire in un <iframe> altrui (clickjacking). Il sito
// pubblico e le pagine di tracking NO: alcune vengono incorniciate di proposito.
const NIENTE_IFRAME = [{ key: 'X-Frame-Options', value: 'SAMEORIGIN' }]

// CSP in SOLA SEGNALAZIONE (Report-Only): NON blocca niente, ma il browser segnala a /api/csp-report
// ogni risorsa che la policy bloccherebbe. Serve a TARARE la policy sui dati veri PRIMA di attivarla
// (passando poi a 'Content-Security-Policy' senza -Report-Only). Prima bozza: self + le origini note del
// browser (Supabase, Stripe, mappe/geowidget dei punti, cdnjs). img-src https: resta largo (le foto
// etichetta/tracking arrivano da molti domini). 'unsafe-inline'/'unsafe-eval' perche' Next e i grafici
// oggi li usano: si stringeranno coi nonce in un secondo momento, guidati dalle segnalazioni raccolte.
const CSP_SOLO_SEGNALAZIONE = [{
  key: 'Content-Security-Policy-Report-Only',
  value: [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://js.stripe.com https://cdnjs.cloudflare.com https://maps.googleapis.com https://*.easypack24.net",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdnjs.cloudflare.com",
    "font-src 'self' data: https://fonts.gstatic.com https://cdnjs.cloudflare.com",
    "img-src 'self' data: blob: https:",
    "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.stripe.com https://*.easypack24.net https://*.inpost-group.com",
    "frame-src 'self' https://js.stripe.com https://hooks.stripe.com https://*.easypack24.net https://maps.google.com https://www.google.com",
    'report-uri /api/csp-report',
  ].join('; '),
}]

const nextConfig: NextConfig = {
  serverExternalPackages: ['pdfjs-dist'],
  poweredByHeader: false,
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
      // NON su /api/v1: sono header pensati per le PAGINE del browser. Sull'API di integrazione (quella
      // che chiamano i software dei clienti) rompevano lo scarico del portale di CONTORNO SRL: aggiunti il
      // 21/11 alle 19:41 CET, prima quell'ora l'etichetta si scaricava. Il PDF era IDENTICO prima e dopo
      // (provato col diff: resa invariata), cambiavano SOLO questi header -> fuori dall'API, dentro al portale.
      { source: '/((?!api/v1/).*)', headers: SICUREZZA_GLOBALE },
      { source: '/dashboard/:path*', headers: NIENTE_IFRAME },
      { source: '/cliente/:path*', headers: NIENTE_IFRAME },
      { source: '/((?!api/v1/).*)', headers: CSP_SOLO_SEGNALAZIONE },  // idem: niente CSP sull'API di integrazione
    ]
  },
};
export default nextConfig;