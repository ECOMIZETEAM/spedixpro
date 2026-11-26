/* SPRING GDS (piattaforma XBS, gruppo PostNL) — spedizioni Italia, Europa e internazionali.
 *
 * Corriere della lista come GLS e BRT: ogni master aggiunge il SUO contratto con la SUA chiave API (portale
 * XBS, Profilo > API-key). Un contratto per ambito (Italia, Europa, Internazionale): il master che li vuole
 * tutti e tre ne aggiunge tre, ognuno col suo servizio Spring e il suo listino.
 *
 * Documento: «XBS API manual», versione 2026-09-02, girato da Lorenzo il 26/11/2026 (appunti in
 * ~/moovexpress-spring-doc/NOTE-API-SPRING.md). Le regole loro che decidono come e' scritto questo file:
 *
 *  - Una sola porta: POST JSON a mtapi.net con la chiave e il comando nel corpo. La risposta e' SEMPRE HTTP
 *    200: l'esito sta in ErrorLevel (0 fatto, 1 fatto ma in errore, 10 non fatto). Leggere lo status HTTP
 *    direbbe "riuscita" anche a una creazione rifiutata.
 *  - ErrorLevel 1 sulla creazione NON e' una spedizione: Spring la registra in stato Error con un numero
 *    TEMP… e un'etichetta «TEMPORARY LABEL - DO NOT SHIP». Fa lo stesso quando il loro server e' lento.
 *    Spedibile e' solo LabelType "Label"; tutto il resto si annulla subito e si dice perche'.
 *  - Una spedizione = un collo: l'API ha un solo peso. Il multicollo non esiste (lo ferma chi chiama).
 *  - ShipperReference e' unico per sempre sull'account: lo generiamo noi a ogni spedizione, e un secondo
 *    invio con lo stesso riferimento viene rifiutato. Dopo un timeout e' cosi' che si ritrova la spedizione
 *    senza crearne una seconda.
 *  - L'etichetta non si modifica in nessun modo (cap. 1.5): niente nome del master stampato sopra.
 *  - Annullo (VoidShipment) solo finche' Spring non ha accettato il pacco in hub.
 *  - Contrassegno solo verso Ungheria, Romania e Bulgaria (agosto 2026). Assicurazione: non prevista.
 */

import { PAESI_UE } from '@/lib/paesi-ue'
import { normalizzaPaese } from '@/lib/paesi'

const URL_PRODUZIONE = 'https://mtapi.net/'
const URL_PROVA = 'https://mtapi.net/?testMode=1'

// Il manuale chiede alle piattaforme che servono piu' clienti di dichiararsi in ogni creazione (cap. 2.2.4):
// e' cosi' che il loro supporto capisce da dove arriva una spedizione quando qualcosa va storto.
const SORGENTE = 'MoovExpress'

export type SpringCred = { api_key: string; ambiente?: string }
export type AmbitoSpring = 'italia' | 'europa' | 'internazionale'

// Le spedizioni di prova (testMode=1) non partono mai: nessuno le ritira. Un contratto in prova crea solo
// se lo si chiede apposta (collaudo), altrimenti il cliente pagherebbe un pacco finto.
export const springInProva = (c: SpringCred) => String(c?.ambiente || '').toLowerCase() === 'prova'

type Risposta = { livello: number; errore: string; j: any; rete: boolean; attesa?: string | null }

// Gli errori scritti qui sono gia' frasi per chi spedisce: il segno `spring` dice a chi li riceve di
// mostrarli cosi', senza passarli dal traduttore generico degli errori dei corrieri.
function avviso(testo: string, extra: Record<string, any> = {}): Error {
  return Object.assign(new Error(testo), { spring: true }, extra)
}

async function chiama(c: SpringCred, comando: string, corpo: Record<string, any>, attesaMs = 30000): Promise<Risposta> {
  const chiave = String(c?.api_key || '').trim()
  if (!chiave) throw avviso('Contratto Spring senza chiave API: va inserita dal master nel contratto.')
  let res: Response
  try {
    res = await fetch(springInProva(c) ? URL_PROVA : URL_PRODUZIONE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ Apikey: chiave, Command: comando, ...corpo }),
      signal: AbortSignal.timeout(attesaMs),
    })
  } catch (e: any) {
    // Rete caduta o tempo scaduto: la richiesta puo' essere arrivata. Chi chiama decide cosa vuol dire.
    return { livello: -1, errore: String(e?.name || e?.message || 'errore di rete'), j: null, rete: true }
  }
  const testo = await res.text()
  let j: any = null
  try { j = testo ? JSON.parse(testo) : null } catch { j = null }
  // Una risposta che non e' il loro JSON (pagina d'errore del bilanciatore, 5xx) non dice niente sull'esito:
  // va trattata come una rete caduta, non come un rifiuto.
  if (!j || typeof j.ErrorLevel !== 'number') {
    return { livello: -1, errore: `risposta non valida (HTTP ${res.status})`, j: j ?? { testo: testo.slice(0, 300) }, rete: true }
  }
  return { livello: j.ErrorLevel, errore: String(j.Error || '').trim(), j, rete: false, attesa: res.headers.get('X-Throttler-Limit') }
}

// Gli errori di Spring arrivano in inglese, come testo. Quelli che sappiamo spiegare diventano una frase su
// cui chi spedisce puo' agire; gli altri si mostrano cosi' come sono, perche' dicono il campo da correggere
// (es. «Invalid Consignee ZIP-code») e un messaggio generico lo nasconderebbe.
const TRADUZIONI: [RegExp, string][] = [
  [/access denied|invalid api ?key|apikey required/i, 'Spring non riconosce la chiave API del contratto: va ricontrollata dal master nel contratto (portale Spring, Profilo > API-key).'],
  [/shipper reference already exists/i, 'Spring ha già una spedizione con questo riferimento.'],
  [/invalid consignee zip/i, 'Spring: CAP del destinatario non valido. Controlla che sia scritto per intero (anche gli zeri iniziali).'],
  [/invalid consignee (state|province)|state (is )?required/i, 'Spring: manca o non è valido lo stato/provincia del destinatario (obbligatorio per Stati Uniti, Canada e Australia, sigla di 2-3 lettere).'],
  [/maximum weight exceeded|weight.*exceed/i, 'Spring: il peso supera il massimo del servizio di questo contratto.'],
  [/description required/i, 'Spring: manca la descrizione della merce (obbligatoria per la dogana).'],
  [/hs ?code/i, 'Spring: codice doganale HS non valido. Servono solo cifre: 6, 8 o 10 (per la Svizzera anche 7, 9, 11 o 13).'],
  [/service.*not (available|allowed|enabled)|invalid service/i, 'Spring: il servizio del contratto non è attivo sull\'account o non va verso questa destinazione. Il master deve controllare il servizio del contratto.'],
  [/too many|throttl/i, 'Spring sta ricevendo troppe richieste: riprova fra un minuto.'],
]
function errorePulito(testo: string, cosa: string): string {
  const t = String(testo || '').trim()
  for (const [re, frase] of TRADUZIONI) if (re.test(t)) return frase
  return t ? `Spring: ${t}` : `Spring: ${cosa} non riuscita.`
}

// --- Account e servizi ------------------------------------------------------------------------------

export type ServiziSpring = { consentiti: string[]; springClear: boolean; elenco: Record<string, string> }

// I servizi attivi cambiano di rado: una lettura ogni 10 minuti per chiave basta.
const cacheServizi = new Map<string, { scade: number; v: ServiziSpring }>()

export async function serviziSpring(c: SpringCred): Promise<ServiziSpring> {
  const k = `${springInProva(c) ? 'p' : 'l'}:${String(c?.api_key || '')}`
  const hit = cacheServizi.get(k)
  if (hit && hit.scade > Date.now()) return hit.v
  const r = await chiama(c, 'GetServices', {}, 20000)
  if (r.rete) throw avviso('Spring non risponde: riprova fra qualche minuto.')
  if (r.livello !== 0) throw avviso(errorePulito(r.errore, 'lettura dei servizi'))
  const s = r.j?.Services || {}
  const v: ServiziSpring = {
    consentiti: Array.isArray(s.AllowedServices) ? s.AllowedServices.map((x: any) => String(x).trim().toUpperCase()).filter(Boolean) : [],
    springClear: s.AllowedSpringClear === true,
    elenco: s.List && typeof s.List === 'object' ? Object.fromEntries(Object.entries(s.List).map(([a, b]) => [String(a).toUpperCase(), String(b)])) : {},
  }
  cacheServizi.set(k, { scade: Date.now() + 10 * 60 * 1000, v })
  return v
}

// --- Regole di destinazione -------------------------------------------------------------------------

// Dove puo' spedire un contratto. L'ambito non sostituisce le zone del listino (quelle decidono dove il
// corriere compare), ma le fa rispettare: un contratto «Europa» non manda un pacco negli Stati Uniti anche
// se qualcuno gli ha messo per sbaglio una zona mondo.
export function ambitoConsente(ambito: string | null | undefined, paese: string): boolean {
  const p = String(paese || '').trim().toUpperCase()
  const a = String(ambito || '').toLowerCase()
  if (!p) return false
  if (a === 'italia') return p === 'IT'
  if (a === 'europa') return p !== 'IT' && PAESI_UE.has(p)
  if (a === 'internazionale') return !PAESI_UE.has(p)
  return false
}
export const NOMI_AMBITO: Record<AmbitoSpring, string> = { italia: 'Italia', europa: 'Europa (UE)', internazionale: 'Internazionale (fuori UE)' }

// Contrassegno: per il manuale (agosto 2026) solo questi tre paesi, ognuno nella sua valuta.
const VALUTA_CONTRASSEGNO: Record<string, string> = { HU: 'HUF', RO: 'RON', BG: 'BGN' }

// Perche' un contratto Spring non puo' fare questa spedizione, PRIMA di mostrarlo nel preventivo: stesso
// posto e stessa forma della regola GLS (lib/gls.ts, motivoGlsNonServe), cosi' preventivo, creazione e API
// pubblica dicono la stessa cosa. Il multicollo si guarda qui e non solo con corrieri.multicollo: le copie
// del contratto ai sotto-master nascono col valore di default della colonna (vero), non con quello del
// detentore, e un collo solo con il peso di tre partirebbe con un'etichetta per tre pacchi.
export function motivoSpringNonServe(
  corriere: { tipo?: unknown; settings?: unknown } | null | undefined,
  dest: { paese?: unknown; contrassegno?: unknown; assicurazione?: unknown; colli?: unknown },
): string | null {
  if (corriere?.tipo !== 'spring') return null
  const st: any = corriere.settings || {}
  const ambito = String(st.spring_ambito || '').toLowerCase()
  // Il paese arriva anche per esteso dai file importati («Germania»): si legge come lo legge la regola GLS.
  const paese = normalizzaPaese(dest.paese)
  if (!NOMI_AMBITO[ambito as AmbitoSpring]) return 'Contratto Spring senza ambito (Italia, Europa o Internazionale): il master deve completarlo.'
  if (!ambitoConsente(ambito, paese)) return `Questo contratto Spring è per spedizioni ${NOMI_AMBITO[ambito as AmbitoSpring]}: per ${paese} scegli un altro contratto.`
  if (Number(dest.colli || 1) > 1) return 'Spring accetta un collo per spedizione: per più colli fai più spedizioni o scegli un altro corriere.'
  if (Number(dest.assicurazione || 0) > 0) return 'Spring non prevede l\'assicurazione: toglila o scegli un altro corriere.'
  if (Number(dest.contrassegno || 0) > 0 && !VALUTA_CONTRASSEGNO[paese]) return 'Spring fa il contrassegno solo verso Ungheria, Romania e Bulgaria: toglilo o scegli un altro corriere.'
  return null
}

// Stato/provincia obbligatorio, in sigla, solo per questi tre paesi.
const PAESI_CON_STATO = new Set(['US', 'CA', 'AU'])

// Il codice HS per la dogana: solo cifre, 6/8/10 (Svizzera anche 7/9/11/13). Il manuale dice che un codice
// fuori regola ferma la creazione: meglio dirlo qui, col nome dell'articolo, che girare il loro errore.
export function hsValido(hs: string, paese: string): boolean {
  const h = String(hs || '')
  if (!/^\d+$/.test(h)) return false
  if ([6, 8, 10].includes(h.length)) return true
  return String(paese || '').toUpperCase() === 'CH' && [7, 9, 11, 13].includes(h.length)
}

// Etichette: 35 caratteri per riga sono il massimo che tutti i loro vettori stampano (Royal Mail lo impone).
// Un indirizzo lungo non si tronca: va a capo sulla riga 2 e 3, a parole intere.
const MAX_RIGA = 35
function righeIndirizzo(testo: string): [string, string, string] {
  const parole = String(testo || '').trim().replace(/\s+/g, ' ').split(' ').filter(Boolean)
  const righe: string[] = ['']
  for (const p of parole) {
    const cur = righe[righe.length - 1]
    if (!cur) righe[righe.length - 1] = p.slice(0, MAX_RIGA)
    else if ((cur + ' ' + p).length <= MAX_RIGA) righe[righe.length - 1] = cur + ' ' + p
    else righe.push(p.slice(0, MAX_RIGA))
  }
  if (righe.length > 3) throw avviso(`Spring: l'indirizzo «${testo}» è troppo lungo per l'etichetta (massimo 3 righe da ${MAX_RIGA} caratteri). Accorcialo.`)
  return [righe[0] || '', righe[1] || '', righe[2] || '']
}
const corto = (s: any, n = MAX_RIGA) => String(s ?? '').trim().replace(/\s+/g, ' ').slice(0, n)

// --- Spedizione -------------------------------------------------------------------------------------

export type RecapitoSpring = {
  nome: string; indirizzo: string; citta: string; cap: string; paese: string
  provincia?: string | null; telefono?: string | null; email?: string | null; partitaIva?: string | null
  presso?: string | null            // «c/o»: va nella riga azienda, che l'etichetta stampa sotto il nome
}
export type ArticoloSpring = {
  descrizione: string; hsCode?: string | null; origine?: string | null; sku?: string | null
  quantita: number; valoreTotale: number; pesoTotaleKg: number
}
export type SpedizioneSpringInput = {
  servizio: string                  // codice del contratto (TRCK, SIGN, PPLEU, ITCR…)
  ambito: string                    // italia | europa | internazionale (dal contratto)
  riferimento: string               // ShipperReference: unico per sempre, lo genera chi chiama
  rifOrdine?: string | null         // stampato in chiaro e come secondo codice a barre (DisplayId)
  pesoKg: number                    // un collo: Spring non conosce il multicollo
  lunghezzaCm?: number | null; larghezzaCm?: number | null; altezzaCm?: number | null
  valore?: number | null            // valore della merce in EUR (dichiarazione CN22/CN23)
  contenuto?: string | null
  articoli?: ArticoloSpring[]       // obbligatori fuori UE: dogana voce per voce
  mittente: RecapitoSpring
  destinatario: RecapitoSpring
  contrassegno?: number | null
  assicurazione?: number | null
  formato?: 'PDF' | 'ZPL200' | 'ZPL300'
}
export type EsitoSpring = {
  numero: string; servizioFinale: string; vettore: string; numeroVettore: string
  trackingUrl: string | null; trackingUrlVettore: string | null
  etichettaBase64: string; formato: string; raw: any
}

// Riferimento unico per Spring: prefisso + tempo + caso, 20 caratteri, solo maiuscole e cifre (i loro
// codici a barre leggono male altro). Non contiene nulla del cliente.
export function nuovoRiferimentoSpring(): string {
  const t = Date.now().toString(36).toUpperCase()
  const r = Array.from(crypto.getRandomValues(new Uint8Array(8))).map((b) => (b % 36).toString(36)).join('').toUpperCase()
  return `MX${t}${r}`.slice(0, 20)
}

function recapitoMittente(r: RecapitoSpring) {
  const [l1, l2, l3] = righeIndirizzo(r.indirizzo)
  const o: Record<string, any> = {
    // Name e' chi firma la CN23, Company e' quello stampato nel «FROM»: da noi il mittente e' un campo solo.
    Name: corto(r.nome), Company: corto(r.nome),
    AddressLine1: l1, AddressLine2: l2, AddressLine3: l3,
    City: corto(r.citta), Zip: corto(r.cap, 20), Country: String(r.paese || 'IT').toUpperCase(),
  }
  if (r.provincia) o.State = corto(r.provincia, 3).toUpperCase()
  if (r.telefono) o.Phone = corto(r.telefono, 20)
  if (r.email) o.Email = corto(r.email, 100)
  if (r.partitaIva) o.Vat = corto(r.partitaIva, 30)
  return o
}

function recapitoDestinatario(r: RecapitoSpring) {
  const paese = String(r.paese || '').trim().toUpperCase()
  const [l1, l2, l3] = righeIndirizzo(r.indirizzo)
  const o: Record<string, any> = {
    Name: corto(r.nome), Company: r.presso ? corto(`c/o ${r.presso}`) : '',
    AddressLine1: l1, AddressLine2: l2, AddressLine3: l3,
    City: corto(r.citta), Zip: corto(r.cap, 20), Country: paese,
  }
  // Lo stato si manda solo dove serve: altrove una provincia italiana scritta per abitudine non va stampata.
  if (PAESI_CON_STATO.has(paese) || paese === 'IT') { if (r.provincia) o.State = corto(r.provincia, 3).toUpperCase() }
  if (r.telefono) o.Phone = corto(r.telefono, 20)
  if (r.email) o.Email = corto(r.email, 100)
  if (r.partitaIva) o.Vat = corto(r.partitaIva, 30)
  return o
}

const num = (v: number, dec: number) => String(Math.round(Number(v) * 10 ** dec) / 10 ** dec)

// Controlli che Spring farebbe dopo, fatti prima: con un errore che dice cosa correggere e, soprattutto,
// senza creare a Spring una spedizione in Error che poi va annullata.
export function verificaSpedizioneSpring(d: SpedizioneSpringInput): void {
  const paese = String(d.destinatario?.paese || '').trim().toUpperCase()
  if (!ambitoConsente(d.ambito, paese)) {
    const nome = NOMI_AMBITO[String(d.ambito || '').toLowerCase() as AmbitoSpring]
    throw avviso(nome
      ? `Questo contratto Spring è per spedizioni ${nome}: non spedisce verso ${paese || 'questa destinazione'}. Scegli il contratto Spring giusto o un altro corriere.`
      : 'Contratto Spring senza ambito (Italia, Europa o Internazionale): il master deve completarlo.')
  }
  if (!String(d.servizio || '').trim()) throw avviso('Contratto Spring senza servizio: il master deve sceglierlo nel contratto.')
  if (!(Number(d.pesoKg) > 0)) throw avviso('Spring vuole il peso della spedizione.')
  if (!String(d.destinatario?.nome || '').trim()) throw avviso('Spring: manca il nome del destinatario.')
  if (!String(d.destinatario?.indirizzo || '').trim()) throw avviso('Spring: manca l\'indirizzo del destinatario.')
  if (!String(d.destinatario?.citta || '').trim()) throw avviso('Spring: manca la città del destinatario.')
  if (PAESI_CON_STATO.has(paese) && !String(d.destinatario?.provincia || '').trim()) {
    throw avviso('Spring: per Stati Uniti, Canada e Australia serve lo stato del destinatario in sigla (es. NY, ON, NSW).')
  }
  if (Number(d.assicurazione) > 0) throw avviso('Spring non prevede l\'assicurazione: toglila o scegli un altro corriere.')
  const cod = Number(d.contrassegno) || 0
  if (cod > 0 && !VALUTA_CONTRASSEGNO[paese]) {
    throw avviso('Spring fa il contrassegno solo verso Ungheria, Romania e Bulgaria: toglilo o scegli un altro corriere.')
  }
  if (!PAESI_UE.has(paese)) {
    // Fuori UE la dogana vuole la merce voce per voce. Una dichiarazione a meta' sotto-dichiara il pacco:
    // si ferma se anche una sola riga e' incompleta.
    const art = d.articoli || []
    if (!art.length) throw avviso('Spedizione fuori UE con Spring: servono gli articoli per la dogana (descrizione, codice HS, quantità, valore e peso di ognuno).')
    for (const a of art) {
      const nome = String(a.descrizione || '').trim()
      if (!nome) throw avviso('Spring, dogana: c\'è un articolo senza descrizione.')
      // Nei cataloghi il codice si scrive spesso coi punti (6912.00): conta solo le cifre, come nel corpo.
      if (!hsValido(String(a.hsCode || '').replace(/\D/g, ''), paese)) throw avviso(`Spring, dogana: il codice HS di «${nome}» non è valido (solo cifre, 6, 8 o 10${paese === 'CH' ? '; per la Svizzera anche 7, 9, 11 o 13' : ''}).`)
      if (!(Number(a.quantita) > 0)) throw avviso(`Spring, dogana: manca la quantità di «${nome}».`)
      if (!(Number(a.valoreTotale) > 0)) throw avviso(`Spring, dogana: manca il valore di «${nome}».`)
      if (!(Number(a.pesoTotaleKg) > 0)) throw avviso(`Spring, dogana: manca il peso di «${nome}».`)
    }
  }
}

function corpoSpedizione(d: SpedizioneSpringInput): Record<string, any> {
  const paese = String(d.destinatario.paese || '').trim().toUpperCase()
  const s: Record<string, any> = {
    LabelFormat: d.formato || 'PDF',
    Source: SORGENTE,
    ShipperReference: d.riferimento,
    Service: String(d.servizio).trim().toUpperCase(),
    Weight: num(d.pesoKg, 3),
    WeightUnit: 'kg',
    Currency: 'EUR',
    CustomsDuty: 'DDU',
    DeclarationType: 'SaleOfGoods',
    ConsignorAddress: recapitoMittente(d.mittente),
    ConsigneeAddress: recapitoDestinatario(d.destinatario),
  }
  // Secondo codice a barre: il loro lettore legge solo maiuscole e cifre, e solo i primi 15.
  const disp = String(d.rifOrdine || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15)
  if (disp) s.DisplayId = disp
  if (Number(d.lunghezzaCm) > 0 && Number(d.larghezzaCm) > 0 && Number(d.altezzaCm) > 0) {
    s.Length = num(Number(d.lunghezzaCm), 1); s.Width = num(Number(d.larghezzaCm), 1); s.Height = num(Number(d.altezzaCm), 1); s.DimUnit = 'cm'
  }
  // Il valore dichiarato non si inventa: se chi spedisce non l'ha dato, per l'UE non si manda (fuori UE lo
  // portano gli articoli, verificati sopra).
  const articoli = d.articoli || []
  const valoreArticoli = articoli.reduce((t, a) => t + (Number(a.valoreTotale) || 0), 0)
  const valore = Number(d.valore) > 0 ? Number(d.valore) : valoreArticoli
  if (valore > 0) s.Value = num(valore, 2)
  if (d.contenuto) s.Description = corto(d.contenuto, 100)
  if (articoli.length) {
    s.Products = articoli.map((a) => {
      const p: Record<string, any> = {
        Description: corto(a.descrizione, 100),
        Quantity: String(Math.max(1, Math.round(Number(a.quantita) || 1))),
        Value: num(Number(a.valoreTotale) || 0, 2),          // totale della riga, non il prezzo unitario
        Weight: num(Number(a.pesoTotaleKg) || 0, 3),         // idem
      }
      if (a.hsCode) p.HsCode = String(a.hsCode).replace(/\D/g, '')
      if (a.origine) p.OriginCountry = String(a.origine).trim().toUpperCase().slice(0, 2)
      if (a.sku) p.Sku = corto(a.sku, 50)
      return p
    })
  }
  const cod = Number(d.contrassegno) || 0
  if (cod > 0) { s.CodAmount = Math.round(cod * 100) / 100; s.CodCurrency = VALUTA_CONTRASSEGNO[paese] }
  return s
}

function leggiEsito(j: any): EsitoSpring | null {
  const s = j?.Shipment || {}
  const numero = String(s.TrackingNumber || '').trim()
  const etichetta = typeof s.LabelImage === 'string' ? s.LabelImage : ''
  if (!numero || !etichetta) return null
  return {
    numero,
    servizioFinale: String(s.Service || s["Service'"] || ''),
    vettore: String(s.Carrier || ''),
    numeroVettore: String(s.CarrierTrackingNumber || s.CarrierLocalTrackingNumber || numero),
    trackingUrl: s.TrackingUrl ? String(s.TrackingUrl) : null,
    trackingUrlVettore: s.CarrierTrackingUrl ? String(s.CarrierTrackingUrl) : null,
    etichettaBase64: etichetta,
    formato: String(s.LabelFormat || 'PDF'),
    raw: { ...s, LabelImage: undefined },
  }
}

// Spedibile solo un'etichetta vera. TEMP = creata in Error (dati da correggere) o rimasta in coda da loro.
const etichettaVera = (j: any) => {
  const s = j?.Shipment || {}
  return String(s.LabelType || '').toLowerCase() === 'label' && !String(s.TrackingNumber || '').toUpperCase().startsWith('TEMP')
}

// La spedizione con questo riferimento, se Spring ce l'ha: serve dopo un timeout per sapere se e' nata.
async function cercaPerRiferimento(c: SpringCred, riferimento: string, formato: string): Promise<{ trovata: boolean; j: any; errore: string }> {
  const r = await chiama(c, 'GetShipmentLabel', { Shipment: { LabelFormat: formato, TrackingNumber: '', ShipperReference: riferimento } }, 30000)
  if (r.rete) { const e: any = avviso('Spring non ha risposto alla creazione: verifica sul portale Spring prima di riprovare.'); e.forseCreata = true; throw e }
  return { trovata: r.livello === 0 || r.livello === 1, j: r.j, errore: r.errore }
}

async function annullaTemporanea(c: SpringCred, riferimento: string, motivo: string) {
  try {
    const v = await chiama(c, 'VoidShipment', { Shipment: { TrackingNumber: '', ShipperReference: riferimento } }, 20000)
    if (v.livello !== 0) console.error('[SPRING] spedizione in errore NON annullata, annullarla dal portale Spring', riferimento, motivo, v.errore)
  } catch (e: any) { console.error('[SPRING] annullo della spedizione in errore', riferimento, e?.message) }
}

export async function creaSpedizioneSpring(c: SpringCred, d: SpedizioneSpringInput, opzioni: { prova?: boolean } = {}): Promise<EsitoSpring> {
  if (springInProva(c) && !opzioni.prova) {
    throw avviso('Il contratto Spring è in modalità PROVA: le spedizioni di prova non partono. Il master deve passarlo in produzione nel contratto.')
  }
  verificaSpedizioneSpring(d)
  const corpo = corpoSpedizione(d)
  const formato = corpo.LabelFormat

  // La creazione genera l'etichetta dal vettore finale e puo' essere lenta: 60 secondi.
  let r = await chiama(c, 'OrderShipment', { Shipment: corpo }, 60000)
  // Rete caduta: si ritenta UNA volta con lo stesso riferimento. Se la prima era arrivata, Spring risponde
  // «riferimento gia' esistente» e la si recupera qui sotto invece di crearne un'altra.
  if (r.rete) r = await chiama(c, 'OrderShipment', { Shipment: corpo }, 60000)
  if (r.rete) {
    const cerca = await cercaPerRiferimento(c, d.riferimento, formato)
    if (!cerca.trovata) throw avviso('Spring non ha risposto alla creazione e la spedizione non risulta: riprova.')
    r = { livello: cerca.j?.ErrorLevel ?? 0, errore: String(cerca.j?.Error || ''), j: cerca.j, rete: false }
  } else if (r.livello === 10 && /shipper reference already exists/i.test(r.errore)) {
    const cerca = await cercaPerRiferimento(c, d.riferimento, formato)
    if (!cerca.trovata) throw avviso(errorePulito(r.errore, 'creazione'))
    r = { livello: cerca.j?.ErrorLevel ?? 0, errore: String(cerca.j?.Error || ''), j: cerca.j, rete: false }
  }

  if (r.livello === 10) throw avviso(errorePulito(r.errore, 'creazione'))

  if (r.livello !== 0 || !etichettaVera(r.j)) {
    // Registrata da Spring ma NON spedibile (etichetta temporanea): si annulla subito, cosi' non resta sul
    // loro portale una spedizione che qualcuno potrebbe stampare, e si dice cosa correggere.
    await annullaTemporanea(c, d.riferimento, r.errore)
    throw avviso(r.errore
      ? `${errorePulito(r.errore, 'creazione')} (spedizione non creata)`
      : 'Spring non ha emesso l\'etichetta definitiva (solo una temporanea): spedizione non creata, riprova fra qualche minuto.')
  }

  const esito = leggiEsito(r.j)
  if (!esito) {
    const e: any = avviso('Spring ha risposto senza numero o senza etichetta: verifica sul portale Spring prima di riprovare.')
    e.forseCreata = true
    e.raw = { ...(r.j?.Shipment || {}), LabelImage: undefined }
    throw e
  }
  return esito
}

export async function etichettaSpring(c: SpringCred, numero: string, formato: 'PDF' | 'ZPL200' | 'ZPL300' = 'PDF'): Promise<{ base64: string; definitiva: boolean }> {
  const r = await chiama(c, 'GetShipmentLabel', { Shipment: { LabelFormat: formato, TrackingNumber: numero, ShipperReference: '' } })
  if (r.rete) throw avviso('Spring non risponde: riprova fra qualche minuto.')
  if (r.livello === 10) throw avviso(errorePulito(r.errore, 'ristampa dell\'etichetta'))
  const b = String(r.j?.Shipment?.LabelImage || '')
  if (!b) throw avviso('Spring non ha restituito l\'etichetta.')
  return { base64: b, definitiva: etichettaVera(r.j) }
}

// ANNULLO: Spring lo accetta solo prima che il pacco sia «Accepted» nel loro hub. Si rimborsa SOLO su un
// annullo confermato da loro (ErrorLevel 0): un rifiuto, una rete caduta o un testo che non conosciamo
// lasciano la spedizione addebitata, perche' il pacco potrebbe partire ed essere fatturato.
export async function annullaSpring(c: SpringCred, numero: string): Promise<{ annullata: boolean; giaPartita: boolean; messaggio: string; raw: any }> {
  const r = await chiama(c, 'VoidShipment', { Shipment: { TrackingNumber: numero, ShipperReference: '' } }, 20000)
  if (r.rete) return { annullata: false, giaPartita: false, messaggio: 'Spring non risponde: annullo non confermato, riprova fra qualche minuto.', raw: r.j }
  if (r.livello === 0) return { annullata: true, giaPartita: false, messaggio: 'Annullata su Spring', raw: r.j }
  if (/accepted|cannot be (void|cancel)|not allowed|already (in transit|processed)/i.test(r.errore)) {
    return { annullata: false, giaPartita: true, messaggio: 'Spring ha già preso in carico il pacco: non si può più annullare.', raw: r.j }
  }
  return { annullata: false, giaPartita: false, messaggio: errorePulito(r.errore, 'annullo'), raw: r.j }
}

// --- Stati e tracciamento ---------------------------------------------------------------------------

// Codici evento Spring (cap. 3 del manuale) → stati nostri. Si legge il CODICE, mai la descrizione: la
// stessa accettazione arriva come «ACCEPTED» dal tracking e «ACCEPTANCE» dal webhook.
//  - 101 «consegnata nel paese di destinazione» NON e' la consegna al destinatario: e' il passaggio al
//    postino locale (sui servizi non tracciati e' l'ultimo evento che arriva). Trattarla da consegnata
//    chiuderebbe il pacco e non vedremmo piu' un eventuale reso.
//  - 92 «in attesa di ritiro» = il pacco aspetta il destinatario all'ufficio postale o al punto, di solito
//    dopo un tentativo. NON e' una giacenza: da noi 'in_giacenza' apre la giacenza e ne fa partire l'addebito
//    alla rete, e Spring non fattura giacenze (chi non ritira torna indietro: 12504). Come per InPost, resta
//    una mancata consegna.
//  - Creata/etichetta/preparazione: il pacco non si e' mosso, nessun avanzamento.
const STATI: Record<number, string | null> = {
  0: null, 10: null, 12: null, 1001: null, 9999: null, 1910: null,
  15: 'spedita', 18: 'spedita', 19: 'spedita', 20: 'spedita',
  21: 'in_transito', 2101: 'in_transito', 2103: 'in_transito', 22: 'in_transito', 25: 'in_transito',
  9101: 'in_transito', 9102: 'in_transito', 93: 'in_transito', 2102: 'in_transito', 40: 'in_transito',
  9302: 'in_transito', 101: 'in_transito',
  9301: 'in_consegna',
  31: 'non_consegnato', 41: 'non_consegnato', 91: 'non_consegnato', 92: 'non_consegnato', 4106: 'non_consegnato',
  111: 'non_consegnato', 11101: 'non_consegnato', 11102: 'non_consegnato',
  100: 'consegnata',
  124: 'reso_mittente', 12406: 'reso_mittente', 125: 'reso_mittente', 12501: 'reso_mittente',
  12502: 'reso_mittente', 12503: 'reso_mittente', 12504: 'reso_mittente', 12505: 'reso_mittente', 12506: 'reso_mittente',
}
export function mapStatoSpring(codice: string | number): string | null {
  const n = Number(codice)
  return Number.isFinite(n) && n in STATI ? STATI[n] : null
}

const DESCRIZIONI: Record<number, string> = {
  0: 'Spedizione registrata', 10: 'Etichetta creata', 12: 'In preparazione dal mittente',
  15: 'In viaggio verso Spring', 18: 'Ritirata dal mittente', 19: 'Al deposito di smistamento',
  1001: 'Dati della spedizione incompleti', 20: 'Accettata da Spring', 21: 'Trasporto internazionale',
  2101: 'Partita dal paese di origine', 2103: 'Arrivata nel paese di destinazione', 22: 'Smistamento',
  25: 'Fine degli aggiornamenti di tracciamento', 31: 'Problema di consegna: serve un intervento',
  9101: 'Al deposito di transito del corriere locale', 9102: 'In transito', 93: 'Al deposito del corriere locale',
  2102: 'Sdoganata', 40: 'In dogana', 41: 'Fermo in dogana', 4106: 'Annullata dalla dogana',
  100: 'Consegnata', 101: 'Affidata al corriere del paese di destinazione', 111: 'Persa o distrutta',
  11101: 'Persa', 11102: 'Distrutta', 91: 'Tentativo di consegna non riuscito',
  92: 'In attesa di ritiro da parte del destinatario', 9301: 'In consegna', 9302: 'Consegna in ritardo',
  124: 'Reso in viaggio verso il mittente', 12406: 'Reso consegnato dal corriere', 125: 'Reso ricevuto',
  12501: 'Reso: rifiutata dal destinatario', 12502: 'Reso: non consegnabile', 12503: 'Reso: danneggiata',
  12504: 'Reso: non ritirata', 12505: 'Reso secondo accordi', 12506: 'Reso: distrutta',
  9999: 'Informazione', 1910: 'Etichetta rifatta',
}

export async function trackingSpring(c: SpringCred, numero: string): Promise<{
  stati: string[]; consegnata: boolean
  eventi: { data: string; descrizione: string; luogo: string }[]
  vettore: string | null
}> {
  const r = await chiama(c, 'TrackShipment', { Shipment: { TrackingNumber: numero, ShipperReference: '' } }, 20000)
  if (r.rete) throw avviso('Spring non risponde al tracciamento.')
  if (r.livello === 10) throw avviso(errorePulito(r.errore, 'tracciamento'))
  const lista: any[] = Array.isArray(r.j?.Shipment?.Events) ? r.j.Shipment.Events : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  for (const ev of lista) {
    const codice = Number(ev?.Code)
    if (Number.isFinite(codice)) stati.push(String(codice))
    // Timestamp e' UTC in secondi (loro manuale): e' l'unica data affidabile. DateTime e' l'ora locale del
    // vettore, in un formato che nel manuale arriva persino spezzato.
    const ts = Number(ev?.Timestamp)
    const data = Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : ''
    // Un codice nuovo che non abbiamo ancora tradotto: si mostra la loro descrizione, col codice.
    const nostra = DESCRIZIONI[codice] || (ev?.Description ? `${String(ev.Description)} (${codice})` : '')
    const delVettore = String(ev?.CarrierDescription || '').trim()
    const descrizione = [nostra, delVettore && delVettore.toUpperCase() !== String(ev?.Description || '').toUpperCase() ? delVettore : ''].filter(Boolean).join(' — ')
    const luogo = [ev?.City, ev?.Country].map((x: any) => String(x || '').trim()).filter(Boolean).join(', ')
    if (data && descrizione) eventi.push({ data, descrizione, luogo })
  }
  return {
    stati, eventi,
    consegnata: stati.some((s) => mapStatoSpring(s) === 'consegnata'),
    vettore: r.j?.Shipment?.Carrier ? String(r.j.Shipment.Carrier) : null,
  }
}
