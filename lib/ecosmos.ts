/* ECOSMOS (ecosmos.app) — corriere con mezzi elettrici, Roma e comuni dell'area metropolitana.
 *
 * Contratto PROPRIO di un master (il primo: 426 EXPRESS, 3/11/2026): una chiave `x-api-key` per account,
 * Ecosmos fattura il master, il master rivende ai suoi clienti coi suoi listini come ogni altro contratto.
 *
 * Documenti: guida partner https://ecosmos.app/api/readme e specifica https://ecosmos.app/openapi.json.
 * STORIA, perche' spiega la forma di questo file: il 3/11 l'API in funzione NON coincideva con la guida
 * (campi piatti `recipient_*`, fasce di peso, `postcode`) e questo file parlava con quella. Fra il 3/11 e il
 * 20/11 Ecosmos l'ha allineata alla guida (oggetti `recipient`/`sender`, `weight_kg`, `cod{amount}`,
 * `postal_code`) senza cambiare versione, e da allora ogni creazione sarebbe stata rifiutata. Ora si parla
 * con la versione della guida, che e' anche quella in funzione: verificato il 20/11 sulla loro specifica.
 * La loro regola di versione ("dentro v1 si aggiunge, non si rompe") vale da qui in avanti.
 *
 * Due regole loro che decidono come si scrive qui:
 *  - un campo che non prevedono e' un ERRORE (INVALID_FIELD), non viene ignorato: si manda solo quello che
 *    la guida elenca, mai un campo "per sicurezza";
 *  - la chiave dice l'ambiente: `eco_live_` produzione, `eco_test_` il loro ambiente di prova, separato in
 *    tutto. Una chiave di prova non crea spedizioni vere: da noi il cliente pagherebbe un pacco che nessuno
 *    ritira, quindi la creazione con una chiave di prova si fa solo chiedendola apposta (collaudo).
 *
 * Cosa NON si indovina, si legge dalle loro risposte: la modalita' con o senza conferma. Da noi una
 * spedizione creata e' definitiva, quindi se nasce in bozza (`draft`) si conferma subito.
 */

const BASE_PRODUZIONE = 'https://ecosmos.app/api/v1'
const BASE_PROVA = 'https://test.ecosmos.app/api/v1'

export type EcosmosCred = { api_key: string }

// Il formato della chiave e' quello della guida: prefisso dell'ambiente e poi il segreto. Il 19/11 nel
// contratto di 426 EXPRESS era finita la password del sito ecosmos.app (12 caratteri, nessun prefisso):
// ogni chiamata partiva con quella password nell'intestazione e tornava "chiave non valida". Una chiave
// che non ha questa forma non esce da qui.
const FORMA_CHIAVE = /^eco_(live|test)_\S{8,}$/
export const chiaveEcosmosValida = (chiave: string) => FORMA_CHIAVE.test(String(chiave || '').trim())
export const chiaveEcosmosDiProva = (chiave: string) => String(chiave || '').trim().startsWith('eco_test_')

type Risposta = { ok: boolean; status: number; j: any; codice: string | null; rete?: boolean; bytes?: Buffer }

async function chiama(c: EcosmosCred, metodo: 'GET' | 'POST', percorso: string, corpo?: any, intestazioni?: Record<string, string>, binario = false, attesaMs = 30000): Promise<Risposta> {
  const chiave = String(c?.api_key || '').trim()
  if (!chiave) throw avviso(ERRORI.MISSING_API_KEY)
  if (!chiaveEcosmosValida(chiave)) throw avviso(ERRORI.CHIAVE_MALFORMATA)
  let res: Response
  try {
    res = await fetch((chiaveEcosmosDiProva(chiave) ? BASE_PROVA : BASE_PRODUZIONE) + percorso, {
      method: metodo,
      headers: { 'x-api-key': chiave, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(intestazioni || {}) },
      body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
      // La creazione genera il PDF lato loro ed e' la chiamata piu' lenta: chi chiama decide quanto aspettare.
      signal: AbortSignal.timeout(attesaMs),
    })
  } catch (e: any) {
    // Rete caduta o tempo scaduto: la richiesta puo' essere arrivata. Chi chiama decide cosa vuol dire.
    return { ok: false, status: 0, j: { rete: String(e?.name || e?.message || 'errore di rete') }, codice: null, rete: true }
  }
  if (binario && res.ok) return { ok: true, status: res.status, j: null, codice: null, bytes: Buffer.from(await res.arrayBuffer()) }
  const testo = await res.text()
  let j: any
  try { j = testo ? JSON.parse(testo) : null } catch { j = { testo: testo.slice(0, 500) } }
  return { ok: res.ok, status: res.status, j, codice: j?.error?.code ? String(j.error.code) : null }
}

// Gli errori arrivano con un `code` stabile: qui diventano una frase che chi spedisce capisce e su cui
// puo' agire. Il `message` di Ecosmos e' inglese e "puo' cambiare" (loro guida): non va mostrato.
const ERRORI: Record<string, string> = {
  POSTAL_CODE_NOT_SERVED: 'Ecosmos non consegna a questo CAP: copre Roma e i comuni vicini. Scegli un altro contratto.',
  PICKUP_POSTAL_CODE_NOT_SERVED: 'Ecosmos non ritira da questo CAP: il mittente deve essere a Roma o nei comuni vicini. Scegli un altro contratto.',
  SERVICE_NOT_AVAILABLE: 'Il servizio Ecosmos di questo contratto non è disponibile verso questa destinazione. Scegli un altro contratto.',
  PRICE_UNAVAILABLE: 'Ecosmos non ha un prezzo per questo servizio e questo peso: scegli un altro contratto.',
  WEIGHT_LIMIT_EXCEEDED: 'Ecosmos accetta al massimo 30 kg per spedizione, sommando tutti i colli.',
  COUNTRY_NOT_SUPPORTED: 'Ecosmos consegna solo in Italia.',
  RECIPIENT_NOT_IDENTIFIABLE: 'Manca il nome del destinatario.',
  SENDER_NOT_IDENTIFIABLE: 'Manca il nome del mittente.',
  SENDER_EQUALS_RECIPIENT: 'Mittente e destinatario hanno lo stesso indirizzo: Ecosmos non accetta la spedizione.',
  INVALID_PICKUP_DATE: 'Data di ritiro non valida per Ecosmos (passata, giorno non lavorativo o oltre 90 giorni).',
  COD_LIMIT_EXCEEDED: 'Ecosmos accetta contrassegni fino a 4.999,00 €.',
  INSURANCE_LIMIT_EXCEEDED: 'Ecosmos assicura al massimo 1.000,00 € di valore della merce.',
  MISSING_API_KEY: 'Contratto Ecosmos senza chiave API: va inserita dal master nel contratto.',
  CHIAVE_MALFORMATA: 'La chiave API del contratto Ecosmos non è valida: deve iniziare con eco_live_ (non è la password del sito ecosmos.app). Va corretta dal master nel contratto.',
  INVALID_API_KEY: 'Ecosmos non riconosce la chiave API del contratto: va ricontrollata dal master nel contratto.',
  CHANNEL_DISABLED: 'Ecosmos ha disattivato il collegamento di questo contratto: il master deve sentire Ecosmos.',
  IP_NOT_ALLOWED: 'Ecosmos non accetta richieste dai nostri server su questo contratto: il master deve sentire Ecosmos.',
  ACCOUNT_DISABLED: 'L\'account Ecosmos di questo contratto è disattivato: il master deve sentire Ecosmos.',
  TECHNICAL_USER_INVALID: 'Ecosmos ha un problema di configurazione sull\'account: il master deve sentire Ecosmos.',
  RATE_LIMIT_EXCEEDED: 'Ecosmos sta ricevendo troppe richieste: riprova fra un minuto.',
  SERVICE_UNAVAILABLE: 'Ecosmos è in manutenzione: riprova fra qualche minuto.',
}

// Il campo segnalato da Ecosmos detto come lo direbbe chi compila il modulo.
const CAMPI: Record<string, string> = {
  street: 'indirizzo', street_number: 'civico', postal_code: 'CAP', city: 'città', province: 'provincia',
  phone: 'telefono', email: 'email', company_name: 'nome', first_name: 'nome', last_name: 'nome',
  weight_kg: 'peso', parcels: 'numero di colli', 'cod.amount': 'importo del contrassegno',
  'insurance.goods_value': 'valore assicurato', goods_description: 'contenuto', order_reference: 'riferimento ordine',
}
function campoLeggibile(campo: string): string {
  const c = String(campo || '')
  const [testa, ...resto] = c.split('.')
  const chi = testa === 'recipient' ? ' del destinatario' : testa === 'sender' ? ' del mittente' : ''
  const nome = chi ? (CAMPI[resto.join('.')] || resto.join('.')) : (CAMPI[c] || c)
  return nome ? `${nome}${chi}` : ''
}

// Gli errori scritti qui sono gia' frasi per chi spedisce: il segno `ecosmos` dice a chi li riceve di
// mostrarli cosi', senza passarli dal traduttore generico degli errori dei corrieri.
function avviso(testo: string): Error { return Object.assign(new Error(testo), { ecosmos: true }) }

function errore(r: Risposta, cosa: string): Error {
  if (r.rete) return avviso(`Ecosmos non risponde (${cosa}): riprova fra qualche minuto.`)
  // Una richiesta con piu' errori li porta tutti in `errors`, ognuno col suo codice e il suo campo; in
  // testa c'e' solo VALIDATION_FAILED. Vince il primo che sappiamo spiegare.
  const voci: any[] = Array.isArray(r.j?.error?.errors) ? r.j.error.errors : []
  for (const v of voci) if (ERRORI[String(v?.code)]) return avviso(ERRORI[String(v.code)])
  if (r.codice && ERRORI[r.codice]) return avviso(ERRORI[r.codice])
  const campi = [...new Set(voci.map((v) => campoLeggibile(v?.field)).filter(Boolean))]
  if (voci.length || r.status === 422) {
    return avviso(`Ecosmos: dati mancanti o non validi${campi.length ? ` (${campi.join(', ')})` : ''}. Controlla indirizzi, CAP, provincia e telefono.`)
  }
  if (r.status >= 500) return avviso(`Ecosmos non risponde (${cosa}): riprova fra qualche minuto.`)
  return avviso(`Ecosmos: ${cosa} non riuscita${r.codice ? ` (${r.codice})` : ''}`)
}

// --- Account, servizi, copertura ------------------------------------------------------------------

export async function pingEcosmos(c: EcosmosCred): Promise<{ account: string; idCliente: string; ambiente: string; richiedeConferma: boolean; raw: any }> {
  const r = await chiama(c, 'GET', '/ping')
  if (!r.ok) throw errore(r, 'verifica della chiave')
  return {
    account: String(r.j?.account?.company_name || ''),
    idCliente: String(r.j?.account?.external_customer_id || ''),
    ambiente: String(r.j?.environment || ''),
    richiedeConferma: r.j?.channel?.requires_confirmation === true,
    raw: r.j,
  }
}

export type ServiziEcosmos = { servizi: { code: string; name: string }[]; orarioLimite: string | null; contrassegno: boolean; pesoMassimo: number; raw: any }

// Servizi e limiti cambiano di rado: una lettura ogni 10 minuti per chiave basta, e risparmia una chiamata
// a ogni spedizione (Ecosmos ne concede 120 al minuto in lettura, per chiave).
const cacheServizi = new Map<string, { scade: number; v: ServiziEcosmos }>()

export async function serviziEcosmos(c: EcosmosCred): Promise<ServiziEcosmos> {
  const k = String(c?.api_key || '')
  const hit = cacheServizi.get(k)
  if (hit && hit.scade > Date.now()) return hit.v
  const r = await chiama(c, 'GET', '/services')
  if (!r.ok) throw errore(r, 'lettura dei servizi')
  const j = r.j || {}
  const v: ServiziEcosmos = {
    servizi: Array.isArray(j.services) ? j.services.map((s: any) => ({ code: String(s?.code ?? s), name: String(s?.name ?? s?.code ?? s) })) : [],
    orarioLimite: j.cutoff_time ? String(j.cutoff_time) : null,
    contrassegno: j.cod_available !== false,
    pesoMassimo: Number(j.max_weight_kg) || 30,
    raw: j,
  }
  cacheServizi.set(k, { scade: Date.now() + 10 * 60 * 1000, v })
  return v
}

// La risposta "non coperto" e' un 200 con served:false, non un errore. Un CAP che non ha 5 cifre invece e'
// un 422: si ferma qui, senza spendere una chiamata.
export async function coperturaEcosmos(c: EcosmosCred, cap: string): Promise<{ servito: boolean; servizi: string[]; raw: any }> {
  const capPulito = String(cap || '').trim()
  if (!/^\d{5}$/.test(capPulito)) throw avviso(`CAP non valido per Ecosmos: ${capPulito || '(vuoto)'}`)
  const r = await chiama(c, 'GET', `/coverage?postal_code=${capPulito}`)
  if (!r.ok) throw errore(r, 'verifica della copertura')
  const servizi = Array.isArray(r.j?.services) ? r.j.services.map((s: any) => String(s?.code ?? s)) : []
  return { servito: r.j?.served === true, servizi, raw: r.j }
}

// --- Spedizione -------------------------------------------------------------------------------------

// Ecosmos vuole la via e il civico separati, e il citofono deve tornare: "Via Roma 12" → via + "12".
// Senza un numero riconoscibile si manda la via intera e il civico vuoto: per la loro guida il civico
// "puo' stare" nella via, ed e' meglio che inventarne uno.
export function separaCivico(indirizzo: string): { via: string; civico: string | null } {
  const s = String(indirizzo || '').trim().replace(/\s+/g, ' ')
  const m = s.match(/^(.*?)[,\s]+(?:n\.?\s*|nr\.?\s*|num\.?\s*)?(\d+[a-zA-Z]?(?:\s*[\/-]\s*[\w]+)?)$/i)
  if (m && m[1].trim().length >= 3) return { via: m[1].replace(/[,\s]+$/, ''), civico: m[2].replace(/\s+/g, '').slice(0, 20) }
  if (/[,\s]snc$/i.test(s)) return { via: s.replace(/[,\s]+snc$/i, ''), civico: 'SNC' }
  return { via: s, civico: null }
}

const FORMA_SOCIETARIA = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc\.?|societ[aà]|ditta|coop\.?|cooperativa|onlus|associazione|studio|farmacia|negozio|srls)\b/i

export type RecapitoEcosmos = { nome: string; indirizzo: string; citta: string; cap: string; provincia: string; telefono?: string | null; email?: string | null }

// Un recapito nella forma di `sender`/`recipient`. Da noi il nome e' un campo solo: a Ecosmos va come
// azienda se lo e' (o se e' il mittente), altrimenti tutto in `first_name`. L'etichetta stampa la ragione
// sociale se c'e', altrimenti nome e cognome uno dopo l'altro: con tutto in un campo esce scritto come l'ha
// scritto chi spedisce, senza tentare di dividere "De Luca Mario" in nome e cognome.
function recapito(r: RecapitoEcosmos, comeAzienda: boolean): Record<string, any> {
  const { via, civico } = separaCivico(r.indirizzo)
  const nome = String(r.nome || '').trim()
  const o: Record<string, any> = {
    street: via.slice(0, 255),
    postal_code: String(r.cap || '').trim(),
    city: String(r.citta || '').trim().slice(0, 100),
    province: String(r.provincia || '').trim().toUpperCase(),
    country: 'IT',
  }
  if (civico) o.street_number = civico
  if (comeAzienda || FORMA_SOCIETARIA.test(nome)) o.company_name = nome.slice(0, 255)
  else o.first_name = nome.slice(0, 100)
  if (r.telefono) o.phone = String(r.telefono).trim().slice(0, 30)
  if (r.email) o.email = String(r.email).trim().slice(0, 255)
  return o
}

const euro = (v: number) => (Math.round(Number(v) * 100) / 100).toFixed(2)

export type SpedizioneEcosmosInput = {
  servizio: string                 // same_day | express_24h | standard_72h (dal contratto)
  colli: number                    // da 1 a 10: restano una sola lettera di vettura
  pesoKg: number                   // totale della spedizione: Ecosmos non pesa collo per collo
  mittente: RecapitoEcosmos        // il ritiro avviene a questo indirizzo
  destinatario: RecapitoEcosmos
  noteConsegna?: string | null     // stampate sull'etichetta: scala, citofono, «presso»
  contenuto?: string | null
  contrassegno?: number | null     // solo contanti per Ecosmos, fino a 4.999,00 €
  assicurazione?: number | null    // valore della merce da assicurare, fino a 1.000,00 €
  riferimento?: string | null      // torna in ogni loro risposta
  idempotenza: string              // UUID nostro: un rinvio dopo un timeout non crea un secondo pacco
}

export type EsitoCreazioneEcosmos = { numero: string; stato: string; trackingUrl: string | null; prezzo: number | null; etichettaBase64: string | null; raw: any }

const leggiEtichetta = (j: any): string | null => {
  const v = j?.label?.content
  return typeof v === 'string' && v.length > 100 ? v : null
}
const leggiPrezzo = (j: any): number | null => {
  const v = Number(j?.price?.amount)
  return Number.isFinite(v) ? v : null
}
const senzaEtichetta = (j: any) => (j && typeof j === 'object' ? { ...j, label: undefined } : j)

export async function creaSpedizioneEcosmos(c: EcosmosCred, d: SpedizioneEcosmosInput, opzioni: { prova?: boolean } = {}): Promise<EsitoCreazioneEcosmos> {
  // Una chiave di prova crea una spedizione nel loro ambiente di prova: nessuno la ritira. Da qui passano
  // il portale, l'API pubblica e ogni porta futura: il cliente pagherebbe un pacco finto.
  if (chiaveEcosmosDiProva(c?.api_key) && !opzioni.prova) {
    throw avviso('Il contratto Ecosmos ha una chiave di PROVA (eco_test_): le spedizioni vere partono solo con la chiave eco_live_. Va cambiata dal master nel contratto.')
  }
  const servizi = await serviziEcosmos(c)
  const peso = Math.round((Number(d.pesoKg) || 0) * 100) / 100
  if (!(peso > 0)) throw avviso('Ecosmos vuole il peso della spedizione.')
  if (peso > servizi.pesoMassimo) throw avviso(ERRORI.WEIGHT_LIMIT_EXCEEDED)
  const colli = Math.max(1, Math.floor(Number(d.colli) || 1))
  if (colli > 10) throw avviso('Ecosmos accetta al massimo 10 colli per spedizione.')
  const cod = Number(d.contrassegno) || 0
  if (cod > 0 && !servizi.contrassegno) throw avviso('Il contratto Ecosmos non ha il contrassegno attivo: rimuovilo o scegli un altro contratto.')
  if (cod > 4999) throw avviso(ERRORI.COD_LIMIT_EXCEEDED)
  const ass = Number(d.assicurazione) || 0
  if (ass > 1000) throw avviso(ERRORI.INSURANCE_LIMIT_EXCEEDED)

  const destinatario = recapito(d.destinatario, false)
  if (d.noteConsegna) destinatario.delivery_notes = String(d.noteConsegna).slice(0, 500)
  const corpo: Record<string, any> = {
    service: d.servizio,
    parcels: colli,
    weight_kg: euro(peso),
    recipient: destinatario,
    sender: recapito(d.mittente, true),
    include_label: true, label_format: 'pdf', label_layout: 'thermal_100x150', label_style: 'bw',
  }
  if (d.contenuto) corpo.goods_description = String(d.contenuto).slice(0, 200)
  if (d.riferimento) corpo.order_reference = String(d.riferimento).slice(0, 100)
  if (cod > 0) corpo.cod = { amount: euro(cod) }
  // Il cliente che chiede l'assicurazione la paga a noi: se non arriva a Ecosmos il pacco viaggia scoperto.
  if (ass > 0) corpo.insurance = { goods_value: euro(ass) }

  // Rete caduta o errore loro (5xx): la stessa richiesta con la STESSA Idempotency-Key una seconda volta.
  // Se la prima era arrivata, Ecosmos risponde con la spedizione gia' nata invece di crearne un'altra.
  let r = await chiama(c, 'POST', '/shipments/create', corpo, { 'Idempotency-Key': d.idempotenza }, false, 25000)
  if (r.rete || r.status >= 500) {
    r = await chiama(c, 'POST', '/shipments/create', corpo, { 'Idempotency-Key': d.idempotenza }, false, 25000)
  }
  // Ancora senza risposta: la spedizione puo' esserci. Non e' un "non creata", e chi chiama non deve
  // rimborsare alla cieca.
  if (r.rete) { const e: any = new Error('Ecosmos non ha risposto alla creazione: verifica sul portale Ecosmos prima di riprovare.'); e.forseCreata = true; e.raw = r.j; throw e }
  if (!r.ok) throw errore(r, 'creazione')
  const numero = String(r.j?.shipment_number || '').trim()
  if (!numero) { const e: any = new Error('Ecosmos ha risposto senza numero di spedizione: verifica sul portale Ecosmos prima di riprovare.'); e.forseCreata = true; e.raw = senzaEtichetta(r.j); throw e }

  let stato = String(r.j?.status || '')
  let etichetta = leggiEtichetta(r.j)
  let prezzo = leggiPrezzo(r.j)
  let raw = senzaEtichetta(r.j)              // il PDF si salva in etichetta_url, non due volte

  // Da noi una spedizione creata e' definitiva: se il canale lavora in due passi la si conferma subito.
  // Se la conferma fallisce, la bozza si annulla (una bozza non si ritira e non si fattura comunque).
  if (stato === 'draft') {
    const rc = await chiama(c, 'POST', `/shipments/${encodeURIComponent(numero)}/confirm`)
    if (!rc.ok) {
      await chiama(c, 'POST', `/shipments/${encodeURIComponent(numero)}/cancel`).catch(() => null)
      throw errore(rc, 'conferma')
    }
    stato = String(rc.j?.status || 'registered')
    etichetta = leggiEtichetta(rc.j) || etichetta     // dopo la conferma le date stampate possono cambiare
    prezzo = leggiPrezzo(rc.j) ?? prezzo
    raw = { creazione: raw, conferma: senzaEtichetta(rc.j) }
  }

  if (!etichetta) {
    try { const b = await etichettaEcosmos(c, numero); etichetta = b.toString('base64') } catch (e: any) { console.error('[ECOSMOS] etichetta dopo creazione', numero, e?.message) }
  }
  return { numero, stato, trackingUrl: r.j?.tracking_url ? String(r.j.tracking_url) : null, prezzo, etichettaBase64: etichetta, raw }
}

export async function etichettaEcosmos(c: EcosmosCred, numero: string, layout: 'thermal_100x150' | 'a4' | 'a4_folded' | 'a6_105x148' = 'thermal_100x150'): Promise<Buffer> {
  const r = await chiama(c, 'GET', `/shipments/${encodeURIComponent(numero)}/label?format=pdf&layout=${layout}&style=bw`, undefined, undefined, true)
  if (!r.ok || !r.bytes?.length) throw errore(r, 'etichetta')
  return r.bytes
}

// ANNULLO: Ecosmos lo accetta solo in draft e registered. Da ready_for_pickup in poi la spedizione e' nella
// pianificazione dei ritiri (ancora modificabile, non piu' annullabile) e Ecosmos la fattura. Si rimborsa
// SOLO su un annullo confermato da loro; su una gia' annullata rispondono 200 con lo stesso stato.
export async function annullaEcosmos(c: EcosmosCred, numero: string): Promise<{ annullata: boolean; giaPartita: boolean; messaggio: string; raw: any }> {
  const r = await chiama(c, 'POST', `/shipments/${encodeURIComponent(numero)}/cancel`)
  const stato = String(r.j?.status || '')
  if (r.ok && (stato === 'cancelled' || stato === 'voided')) return { annullata: true, giaPartita: false, messaggio: 'Annullata su Ecosmos', raw: r.j }
  if (r.codice === 'NOT_CANCELLABLE' || r.status === 409) return { annullata: false, giaPartita: true, messaggio: 'Ecosmos l\'ha già presa in carico per il ritiro: non si può più annullare.', raw: r.j }
  return { annullata: false, giaPartita: false, messaggio: errore(r, 'annullo').message, raw: r.j }
}

// --- Stati e tracciamento ---------------------------------------------------------------------------

// Stati Ecosmos → nostri. Registrata/pronta per il ritiro/ritiro mancato: il pacco non si e' ancora mosso →
// nessun avanzamento (resta l'evento). Annullata da loro: non si tocca lo stato qui; l'annullo da noi passa
// da annullaSpedizione col rimborso. Uno stato che non conosciamo e' "intermedio", mai un errore (loro guida:
// possono aggiungerne).
const STATI: Record<string, string | null> = {
  draft: null, registered: null, ready_for_pickup: null, pickup_failed: null,
  picked_up: 'spedita',
  in_transit: 'in_transito', postponed: 'in_consegna', rescheduled: 'in_transito',
  out_for_delivery: 'in_consegna',
  delivered: 'consegnata',
  delivery_failed: 'non_consegnato', exception: 'non_consegnato',
  returned_to_sender: 'reso_mittente',
  voided: null, cancelled: null,
}
export function mapStatoEcosmos(stato: string): string | null {
  const s = String(stato || '').toLowerCase().trim()
  return s in STATI ? STATI[s] : null
}

// Quello che legge chi apre la cronologia: la frase, non il codice.
const DESCRIZIONI: Record<string, string> = {
  draft: 'Bozza', registered: 'Registrata da Ecosmos', ready_for_pickup: 'Pronta per il ritiro',
  pickup_failed: 'Ritiro dal mittente non riuscito: si riprova al giro successivo',
  picked_up: 'Ritirata dal corriere', in_transit: 'In viaggio', out_for_delivery: 'In consegna oggi',
  postponed: 'Consegna riprogrammata più tardi in giornata, d\'accordo col destinatario',
  rescheduled: 'Consegna rinviata alla data concordata col destinatario',
  delivered: 'Consegnata', delivery_failed: 'Tentativo di consegna senza esito: si riprova',
  exception: 'Anomalia in gestione da Ecosmos', returned_to_sender: 'In restituzione al mittente',
  voided: 'Annullata da Ecosmos dopo la presa in carico', cancelled: 'Annullata',
}

export async function trackingEcosmos(c: EcosmosCred, numero: string): Promise<{
  stato: string; stati: string[]; consegnata: boolean; consegnataA: string | null
  eventi: { data: string; descrizione: string; luogo: string }[]
}> {
  const r = await chiama(c, 'GET', `/shipments/${encodeURIComponent(numero)}/tracking`)
  if (!r.ok) throw errore(r, 'tracciamento')
  // Eventi in ordine crescente, il piu' recente in fondo; una draft ha l'elenco vuoto.
  const lista: any[] = Array.isArray(r.j?.events) ? r.j.events : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  for (const ev of lista) {
    const st = String(ev?.status || '').trim()
    if (st) stati.push(st)
    const quando = String(ev?.occurred_at || '').trim()
    // `note` e' un messaggio pensato per il cliente (es. la nota del corriere a un tentativo): si mostra,
    // non si interpreta.
    const nota = String(ev?.note || '').trim()
    // Uno stato che Ecosmos aggiunge dopo oggi non ha ancora la sua frase: si dice che e' un aggiornamento
    // e si lascia il codice, che serve a chi deve poi scriverla.
    const descr = [DESCRIZIONI[st.toLowerCase()] || (st ? `Aggiornamento Ecosmos (${st})` : ''), nota].filter(Boolean).join(' — ')
    if (quando && descr) eventi.push({ data: quando, descrizione: descr, luogo: '' })
  }
  const stato = String(r.j?.status || stati[stati.length - 1] || '')
  if (stato && !stati.includes(stato)) stati.push(stato)
  return {
    stato, stati, eventi,
    consegnata: mapStatoEcosmos(stato) === 'consegnata' || !!r.j?.actual_delivery_date,
    consegnataA: r.j?.delivered_to ? String(r.j.delivered_to) : null,
  }
}
