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
//
// AMAZON: 30 GIORNI DALL'IMPORTAZIONE. La Data Protection Policy di Amazon chiede di non tenere i
// dati personali oltre 30 giorni dalla CONSEGNA; l'importazione viene sempre prima della consegna,
// quindi 30 giorni dall'importazione stanno dentro la regola. Vale per gli ordini Amazon da file e
// per quelli che arriveranno dal collegamento diretto (ordini_ecommerce, piattaforma 'amazon').

// Anonimizza A BLOCCHI finche' ce ne sono, entro una scadenza.
//
// Prima si leggevano 1000 id e si passavano tutti insieme a `.in('id', …)`: gli id finiscono
// nell'indirizzo della richiesta, e oltre ~450 l'indirizzo e' troppo lungo e la richiesta torna
// "Bad Request". Da meta' settembre 2026 gli ordini Amazon da pulire ogni notte erano piu' di 450:
// l'aggiornamento e' fallito tutte le notti, l'errore non lo guardava nessuno, e il 19/10/2026
// c'erano 23.486 ordini Amazon spediti oltre la soglia ancora con nome, indirizzo e telefono del
// compratore — mentre ad Amazon avevamo dichiarato la cancellazione. Blocchi da 300 stanno sotto
// quel limite e sotto gli 8 secondi che il database concede a ogni richiesta; un errore ferma il
// giro e finisce nella risposta (500), cosi' il cron risulta fallito invece di sembrare riuscito.
const BLOCCO = 300
async function anonimizzaABlocchi(
  cosa: string,
  leggiBlocco: () => PromiseLike<{ data: any[] | null; error: any }>,
  anonimizza: (ids: string[]) => PromiseLike<{ error: any }>,
  scadenza: number,
  errori: string[],
): Promise<number> {
  let fatti = 0
  const visti = new Set<string>()
  while (Date.now() < scadenza) {
    const { data: righe, error } = await leggiBlocco()
    if (error) { errori.push(`${cosa}, lettura: ${error.message}`); break }
    if (!righe?.length) break
    const ids = righe.map((r: any) => String(r.id))
    // Se tornano righe gia' anonimizzate, l'aggiornamento non ha avuto effetto (es. un trigger lo
    // annulla): fermarsi, invece di girare a vuoto fino alla scadenza contando righe mai toccate.
    if (ids.some(id => visti.has(id))) { errori.push(`${cosa}: le righe non cambiano dopo l'aggiornamento`); break }
    const { error: errAgg } = await anonimizza(ids)
    if (errAgg) { errori.push(`${cosa}, anonimizzazione: ${errAgg.message}`); break }
    ids.forEach(id => visti.add(id))
    fatti += ids.length
    if (ids.length < BLOCCO) break
  }
  return fatti
}

export async function GET(req: NextRequest) {
  const auth = req.headers.get('authorization')
  if (process.env.CRON_SECRET && auth !== 'Bearer ' + process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Non autorizzato' }, { status: 401 })
  }
  const admin = createAdminSupabase()
  const soglia = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()
  const sogliaAmazon = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString()
  const scadenza = Date.now() + 80_000
  const errori: string[] = []

  // Ordini Amazon DA FILE spediti oltre la soglia e non ancora anonimizzati
  const anonimizzati = await anonimizzaABlocchi('ordini Amazon da file',
    () => admin.from('ordini_importati')
      .select('id')
      .eq('stato', 'spedito')
      .neq('destinatario', '[dati rimossi]')
      .lt('created_at', sogliaAmazon)
      .filter('order_id', 'match', '^\\d{3}-\\d{7}-\\d{7}$')
      .limit(BLOCCO),
    ids => admin.from('ordini_importati')
      .update({ destinatario: '[dati rimossi]', indirizzo: '[dati rimossi]', telefono: null, email_destinatario: null, raw: null })
      .in('id', ids),
    scadenza, errori)

  // Ordini Amazon dal COLLEGAMENTO DIRETTO (SP-API), IN QUALUNQUE STATO. Amazon vuole i dati
  // cancellati anche quando il venditore toglie l'autorizzazione (entro 30 giorni, DPP §1.7), e un
  // ordine Amazon aperto da 30 giorni non si spedisce piu' (Amazon lo annulla oltre la data di
  // spedizione): togliere lo stato dal filtro copre tutti e due i casi con la stessa regola.
  // Anche `cliente_nome`: li' le librerie dei negozi copiano il nome del compratore.
  const amazonCollegato = await anonimizzaABlocchi('ordini Amazon collegati',
    () => admin.from('ordini_ecommerce')
      .select('id')
      .eq('piattaforma', 'amazon')
      .not('destinatario', 'is', null)
      .lt('created_at', sogliaAmazon)
      .limit(BLOCCO),
    ids => admin.from('ordini_ecommerce')
      .update({ destinatario: null, raw: null, cliente_nome: null })
      .in('id', ids),
    scadenza, errori)

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

  console.log(`[PURGE-PII] ordini Amazon anonimizzati=${anonimizzati} ordini Amazon collegati=${amazonCollegato} ordini store anonimizzati=${ecommerce}`)
  if (errori.length) {
    console.error('[PURGE-PII] ERRORI: ' + errori.join(' | '))
    return NextResponse.json({ ok: false, anonimizzati, amazonCollegato, ecommerce, errori }, { status: 500 })
  }
  return NextResponse.json({ ok: true, anonimizzati, amazonCollegato, ecommerce })
}
