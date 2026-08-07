import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabase } from '@/lib/supabase-admin'
import { calcolaTariffeCliente } from '@/lib/tariffe-motore'
import { marchioCorriere, logoCorriere } from '@/lib/corriere-logo'

/* Il preventivo per il SITO PUBBLICO: chiunque, senza account.
 *
 * Il calcolo NON e' riscritto qui: chiama lo stesso motore della rotta del portale
 * (lib/tariffe-motore.ts). Se domani cambia una regola di prezzo, cambia per tutti e due —
 * che e' esattamente il motivo per cui il motore e' stato estratto.
 *
 * Quello che questa rotta fa in piu' e' tenere il perimetro:
 *
 * 1. IL CLIENTE E' FISSO. Non si legge dal corpo della richiesta: e' MULTIEXPRESS con il
 *    Listino Standard Web, scritti qui sotto a codice. Un identificativo che arrivasse da
 *    fuori permetterebbe a chiunque di farsi prezzare il listino di un altro.
 *
 * 2. USA IL CLIENT AMMINISTRATIVO, quindi salta le regole di isolamento del database. E'
 *    accettabile solo perche' il perimetro e' fisso al punto 1: non c'e' nessun dato
 *    dell'utente che scelga cosa leggere.
 *
 * 3. LA RISPOSTA E' RIPULITA. Il motore restituisce il NOME DEL CONTRATTO ("Poste Delivery
 *    Business S", "GLS Light Napoli"): sono nomi interni, con dentro riferimenti commerciali
 *    e la sigla del fornitore tecnico. In vetrina esce solo il MARCHIO. Spariscono anche gli
 *    identificativi interni. Il costo non c'era gia' prima e non deve tornare.
 */

const MULTIEXPRESS = 'a8d42a25-3711-4343-a6df-ee2ba9bbf08b'
const LISTINO_WEB = '4e6658e9-e975-4057-8c78-b258fbc98a64'
const IVA = 0.22

const ORIGINI = ['https://www.moovexpress.com', 'https://moovexpress-web.vercel.app']

// Stesso freno del modulo contatti: una porta pubblica su un dominio di produzione va
// protetta dalla raffica. Qui e' piu' largo perche' provare piu' pesi e' uso legittimo.
const visti = new Map<string, number[]>()
const FINESTRA = 60 * 1000
const MAX = 30
function troppeRichieste(ip: string): boolean {
  const ora = Date.now()
  const p = (visti.get(ip) || []).filter(t => ora - t < FINESTRA)
  p.push(ora); visti.set(ip, p)
  if (visti.size > 5000) for (const [k, v] of visti) if (!v.some(t => ora - t < FINESTRA)) visti.delete(k)
  return p.length > MAX
}

const intestazioni = (o: string | null) => ({
  'Access-Control-Allow-Origin': ORIGINI.includes(o || '') ? o! : ORIGINI[0],
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age': '86400',
})

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: intestazioni(req.headers.get('origin')) })
}

export async function POST(req: NextRequest) {
  const H = intestazioni(req.headers.get('origin'))
  const no = (errore: string, stato: number) => NextResponse.json({ errore }, { status: stato, headers: H })

  const origine = req.headers.get('origin')
  if (origine && !ORIGINI.includes(origine)) return no('Richiesta non consentita.', 403)

  const ip = (req.headers.get('x-forwarded-for') || '').split(',')[0].trim() || 'ignoto'
  if (troppeRichieste(ip)) return no('Troppe richieste. Riprova fra un minuto.', 429)

  let corpo: any
  try { corpo = await req.json() } catch { return no('Richiesta non valida.', 400) }

  const colli = Array.isArray(corpo?.packages) && corpo.packages.length ? corpo.packages : []
  if (!colli.length) return no('Serve almeno un collo con il peso.', 400)
  const pesoTot = colli.reduce((s: number, c: any) => s + (parseFloat(c?.weight) || 0), 0)
  if (!(pesoTot > 0)) return no('Il peso deve essere maggiore di zero.', 400)
  if (pesoTot > 1000) return no('Per spedizioni oltre i 1.000 kg contattaci: ti facciamo un preventivo su misura.', 400)
  if (colli.length > 20) return no('Per più di 20 colli contattaci: ti facciamo un preventivo su misura.', 400)

  const paese = String(corpo?.shipTo?.country || 'IT').toUpperCase().trim()
  const provincia = String(corpo?.shipTo?.state || '').toUpperCase().trim()
  if (paese === 'IT' && !provincia) return no('Serve la provincia di destinazione.', 400)

  // Il corpo della richiesta viene ricostruito, non passato: cosi' un campo in piu' inviato
  // da fuori (per esempio un clienteId) non puo' arrivare al motore.
  const richiesta = {
    shipTo: {
      postalCode: String(corpo?.shipTo?.postalCode || '').trim().slice(0, 10),
      state: provincia,
      city: String(corpo?.shipTo?.city || '').trim().slice(0, 60),
      country: paese,
    },
    packages: colli.slice(0, 20).map((c: any) => ({
      weight: parseFloat(c?.weight) || 0,
      length: parseFloat(c?.length) || 0,
      width: parseFloat(c?.width) || 0,
      height: parseFloat(c?.height) || 0,
    })),
    codValue: Math.max(0, parseFloat(corpo?.codValue) || 0),
    insuranceValue: Math.max(0, parseFloat(corpo?.insuranceValue) || 0),
  }

  const admin = createAdminSupabase()
  const esito = await calcolaTariffeCliente(
    admin,
    { cliente: { master_id: MULTIEXPRESS, listino_cliente_id: LISTINO_WEB }, clienteId: null, subMatch: null },
    richiesta,
  )
  // I messaggi del motore parlano a chi CONFIGURA il portale ("configura la tariffa sul
  // listino", "aggiungi una fascia"): a un visitatore non dicono niente e mostrano come siamo
  // fatti dentro. Qui diventano frasi per chi compra.
  if (esito.errore) {
    const e = esito.errore.toLowerCase()
    const perIlVisitatore =
      e.includes('contrassegno')   ? "Per questo importo in contrassegno non abbiamo una tariffa online: scrivici e te lo quotiamo."
      : e.includes('assicurazione') ? "Per questo valore assicurato non abbiamo una tariffa online: scrivici e te lo quotiamo."
      : e.includes('fascia') || e.includes('peso')
                                    ? "Per questo peso non abbiamo una tariffa online: scrivici e ti facciamo un preventivo su misura."
      : e.includes('misure')        ? "Le misure del collo superano quelle accettate dai corrieri disponibili online."
      : e.includes('zona') || e.includes('destinazione') || e.includes('spedizioni verso')
                                    ? "Su questa destinazione non spediamo online: scrivici e vediamo cosa si può fare."
      :                               "Non riusciamo a fare un preventivo per questa spedizione: scrivici e ci pensiamo noi."
    return NextResponse.json({ errore: perIlVisitatore }, { status: esito.stato, headers: H })
  }

  // Al privato il prezzo si mostra IVA inclusa: e' un consumatore, la legge vuole il totale.
  // All'azienda no, perche' la fattura esce senza imposta (inversione contabile).
  const privato = corpo?.privato === true

  // Il nome della ZONA e' interno: "ITALIA V" ha in coda la sigla del fornitore, "SCS" e
  // "Zona 3" non dicono niente a nessuno. Qui diventano parole per chi compra.
  const zonaPubblica = (z: string): string => {
    const n = (z || '').toUpperCase()
    if (/ISOLE?\s*MINORI/.test(n)) return 'Isole minori'
    if (/DISAGIAT|PERIFERIC|ZONA\s*3/.test(n)) return 'Località disagiata'
    if (/LIVIGNO|CAMPIONE/.test(n)) return 'Livigno e Campione'
    if (/^SCS$/.test(n)) return 'Sicilia, Calabria o Sardegna'
    if (/SICILIA/.test(n)) return 'Sicilia'
    if (/SARDEGNA/.test(n)) return 'Sardegna'
    if (/CALABRIA/.test(n)) return 'Calabria'
    if (/ITALIA/.test(n)) return 'Italia'
    return z   // all'estero e' gia' il nome del paese
  }

  const offerte = (esito.risultati || []).map((r: any) => {
    const netto = Number(r.total_price)
    const marchio = marchioCorriere(r.corriere_nome || '')
    return {
      // Solo il MARCHIO: il nome del contratto e' roba interna e non esce mai.
      corriere: /^(Poste|SDA|GLS|BRT|UPS|TNT|DHL|FEDEX)$/i.test(marchio) ? marchio : 'Corriere',
      logo: logoCorriere(r.corriere_nome || ''),
      prezzo: netto.toFixed(2),
      prezzoConIva: (netto * (1 + IVA)).toFixed(2),
      daPagare: (privato ? netto * (1 + IVA) : netto).toFixed(2),
      ivaInclusa: privato,
      trasporto: r.prezzo_spedizione,
      contrassegno: r.costo_contrassegno,
      assicurazione: r.costo_assicurazione,
      pesoConsiderato: r.peso_fatturato,
      pesoReale: r.peso_reale,
      zona: zonaPubblica(r.zona),
      fascia: r.listino_fascia,
      limiti: r.limiti_collo || null,
    }
  })

  // UN'OFFERTA PER MARCHIO, la piu' conveniente.
  // Il motore restituisce un risultato per CONTRATTO, e di Poste ne abbiamo cinque: in vetrina
  // uscivano tre righe "Poste" a prezzi diversi che il cliente non puo' distinguere, perche' i
  // nomi dei contratti non si pubblicano. Delle nostre, gli diamo la migliore.
  const perMarchio = new Map<string, any>()
  for (const o of offerte.sort((a: any, b: any) => Number(a.prezzo) - Number(b.prezzo))) {
    if (!perMarchio.has(o.corriere)) perMarchio.set(o.corriere, o)
  }
  const scelte = [...perMarchio.values()]

  return NextResponse.json({ offerte: scelte, privato, iva: IVA }, { headers: H })
}
