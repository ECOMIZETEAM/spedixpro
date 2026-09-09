import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 120

// PURGE PII: i dati personali dei COMPRATORI vengono anonimizzati entro 31 giorni dalla spedizione.
// E' quello che dichiariamo ad Amazon (Data Protection Policy, profilo SP-API), a Shopify (Protected
// Customer Data) e nei nostri documenti di sicurezza — e per un anno e' stato vero solo per Amazon.
//
// Due perimetri, stessa soglia:
//  - ordini_importati con order_id in formato Amazon (XXX-XXXXXXX-XXXXXXX);
//  - ordini_ecommerce, cioe' la copia sincronizzata dagli store collegati (Shopify, Woo, PrestaShop,
//    eBay, TikTok, Temu). Questa tabella non la toccava NESSUN cron: dichiaravamo una cancellazione
//    che non avveniva. In una revisione sui dati protetti e' il rilievo che affonda l'app.
//
// Cosa resta: SKU, importi, CAP, numero d'ordine — servono a statistiche e contabilita' e non sono
// dati personali. La SPEDIZIONE non si tocca: e' documento fiscale e logistico, con una base di
// conservazione sua (vedi CLAUDE.md, "lo storico non si cancella").
// Nello stesso giro: pulizia del log di audit oltre i 13 mesi (retention dichiarata: 12+ mesi).

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()

  // Ordini Amazon spediti da oltre 31 giorni e non ancora anonimizzati
  const { data: righe } = await admin.from('ordini_importati')
    .select('id')
    .eq('stato', 'spedito')
    .neq('destinatario', '[dati rimossi]')
    .lt('created_at', soglia)
    .filter('order_id', 'match', '^\\d{3}-\\d{7}-\\d{7}$')
    .limit(1000)

  let anonimizzati = 0
  if (righe?.length) {
    const { error } = await admin.from('ordini_importati')
      .update({ destinatario: '[dati rimossi]', indirizzo: '[dati rimossi]', telefono: null, email_destinatario: null, raw: null })
      .in('id', righe.map((r: any) => r.id))
    if (!error) anonimizzati = righe.length
  }

  // Ordini degli STORE COLLEGATI, gia' spediti e piu' vecchi della soglia.
  //
  // Si azzerano i due campi che contengono dati personali: `destinatario` (nome, indirizzo, email,
  // telefono del compratore) e `raw`, che fino a oggi era la copia integrale della risposta dello
  // store. `articoli`, `totale`, `numero_ordine` restano.
  //
  // PERIMETRO: SOLO SHOPIFY, per ora. La cancellazione e' irreversibile e sulle altre piattaforme
  // colpirebbe subito 15.520 ordini gia' spediti (eBay 13.491, WooCommerce 1.243, PrestaShop 786,
  // misurati il 9/09/2026) togliendo il destinatario dalle schermate di chi ci lavora tutti i
  // giorni. Estenderla e' una decisione di chi comanda qui, non un effetto collaterale di una
  // revisione Shopify: finche' non e' presa, i documenti di sicurezza vanno letti sapendo che per
  // eBay/Woo/PrestaShop la retention NON e' ancora automatica.
  let ecommerce = 0
  const { data: righeEc } = await admin.from('ordini_ecommerce')
    .select('id')
    .eq('piattaforma', 'shopify')
    .eq('stato', 'spedito')
    .not('destinatario', 'is', null)
    .lt('created_at', soglia)
    .limit(1000)
  if (righeEc?.length) {
    const { error } = await admin.from('ordini_ecommerce')
      .update({ destinatario: null, raw: null })
      .in('id', righeEc.map((r: any) => r.id))
    if (!error) ecommerce = righeEc.length
  }

  // Retention audit: 13 mesi
  const sogliaAudit = new Date(Date.now() - 396 * 24 * 3600 * 1000).toISOString()
  await admin.from('audit_accessi').delete().lt('created_at', sogliaAudit)

  console.log(`[PURGE-PII] ordini Amazon anonimizzati=${anonimizzati} ordini store anonimizzati=${ecommerce}`)
  return NextResponse.json({ ok: true, anonimizzati, ecommerce })
}
