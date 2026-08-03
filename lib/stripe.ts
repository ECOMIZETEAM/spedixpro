import Stripe from 'stripe'
import { pianoById, type Piano } from '@/lib/piani'

// ═══════════════════════════════════════════════════════════════════════════
// PAGAMENTO DEL CANONE CON CARTA
//
// Il canone finora si paga con bonifico: il master sceglie il piano, l'importo gli viene scalato
// dal credito interno e il pagamento resta "da incassare" finche' non arriva il bonifico e
// qualcuno lo segna a mano. Funziona, ma l'incasso dipende da una persona.
//
// Con la carta l'abbonamento e' ricorrente: il circuito riaddebita da solo ogni mese e ci avvisa.
// Le due strade CONVIVONO — chi paga con bonifico continua come prima.
//
// Regola di sicurezza: finche' le chiavi non ci sono, tutto questo e' spento e il portale si
// comporta esattamente come oggi. Nessuna schermata cambia, nessun addebito parte.
// ═══════════════════════════════════════════════════════════════════════════

// IVA: ZERO, e non e' una dimenticanza.
//
// La societa' che fattura i canoni e' ESTERA (UK), non italiana. Per una prestazione di servizi a
// un'azienda italiana l'imposta si assolve nel paese del CLIENTE con l'inversione contabile: la
// fattura esce senza IVA e la versa il destinatario. Aggiungere il 22% qui vorrebbe dire incassare
// un'imposta che non e' dovuta e che non si potrebbe versare a nessuno.
//
// Il master paga quindi esattamente il prezzo del piano: 139 €, senza nulla sopra.
// Per questo alla cassa si chiede la PARTITA IVA (tax_id_collection): l'inversione contabile vale
// fra soggetti d'imposta, e il numero del cliente e' cio' che la rende legittima.
//
// Se un giorno a fatturare fosse una societa' italiana, qui si rimette 22 con IVA_COMPRESA a true:
// il totale pagato non cambierebbe (139 resta 139), cambierebbe solo lo scorporo in fattura.
export const IVA_PERCENTUALE = 0
export const IVA_COMPRESA = true

export function stripeConfigurato(): boolean {
  return !!process.env.STRIPE_SECRET_KEY
}

let _stripe: Stripe | null = null
export function stripeClient(): Stripe {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error('Pagamento con carta non configurato')
  if (!_stripe) _stripe = new Stripe(process.env.STRIPE_SECRET_KEY)
  return _stripe
}

// ── Listino sul circuito ────────────────────────────────────────────────────
// I prezzi si creano da soli alla prima richiesta e si ritrovano con una chiave stabile
// (`lookup_key`): non c'e' niente da configurare a mano, e non nascono doppioni se la funzione
// viene chiamata cento volte. Il prezzo del piano vive in un posto solo: lib/piani.ts.
const chiavePrezzo = (pianoId: string) => `moov_${pianoId}`

export async function prezzoStripe(pianoId: string): Promise<{ price: Stripe.Price; piano: Piano }> {
  const piano = pianoById(pianoId)
  if (!piano) throw new Error('Piano non valido')
  const s = stripeClient()
  const chiave = chiavePrezzo(pianoId)
  const attesi = Math.round(piano.prezzo * 100)

  const comportamento = IVA_COMPRESA ? 'inclusive' : 'exclusive'
  const esistenti = await s.prices.list({ lookup_keys: [chiave], active: true, limit: 1, expand: ['data.product'] })
  const trovato = esistenti.data[0]
  // Prezzo gia' presente ma con importo diverso = il listino e' cambiato da noi. Il vecchio non si
  // puo' modificare (sul circuito i prezzi sono immutabili): se ne crea uno nuovo e gli si passa
  // la chiave, cosi' i prossimi pagamenti usano l'importo giusto. Chi ha gia' l'abbonamento resta
  // sul suo prezzo finche' non cambia piano — e' il comportamento corretto, non un effetto
  // collaterale: a nessuno viene aumentato il canone senza che lo scelga.
  // Si sostituisce anche se cambia il MODO di trattare l'IVA, non solo l'importo: un prezzo nato
  // come "IVA da aggiungere" farebbe pagare 139 + 22% anche dopo aver cambiato la regola qui.
  if (trovato && trovato.unit_amount === attesi && trovato.tax_behavior === comportamento) return { price: trovato, piano }
  if (trovato) await s.prices.update(trovato.id, { lookup_key: `${chiave}_storico_${trovato.id}` })

  const prodotti = await s.products.search({ query: `metadata['piano']:'${pianoId}'`, limit: 1 })
  const prodotto = prodotti.data[0] || await s.products.create({
    name: `MoovExpress ${piano.nome}`,
    description: `Fino a ${piano.limite.toLocaleString('it-IT')} spedizioni al mese`,
    metadata: { piano: pianoId },
  })

  const price = await s.prices.create({
    product: prodotto.id,
    currency: 'eur',
    unit_amount: attesi,
    recurring: { interval: 'month' },
    lookup_key: chiave,
    transfer_lookup_key: true,
    tax_behavior: IVA_COMPRESA ? 'inclusive' : 'exclusive',
    metadata: { piano: pianoId },
  })
  return { price, piano }
}

// Aliquota IVA, creata una volta sola e poi ritrovata. Restituisce [] se l'IVA e' a zero.
export async function aliquotaIva(): Promise<string[]> {
  if (!IVA_PERCENTUALE) return []
  const s = stripeClient()
  const esistenti = await s.taxRates.list({ active: true, limit: 100 })
  const trovata = esistenti.data.find(t => t.percentage === IVA_PERCENTUALE && t.inclusive === IVA_COMPRESA && t.country === 'IT')
  if (trovata) return [trovata.id]
  const nuova = await s.taxRates.create({
    display_name: 'IVA', description: `IVA ${IVA_PERCENTUALE}%${IVA_COMPRESA ? ' compresa' : ''}`,
    jurisdiction: 'IT', country: 'IT',
    percentage: IVA_PERCENTUALE, inclusive: IVA_COMPRESA,
  })
  return [nuova.id]
}

// ── Anagrafica ──────────────────────────────────────────────────────────────
// Un cliente sul circuito per ogni master, creato alla prima volta e poi riusato: e' quello che
// tiene insieme la carta salvata, le fatture e l'abbonamento.
export async function clienteStripe(admin: any, master: { id: string; nome?: string | null; email?: string | null; stripe_customer_id?: string | null }): Promise<string> {
  if (master.stripe_customer_id) return master.stripe_customer_id
  const s = stripeClient()
  const c = await s.customers.create({
    name: master.nome || undefined,
    email: master.email || undefined,
    metadata: { master_id: master.id },
  })
  await admin.from('masters').update({ stripe_customer_id: c.id }).eq('id', master.id)
  return c.id
}

// Il riferimento a un prezzo a volte e' l'oggetto intero, a volte solo il codice: serve il codice.
export function idPrezzo(v: any): string {
  return typeof v === 'string' ? v : String(v?.id || '')
}

// PRIMO GIORNO DEL PROSSIMO MESE. E' la data in cui hanno effetto i downgrade e le disdette, ed
// e' anche il giorno in cui riparte il contatore delle spedizioni: il piano si misura sul mese di
// calendario, quindi anche il canone deve seguire il mese di calendario, non l'anniversario di
// quando uno si e' iscritto. Altrimenti chi si abbona il 13 avrebbe il pacchetto che riparte il 1°
// e la bolletta che arriva il 13, e nessuno dei due numeri tornerebbe con l'altro.
export function primoDelProssimoMese(d = new Date()): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 0, 0, 0) / 1000)
}

// Dal prezzo pagato si risale al piano: e' cosi' che il webhook sa quale pacchetto attivare,
// anche quando il cambio piano e' stato fatto dal portale fatture del circuito e non dal nostro.
export function pianoDaPrezzo(price: Stripe.Price | null | undefined): Piano | null {
  const id = String(price?.metadata?.piano || (price?.lookup_key || '').replace(/^moov_/, '').replace(/_storico_.*$/, ''))
  return pianoById(id) || null
}

// ═══════════════════════════════════════════════════════════════════════════
// I PACCHETTI DI CHI USA LE API
//
// Sono un'altra cosa dal canone del master: li paga un CLIENTE che usa il nostro sistema come
// motore del suo negozio. Fino a 50 spedizioni al mese non paga niente — chi prova o ha un
// negozio piccolo non deve nemmeno pensarci — e sopra sceglie un pacchetto.
//
// Vivono nel database (tabella piani_api) invece che in un file, perche' i prezzi di questo
// listino li vuole cambiare chi vende, non chi scrive il codice.
// ═══════════════════════════════════════════════════════════════════════════

export type PianoApi = { codice: string; nome: string; limite: number; prezzo: number }

const chiavePrezzoApi = (codice: string) => `moov_api_${codice}`

export async function prezzoStripeApi(piano: PianoApi): Promise<Stripe.Price> {
  if (!(piano.prezzo > 0)) throw new Error('Il piano Free non si paga')
  const s = stripeClient()
  const chiave = chiavePrezzoApi(piano.codice)
  const attesi = Math.round(piano.prezzo * 100)
  const comportamento = IVA_COMPRESA ? 'inclusive' : 'exclusive'

  const esistenti = await s.prices.list({ lookup_keys: [chiave], active: true, limit: 1 })
  const trovato = esistenti.data[0]
  // Stessa regola dei canoni: un prezzo sul circuito non si modifica. Se il listino cambia se ne
  // crea uno nuovo e gli si passa la chiave; chi ha gia' l'abbonamento resta sul suo finche' non
  // cambia piano, cosi' a nessuno viene aumentato il canone senza che lo scelga.
  if (trovato && trovato.unit_amount === attesi && trovato.tax_behavior === comportamento) return trovato
  if (trovato) await s.prices.update(trovato.id, { lookup_key: `${chiave}_storico_${trovato.id}` })

  const prodotti = await s.products.search({ query: `metadata['piano_api']:'${piano.codice}'`, limit: 1 })
  const prodotto = prodotti.data[0] || await s.products.create({
    name: `MoovExpress API ${piano.nome}`,
    description: `Fino a ${piano.limite.toLocaleString('it-IT')} spedizioni al mese via API`,
    metadata: { piano_api: piano.codice },
  })

  return s.prices.create({
    product: prodotto.id,
    currency: 'eur',
    unit_amount: attesi,
    recurring: { interval: 'month' },
    lookup_key: chiave,
    transfer_lookup_key: true,
    tax_behavior: comportamento,
    metadata: { piano_api: piano.codice },
  })
}

// Dal prezzo pagato al codice del pacchetto API: serve al webhook per sapere cosa attivare.
export function pianoApiDaPrezzo(price: Stripe.Price | null | undefined): string | null {
  const m = String(price?.metadata?.piano_api || '')
  if (m) return m
  const k = String(price?.lookup_key || '')
  const r = /^moov_api_([a-z]+)/.exec(k)
  return r ? r[1] : null
}
