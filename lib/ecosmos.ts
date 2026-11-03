/* ECOSMOS (ecosmos.app) — corriere con mezzi elettrici, Roma e comuni dell'area metropolitana.
 *
 * Contratto PROPRIO di un master (il primo: 426 EXPRESS, 3/11/2026): una chiave `x-api-key` per account,
 * Ecosmos fattura il master, il master rivende ai suoi clienti coi suoi listini come ogni altro contratto.
 *
 * Documenti: guida partner https://ecosmos.app/api/readme e specifica https://ecosmos.app/openapi.json
 * (copia in ~/moovexpress-ecosmos-doc). ATTENZIONE: la guida descrive un'API che NON coincide con quella
 * in funzione (versione 0.1.0, verificato il 3/11): la creazione vuole campi piatti `recipient_*` /
 * `sender_*` e una FASCIA di peso (`weight_band`) invece di oggetti annidati e dei chili; la copertura vuole
 * `postcode` e non `postal_code`. Qui si parla con quella IN FUNZIONE, ed e' l'unico file che la conosce:
 * se Ecosmos passa alla versione della guida si cambia solo questo.
 *
 * Cosa NON si indovina, si legge dalle loro risposte:
 *  - la modalita' con o senza conferma (`requires_confirmation` del ping): da noi una spedizione creata e'
 *    definitiva, quindi se nasce in bozza si conferma subito;
 *  - le fasce di peso ammesse (`weight_bands` di services): se il loro formato non si riconosce ci si
 *    ferma PRIMA di creare, invece di mandare una fascia a caso che sbaglierebbe il prezzo.
 */

const BASE = 'https://ecosmos.app/api/v1'

export type EcosmosCred = { api_key: string }

type Risposta = { ok: boolean; status: number; j: any; codice: string | null; bytes?: Buffer }

async function chiama(c: EcosmosCred, metodo: 'GET' | 'POST', percorso: string, corpo?: any, intestazioni?: Record<string, string>, binario = false): Promise<Risposta> {
  const chiave = String(c?.api_key || '').trim()
  if (!chiave) throw Object.assign(new Error('Contratto Ecosmos senza chiave API: va inserita dal master nel contratto.'), { ecosmos: true })
  const res = await fetch(BASE + percorso, {
    method: metodo,
    headers: { 'x-api-key': chiave, ...(corpo !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(intestazioni || {}) },
    body: corpo !== undefined ? JSON.stringify(corpo) : undefined,
    // La creazione genera il PDF lato loro (e' lenta per costruzione, vedi la loro specifica): 30 s.
    signal: AbortSignal.timeout(30000),
  })
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
  SERVICE_INVALID: 'Il servizio Ecosmos di questo contratto non è attivo sull\'account. Contatta l\'assistenza.',
  WEIGHT_LIMIT_EXCEEDED: 'Ecosmos accetta al massimo 30 kg per spedizione, sommando tutti i colli.',
  WEIGHT_BAND_INVALID: 'Ecosmos non ha accettato la fascia di peso: contatta l\'assistenza.',
  COUNTRY_NOT_SUPPORTED: 'Ecosmos consegna solo in Italia.',
  RECIPIENT_NOT_IDENTIFIABLE: 'Manca il nome del destinatario.',
  SENDER_NOT_IDENTIFIABLE: 'Manca il nome del mittente.',
  EMAIL_REQUIRED_FOR_NOTIFICATIONS: 'Ecosmos vuole l\'email del destinatario per avvisarlo della consegna.',
  INVALID_PICKUP_DATE: 'Data di ritiro non valida per Ecosmos (passata o giorno non lavorativo).',
  MISSING_API_KEY: 'Contratto Ecosmos senza chiave API: va inserita dal master nel contratto.',
  INVALID_API_KEY: 'La chiave API del contratto Ecosmos non è valida: va ricontrollata dal master nel contratto.',
  ACCOUNT_SUSPENDED: 'L\'account Ecosmos di questo contratto è sospeso: il master deve sentire Ecosmos.',
  RATE_LIMIT_EXCEEDED: 'Ecosmos sta ricevendo troppe richieste: riprova fra un minuto.',
}

// Gli errori scritti qui sono gia' frasi per chi spedisce: il segno `ecosmos` dice a chi li riceve di
// mostrarli cosi', senza passarli dal traduttore generico degli errori dei corrieri.
const avviso = (testo: string): Error => Object.assign(new Error(testo), { ecosmos: true })

function errore(r: Risposta, cosa: string): Error {
  const codice = r.codice || ''
  const campo = r.j?.error?.field ? ` (campo ${r.j.error.field})` : ''
  if (ERRORI[codice]) return avviso(ERRORI[codice])
  if (codice === 'MISSING_FIELD' || codice === 'INVALID_FIELD') return avviso(`Ecosmos: dato mancante o non valido${campo}. Controlla indirizzi, CAP, provincia e telefono.`)
  if (r.status >= 500) return avviso(`Ecosmos non risponde (${cosa}): riprova fra qualche minuto.`)
  return avviso(`Ecosmos: ${cosa} non riuscita${codice ? ` (${codice})` : ''}${campo}`)
}

// --- Account, servizi, copertura ------------------------------------------------------------------

export async function pingEcosmos(c: EcosmosCred): Promise<{ account: string; ambiente: string; richiedeConferma: boolean; raw: any }> {
  const r = await chiama(c, 'GET', '/ping')
  if (!r.ok) throw errore(r, 'verifica della chiave')
  return { account: String(r.j?.account || ''), ambiente: String(r.j?.environment || ''), richiedeConferma: r.j?.requires_confirmation === true, raw: r.j }
}

export type ServiziEcosmos = { servizi: { code: string; name: string }[]; orarioLimite: string | null; contrassegno: boolean; pesoMassimo: number; fasce: string[]; raw: any }

// Servizi e fasce cambiano di rado: una lettura ogni 10 minuti per chiave basta, e risparmia una chiamata
// a ogni spedizione (Ecosmos ne concede 120 al minuto in lettura, per chiave).
const cacheServizi = new Map<string, { scade: number; v: ServiziEcosmos }>()

export async function serviziEcosmos(c: EcosmosCred): Promise<ServiziEcosmos> {
  const k = String(c?.api_key || '')
  const hit = cacheServizi.get(k)
  if (hit && hit.scade > Date.now()) return hit.v
  const r = await chiama(c, 'GET', '/services')
  if (!r.ok) throw errore(r, 'lettura dei servizi')
  const j = r.j || {}
  const fasce = (Array.isArray(j.weight_bands) ? j.weight_bands : []).map((b: any) => typeof b === 'string' ? b : String(b?.code ?? b?.band ?? b?.value ?? '')).filter(Boolean)
  const v: ServiziEcosmos = {
    servizi: Array.isArray(j.services) ? j.services.map((s: any) => ({ code: String(s?.code ?? s), name: String(s?.name ?? s?.code ?? s) })) : [],
    orarioLimite: j.cutoff_time ? String(j.cutoff_time) : null,
    contrassegno: j.cod_available !== false,
    pesoMassimo: Number(j.max_weight_kg) || 30,
    fasce, raw: j,
  }
  cacheServizi.set(k, { scade: Date.now() + 10 * 60 * 1000, v })
  return v
}

// Il loro sistema in funzione vuole `postcode`, la guida `postal_code`: si mandano entrambi, il nome che
// non conosce lo ignora. La risposta "non coperto" e' un 200 con served:false, non un errore.
export async function coperturaEcosmos(c: EcosmosCred, cap: string): Promise<{ servito: boolean; servizi: string[]; raw: any }> {
  const capPulito = encodeURIComponent(String(cap || '').trim())
  const r = await chiama(c, 'GET', `/coverage?postcode=${capPulito}&postal_code=${capPulito}`)
  if (!r.ok) throw errore(r, 'verifica della copertura')
  const servizi = Array.isArray(r.j?.services) ? r.j.services.map((s: any) => String(s?.code ?? s)) : []
  return { servito: r.j?.served === true || servizi.length > 0, servizi, raw: r.j }
}

// FASCIA DI PESO dai nomi che Ecosmos stesso dichiara ammessi. Si accettano solo forme in cui il peso
// si legge senza ambiguita' ("0-3", "3-5 kg", "fino a 10", "oltre 20"): basta UNA fascia senza numeri
// e ci si ferma, perche' scegliere a caso vorrebbe dire far pagare al cliente una fascia sbagliata.
// Si sceglie la fascia piu' piccola che contiene il peso; un peso sul confine (3 kg con "0-3" e "3-5")
// sta nella prima, come per ogni listino a scaglioni.
export function fasciaPesoEcosmos(fasce: string[], kg: number): string | null {
  const peso = Math.max(0.01, Number(kg) || 0)
  const lette = fasce.map((f) => {
    const t = String(f).toLowerCase().replace(/(\d),(\d)/g, '$1.$2')
    const n = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number)
    if (!n.length) return null
    if (/oltre|over|più di|piu di|>|\+$/.test(t)) return { f, min: n[0], max: Infinity }
    if (n.length >= 2) return { f, min: n[0], max: n[n.length - 1] }
    return { f, min: 0, max: n[0] }
  })
  if (!lette.length || lette.some((x) => !x)) return null
  const adatte = (lette as { f: string; min: number; max: number }[])
    .filter((x) => peso <= x.max + 1e-9 && (x.max !== Infinity || peso > x.min - 1e-9))
    .sort((a, b) => a.max - b.max)
  return adatte[0]?.f ?? null
}

// --- Spedizione -------------------------------------------------------------------------------------

// Ecosmos vuole la via e il civico separati, e il citofono deve tornare: "Via Roma 12" → via + "12".
// Senza un numero riconoscibile si manda la via intera e il civico vuoto (il loro campo e' facoltativo
// nel sistema in funzione): meglio dell'inventarne uno.
export function separaCivico(indirizzo: string): { via: string; civico: string | null } {
  const s = String(indirizzo || '').trim().replace(/\s+/g, ' ')
  const m = s.match(/^(.*?)[,\s]+(?:n\.?\s*|nr\.?\s*|num\.?\s*)?(\d+[a-zA-Z]?(?:\s*[\/-]\s*[\w]+)?)$/i)
  if (m && m[1].trim().length >= 3) return { via: m[1].replace(/[,\s]+$/, ''), civico: m[2].replace(/\s+/g, '') }
  if (/[,\s]snc$/i.test(s)) return { via: s.replace(/[,\s]+snc$/i, ''), civico: 'SNC' }
  return { via: s, civico: null }
}

const FORMA_SOCIETARIA = /\b(s\.?r\.?l\.?s?|s\.?p\.?a\.?|s\.?n\.?c\.?|s\.?a\.?s\.?|soc\.?|societ[aà]|ditta|coop\.?|cooperativa|onlus|associazione|studio|farmacia|negozio|srls)\b/i

export type RecapitoEcosmos = { nome: string; indirizzo: string; citta: string; cap: string; provincia: string; telefono?: string | null; email?: string | null }

function recapito(prefisso: 'recipient' | 'sender', r: RecapitoEcosmos): Record<string, any> {
  const { via, civico } = separaCivico(r.indirizzo)
  const nome = String(r.nome || '').trim()
  // Un nome solo nel nostro modulo: a Ecosmos va come azienda se lo e', altrimenti come persona. Il loro
  // controllo vuole almeno uno fra azienda, nome e cognome; cosa finisce sull'etichetta lo decide il nome.
  const comeAzienda = prefisso === 'sender' || FORMA_SOCIETARIA.test(nome)
  const o: Record<string, any> = {
    [`${prefisso}_street`]: via,
    [`${prefisso}_city`]: String(r.citta || '').trim(),
    [`${prefisso}_postcode`]: String(r.cap || '').trim(),
    [`${prefisso}_province`]: String(r.provincia || '').trim().toUpperCase(),
  }
  if (civico) o[`${prefisso}_street_number`] = civico
  o[comeAzienda ? `${prefisso}_company` : `${prefisso}_name`] = nome
  if (r.telefono) o[`${prefisso}_phone`] = String(r.telefono).trim()
  if (r.email) o[`${prefisso}_email`] = String(r.email).trim()
  return o
}

export type SpedizioneEcosmosInput = {
  servizio: string                 // same_day | express_24h | standard_72h (dal contratto)
  colli: number
  pesoKg: number                   // totale della spedizione: Ecosmos non pesa collo per collo
  mittente: RecapitoEcosmos
  destinatario: RecapitoEcosmos
  noteConsegna?: string | null
  contenuto?: string | null
  contrassegno?: number | null     // solo contanti per Ecosmos
  riferimento?: string | null      // torna in ogni loro risposta e notifica
  idempotenza: string              // UUID nostro: un rinvio dopo un timeout non crea un secondo pacco
}

export type EsitoCreazioneEcosmos = { numero: string; stato: string; trackingUrl: string | null; prezzo: number | null; etichettaBase64: string | null; raw: any }

const leggiNumero = (j: any) => String(j?.shipment_number ?? j?.numero_ldv ?? j?.ldv ?? j?.number ?? '').trim()
const leggiEtichetta = (j: any): string | null => {
  const v = j?.label?.content ?? j?.label_base64 ?? j?.etichetta?.content ?? null
  return typeof v === 'string' && v.length > 100 ? v : null
}
const leggiPrezzo = (j: any): number | null => {
  const v = Number(j?.price?.amount ?? j?.price)
  return Number.isFinite(v) ? v : null
}

export async function creaSpedizioneEcosmos(c: EcosmosCred, d: SpedizioneEcosmosInput): Promise<EsitoCreazioneEcosmos> {
  const servizi = await serviziEcosmos(c)
  const peso = Math.round((Number(d.pesoKg) || 0) * 100) / 100
  if (peso > servizi.pesoMassimo) throw avviso(ERRORI.WEIGHT_LIMIT_EXCEEDED)
  let fascia: string | null = null
  if (servizi.fasce.length) {
    fascia = fasciaPesoEcosmos(servizi.fasce, peso)
    if (!fascia) throw avviso(`Ecosmos: nessuna fascia di peso riconoscibile per ${peso} kg (fasce dichiarate: ${servizi.fasce.join(', ')}). Contatta l'assistenza.`)
  }
  if (d.contrassegno && !servizi.contrassegno) throw avviso('Il contratto Ecosmos non ha il contrassegno attivo: rimuovilo o scegli un altro contratto.')

  const corpo: Record<string, any> = {
    service: d.servizio,
    parcels: Math.max(1, Math.floor(Number(d.colli) || 1)),
    ...recapito('recipient', d.destinatario),
    ...recapito('sender', d.mittente),
    include_label: true, label_format: 'pdf', label_layout: 'thermal_100x150', label_style: 'bw',
  }
  if (fascia) corpo.weight_band = fascia
  if (d.noteConsegna) corpo.recipient_delivery_notes = String(d.noteConsegna).slice(0, 500)
  if (d.contenuto) corpo.goods_description = String(d.contenuto).slice(0, 200)
  if (d.riferimento) corpo.external_order_reference = String(d.riferimento).slice(0, 100)
  if (d.contrassegno && Number(d.contrassegno) > 0) { corpo.cod = true; corpo.cod_amount = Number(Number(d.contrassegno).toFixed(2)) }

  const r = await chiama(c, 'POST', '/shipments/create', corpo, { 'Idempotency-Key': d.idempotenza })
  if (!r.ok) throw errore(r, 'creazione')
  const numero = leggiNumero(r.j)
  // Creata ma senza un numero leggibile: NON e' un "non creata". Si alza un errore che dice di
  // controllare sul loro portale, e chi chiama non deve rimborsare alla cieca.
  if (!numero) { const e: any = new Error('Ecosmos ha risposto senza numero di spedizione: verifica sul portale Ecosmos prima di riprovare.'); e.forseCreata = true; e.raw = r.j; throw e }

  let stato = String(r.j?.status ?? r.j?.stato ?? '')
  let etichetta = leggiEtichetta(r.j)
  let prezzo = leggiPrezzo(r.j)
  let raw = r.j

  // Da noi una spedizione creata e' definitiva: se il canale lavora in due passi la si conferma subito.
  // Se la conferma fallisce, la bozza si annulla (una bozza non si ritira e non si fattura comunque).
  if (stato === 'draft' || stato === 'ordine_provvisorio') {
    const rc = await chiama(c, 'POST', `/shipments/${encodeURIComponent(numero)}/confirm`)
    if (!rc.ok) {
      await chiama(c, 'POST', `/shipments/${encodeURIComponent(numero)}/cancel`).catch(() => null)
      throw errore(rc, 'conferma')
    }
    stato = String(rc.j?.status ?? rc.j?.stato ?? 'registered')
    etichetta = leggiEtichetta(rc.j) || etichetta     // dopo la conferma le date stampate possono cambiare
    prezzo = leggiPrezzo(rc.j) ?? prezzo
    raw = { creazione: r.j && { ...r.j, label: undefined }, conferma: rc.j && { ...rc.j, label: undefined } }
  } else if (raw?.label) {
    raw = { ...raw, label: undefined }               // il PDF si salva in etichetta_url, non due volte
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

// ANNULLO: Ecosmos lo accetta finche' la spedizione non e' stata validata per il giro di ritiro
// (draft/registered). Si rimborsa SOLO su un annullo confermato da loro: "non annullabile" vuol dire che
// il pacco e' gia' nella pianificazione o in viaggio, e Ecosmos lo fattura.
export async function annullaEcosmos(c: EcosmosCred, numero: string): Promise<{ annullata: boolean; giaPartita: boolean; messaggio: string; raw: any }> {
  const r = await chiama(c, 'POST', `/shipments/${encodeURIComponent(numero)}/cancel`)
  const stato = String(r.j?.status ?? r.j?.stato ?? '')
  if (r.ok && ['cancelled', 'voided', 'cancellata', 'annullata'].includes(stato)) return { annullata: true, giaPartita: false, messaggio: 'Annullata su Ecosmos', raw: r.j }
  if (r.codice === 'NOT_CANCELLABLE' || r.status === 409) return { annullata: false, giaPartita: true, messaggio: 'Ecosmos l\'ha già presa in carico per il ritiro: non si può più annullare.', raw: r.j }
  return { annullata: false, giaPartita: false, messaggio: errore(r, 'annullo').message, raw: r.j }
}

// --- Stati e tracciamento ---------------------------------------------------------------------------

// Stati Ecosmos → nostri. Valgono i nomi della guida (inglesi) e quelli interni del loro sistema che
// compaiono nella specifica (ordine_provvisorio, ritirato_corriere…), finche' le due versioni convivono.
// Registrata/pronta per il ritiro: il pacco non si e' ancora mosso → nessun avanzamento (resta l'evento).
// Annullata da loro: non si tocca lo stato qui; l'annullo da noi passa da annullaSpedizione col rimborso.
const STATI: Record<string, string | null> = {
  draft: null, ordine_provvisorio: null, registered: null, ordine_ricevuto: null,
  ready_for_pickup: null, pronto_per_consegna: null, pickup_failed: null,
  picked_up: 'spedita', ritirato_corriere: 'spedita',
  in_transit: 'in_transito', postponed: 'in_consegna', rescheduled: 'in_transito',
  out_for_delivery: 'in_consegna',
  delivered: 'consegnata', consegnata: 'consegnata',
  delivery_failed: 'non_consegnato', exception: 'non_consegnato',
  returned_to_sender: 'reso_mittente',
  voided: null, cancelled: null, cancellata: null,
}
export function mapStatoEcosmos(stato: string): string | null {
  const s = String(stato || '').toLowerCase().trim()
  return s in STATI ? STATI[s] : null
}

// Quello che legge chi apre la cronologia: la frase, non il codice.
const DESCRIZIONI: Record<string, string> = {
  draft: 'Bozza', registered: 'Registrata da Ecosmos', ordine_ricevuto: 'Registrata da Ecosmos',
  ready_for_pickup: 'Pronta per il ritiro', pronto_per_consegna: 'Pronta per il ritiro',
  picked_up: 'Ritirata dal corriere', ritirato_corriere: 'Ritirata dal corriere',
  in_transit: 'In viaggio', out_for_delivery: 'In consegna oggi',
  postponed: 'Consegna riprogrammata più tardi in giornata, d\'accordo col destinatario',
  rescheduled: 'Consegna rinviata alla data concordata col destinatario',
  delivered: 'Consegnata', delivery_failed: 'Tentativo di consegna senza esito: si riprova il giorno lavorativo dopo',
  pickup_failed: 'Ritiro dal mittente non riuscito', exception: 'Anomalia in gestione da Ecosmos',
  returned_to_sender: 'In restituzione al mittente', voided: 'Annullata da Ecosmos dopo la presa in carico',
  cancelled: 'Annullata', cancellata: 'Annullata',
}

export async function trackingEcosmos(c: EcosmosCred, numero: string): Promise<{
  stato: string; stati: string[]; consegnata: boolean; consegnataA: string | null
  eventi: { data: string; descrizione: string; luogo: string }[]
}> {
  const r = await chiama(c, 'GET', `/shipments/${encodeURIComponent(numero)}/tracking`)
  if (!r.ok) throw errore(r, 'tracciamento')
  const lista: any[] = Array.isArray(r.j?.events) ? r.j.events : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  for (const ev of lista) {
    const st = String(ev?.status ?? ev?.stato ?? '').trim()
    if (st) stati.push(st)
    const quando = String(ev?.timestamp ?? ev?.changed_at ?? '').trim()
    const nota = String(ev?.nota ?? ev?.note ?? '').trim()
    const descr = [DESCRIZIONI[st.toLowerCase()] || st, nota].filter(Boolean).join(' — ')
    if (quando && descr) eventi.push({ data: quando, descrizione: descr, luogo: '' })
  }
  const stato = String(r.j?.status ?? r.j?.stato ?? stati[stati.length - 1] ?? '')
  if (stato && !stati.includes(stato)) stati.push(stato)
  return {
    stato, stati, eventi,
    consegnata: mapStatoEcosmos(stato) === 'consegnata' || !!r.j?.actual_delivery_date,
    consegnataA: r.j?.delivered_to ? String(r.j.delivered_to) : null,
  }
}
