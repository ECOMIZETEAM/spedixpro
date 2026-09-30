/* Provider INPOST diretto — API "ShipX" (developers.inpost-group.com / guida InPost Italia).
 *
 * InPost è un CORRIERE REALE (brand mostrabile a valle, come BRT/GLS diretti): "ShipX" è solo il nome
 * dell'API. NON è un fornitore tecnico da nascondere. Nuovo `tipo='inpost'`.
 *
 * È BASATO SUI LOCKER (Paczkomat/punti): la spedizione va verso un `target_point` scelto, non a un semplice
 * indirizzo — salvo il servizio corriere a domicilio (inpost_courier_standard) se attivo sul contratto.
 *
 * Auth: header `Authorization: Bearer <token>`, token STATICO per-organizzazione (diverso staging/prod).
 * Le spedizioni nascono sotto `/v1/organizations/{organization_id}/...`. Host Italia dedicato.
 *
 * CICLO DI VITA (simplified mode, Italia): POST crea → InPost valida+compra+CONFERMA da solo in pochi
 * secondi → status `confirmed` → SOLO ALLORA l'etichetta è scaricabile. Il tracking_number è ASINCRONO
 * (arriva dopo, via webhook/polling), NON nella risposta di creazione.
 *
 * DA VALIDARE col primo token reale: host Points Italia, disponibilità COD sui locker, template collo.
 */
import { testoIndicaReso, prioritaStato } from '@/lib/spedisci'

const BASE = {
  prod: 'https://api-shipx-it.easypack24.net',
  staging: 'https://stage-api-shipx-it.easypack24.net',
}
// Punti/locker: la guida Italia indica un host dedicato; alcuni ambienti li espongono anche sull'host ShipX.
// Override per contratto con credenziali.pointsBaseUrl se InPost ne comunica un altro.
const POINTS = {
  prod: 'https://api-it-local-points.easypack24.net',
  staging: 'https://api-it-local-points.easypack24.net',
}

export type InpostCred = {
  token: string
  organizationId: string | number
  ambiente?: 'prod' | 'staging'   // default 'prod'
  pointsBaseUrl?: string          // override host punti se serve
}

function base(c: InpostCred): string { return BASE[c.ambiente === 'staging' ? 'staging' : 'prod'] }
function pointsBase(c: InpostCred): string { return c.pointsBaseUrl?.replace(/\/+$/, '') || POINTS[c.ambiente === 'staging' ? 'staging' : 'prod'] }

async function chiama(c: InpostCred, method: string, url: string, body?: unknown): Promise<{ ok: boolean; status: number; j: any }> {
  let r: Response
  try {
    r = await fetch(url, {
      method,
      headers: { 'Authorization': `Bearer ${c.token}`, 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e: any) { throw new Error('InPost non raggiungibile: ' + (e?.message || 'rete')) }
  // 204 (annullo) e alcune risposte non hanno corpo JSON.
  const txt = await r.text().catch(() => '')
  let j: any = {}
  try { j = txt ? JSON.parse(txt) : {} } catch { j = { _txt: txt } }
  return { ok: r.ok, status: r.status, j }
}

// Errore ShipX: { status, error, message, details:{campo:[...]} }. Ne tira fuori un messaggio leggibile.
function erroreInpost(j: any, status: number): string {
  if (j?.message && typeof j.message === 'string') {
    const dett = j?.details && typeof j.details === 'object'
      ? ' (' + Object.entries(j.details).map(([k, v]) => `${k}: ${Array.isArray(v) ? v.join(', ') : v}`).join('; ') + ')'
      : ''
    return String(j.message) + dett
  }
  return j?.error || `InPost: errore ${status}`
}

export type InpostRecapito = {
  ragioneSociale?: string
  nome?: string
  cognome?: string
  email?: string
  telefono?: string
  indirizzo?: string
  civico?: string
  citta?: string
  cap?: string
  paese?: string
}
export type InpostCollo = { peso: number | string; altezza?: number | string; larghezza?: number | string; profondita?: number | string }

// Peer (receiver/sender) nel formato ShipX. company_name se azienda, altrimenti nome/cognome.
function peer(r: InpostRecapito, conIndirizzo: boolean) {
  const p: any = {
    first_name: r.nome || (r.ragioneSociale ? undefined : ' '),
    last_name: r.cognome || undefined,
    company_name: r.ragioneSociale || undefined,
    email: r.email || undefined,
    phone: r.telefono ? String(r.telefono).replace(/[^0-9]/g, '') : undefined,
  }
  if (conIndirizzo) {
    p.address = {
      street: r.indirizzo || '', building_number: r.civico || '',
      city: r.citta || '', post_code: r.cap || '', country_code: (r.paese || 'IT').toUpperCase(),
    }
  }
  return p
}

// Template locker dal collo: small 8×38×64, medium 19×38×64, large 41×38×64 cm (≤25kg). Si sceglie il più
// piccolo in cui il collo entra (le misure sono in cm; qui i colli arrivano in cm). Se non entra → large.
function templateCollo(p: InpostCollo): 'small' | 'medium' | 'large' {
  const dims = [Number(p.altezza) || 0, Number(p.larghezza) || 0, Number(p.profondita) || 0].sort((a, b) => a - b)
  const entra = (max: number[]) => { const m = [...max].sort((a, b) => a - b); return dims[0] <= m[0] && dims[1] <= m[1] && dims[2] <= m[2] }
  if (entra([8, 38, 64])) return 'small'
  if (entra([19, 38, 64])) return 'medium'
  return 'large'
}

export type InpostSpedInput = {
  service: string                 // enum ShipX (settings.service): inpost_locker_standard | inpost_courier_standard | inpost_courier_c2c ...
  targetPoint?: string            // locker di destinazione (name, stato Operating) — per i servizi locker
  sendingMethod?: string          // parcel_locker | any_point ...
  labelless?: boolean             // aggiunge additional_services:['labelless']
  mittente: InpostRecapito
  destinatario: InpostRecapito
  colli: InpostCollo[]
  contrassegno?: number
  assicurata?: number
  reference?: string
  note?: string
}

// Crea la spedizione (simplified mode). Torna { id, status, tracking_number(può essere null), raw }.
export async function creaSpedizioneInpost(c: InpostCred, dati: InpostSpedInput): Promise<{ id: number; status: string; trackingNumber: string | null; raw: any }> {
  const aLocker = /locker/.test(dati.service) || dati.sendingMethod === 'parcel_locker' || dati.sendingMethod === 'any_point'
  const parcels = dati.colli.map((p) => ({
    template: templateCollo(p),
    dimensions: { length: String(Math.max(1, Math.round(Number(p.profondita) || 0) * 10)), width: String(Math.max(1, Math.round(Number(p.larghezza) || 0) * 10)), height: String(Math.max(1, Math.round(Number(p.altezza) || 0) * 10)), unit: 'mm' },
    weight: { amount: String(Math.max(0.1, Number(p.peso) || 0.1)), unit: 'kg' },
  }))
  // Il destinatario ha l'indirizzo SOLO per il corriere a domicilio; verso locker l'indirizzo non serve (c'è il target_point).
  const data: any = {
    receiver: peer(dati.destinatario, !aLocker),
    sender: peer(dati.mittente, true),
    parcels,
    service: dati.service,
  }
  const custom: any = {}
  if (dati.targetPoint) custom.target_point = dati.targetPoint
  if (dati.sendingMethod) custom.sending_method = dati.sendingMethod
  if (Object.keys(custom).length) data.custom_attributes = custom
  if (dati.contrassegno) data.cod = { amount: Number(dati.contrassegno), currency: 'EUR' }
  if (dati.assicurata) data.insurance = { amount: Number(dati.assicurata), currency: 'EUR' }
  if (dati.reference) data.reference = String(dati.reference).slice(0, 100)
  if (dati.note) data.comments = String(dati.note).slice(0, 100)
  if (dati.labelless) data.additional_services = ['labelless']

  const { ok, status, j } = await chiama(c, 'POST', `${base(c)}/v1/organizations/${c.organizationId}/shipments`, data)
  if (!ok || !j?.id) throw new Error(erroreInpost(j, status))
  return { id: Number(j.id), status: String(j.status || 'created'), trackingNumber: j.tracking_number ? String(j.tracking_number) : null, raw: j }
}

// Attende che la spedizione sia `confirmed` (simplified mode: pochi secondi). Torna {status, trackingNumber}.
// Il tracking_number è assegnato in modo asincrono: qui si fa polling breve (l'etichetta serve dopo confirmed).
export async function attendiConfermaInpost(c: InpostCred, id: number, tentativi = 8, attesaMs = 1500): Promise<{ status: string; trackingNumber: string | null; raw: any }> {
  let ultimo: any = {}
  for (let i = 0; i < tentativi; i++) {
    const { j } = await chiama(c, 'GET', `${base(c)}/v1/shipments/${id}`)
    ultimo = j
    const st = String(j?.status || '')
    if (st === 'confirmed' || (st && st !== 'created' && st !== 'offers_prepared' && st !== 'offer_selected')) {
      return { status: st, trackingNumber: j?.tracking_number ? String(j.tracking_number) : null, raw: j }
    }
    if (i < tentativi - 1) await new Promise((r) => setTimeout(r, attesaMs))
  }
  return { status: String(ultimo?.status || 'created'), trackingNumber: ultimo?.tracking_number ? String(ultimo.tracking_number) : null, raw: ultimo }
}

// Etichetta. Scaricabile SOLO quando la spedizione è `confirmed`. format Pdf|Zpl, type normal|A6.
export async function etichettaInpost(c: InpostCred, id: number, formato: 'pdf' | 'zpl' = 'pdf', type: 'normal' | 'A6' = 'A6'): Promise<{ contentType: string; bytes?: Buffer; zpl?: string }> {
  const fmt = formato === 'zpl' ? 'Zpl' : 'Pdf'
  let r: Response
  try {
    r = await fetch(`${base(c)}/v1/shipments/${id}/label?format=${fmt}&type=${type}`, { headers: { 'Authorization': `Bearer ${c.token}` } })
  } catch (e: any) { throw new Error('InPost non raggiungibile: ' + (e?.message || 'rete')) }
  if (!r.ok) { const t = await r.text().catch(() => ''); throw new Error(`InPost: etichetta non disponibile (${r.status})${t ? ' ' + t.slice(0, 120) : ''}`) }
  if (formato === 'zpl') return { contentType: 'text/plain', zpl: await r.text() }
  return { contentType: 'application/pdf', bytes: Buffer.from(await r.arrayBuffer()) }
}

// Annullo. Possibile SOLO in `created`/`offers_prepared` (prima di confirmed). In Italia il confirmed è quasi
// immediato → spesso non annullabile via API (va fatto dal Manager InPost). Torna {ok, motivo}.
export async function annullaInpost(c: InpostCred, id: number): Promise<{ ok: boolean; motivo: string }> {
  const { ok, status, j } = await chiama(c, 'DELETE', `${base(c)}/v1/shipments/${id}`)
  if (ok || status === 204) return { ok: true, motivo: '' }
  return { ok: false, motivo: erroreInpost(j, status) }
}

// ── STATI ──────────────────────────────────────────────────────────────────────
// Mappa il NOME-stato ShipX (enum stabile) sui nostri stati. NB: qui si mappa sul CODICE, non sulla
// descrizione (a differenza di Dielle/KSync): i nomi ShipX sono enum documentati e stabili.
const STATO_INPOST: Record<string, string> = {
  created: 'in_lavorazione',
  offers_prepared: 'in_lavorazione', offer_selected: 'in_lavorazione',
  confirmed: 'spedita',
  dispatched_by_sender: 'spedita', dispatched_by_sender_to_pok: 'spedita', collected_from_sender: 'spedita',
  taken_by_courier: 'in_transito', taken_by_courier_from_pok: 'in_transito',
  adopted_at_source_branch: 'in_transito', sent_from_source_branch: 'in_transito', adopted_at_sorting_center: 'in_transito',
  readdressed: 'in_transito', redirect_to_box: 'in_transito', delay_in_delivery: 'in_transito',
  out_for_delivery: 'in_consegna', out_for_delivery_to_address: 'in_consegna',
  ready_to_pickup: 'in_consegna', ready_to_pickup_from_pok: 'in_consegna', ready_to_pickup_from_branch: 'in_consegna',
  pickup_reminder_sent: 'in_consegna', pickup_reminder_sent_address: 'in_consegna',
  avizo: 'non_consegnato', pickup_time_expired: 'non_consegnato',
  undelivered: 'non_consegnato', undelivered_wrong_address: 'non_consegnato', undelivered_cod_cash_receiver: 'non_consegnato',
  rejected_by_receiver: 'non_consegnato', oversized: 'non_consegnato',
  delivered: 'consegnata',
  returned_to_sender: 'reso_mittente',
  canceled: 'annullata',
}
export function mapStatoInpost(nome: string): string | null {
  const s = String(nome || '').toLowerCase().trim()
  if (!s) return null
  if (STATO_INPOST[s]) return STATO_INPOST[s]
  // ripiego di sicurezza su parole chiave (se InPost aggiunge stati non mappati)
  if (testoIndicaReso(s) || s.includes('return')) return 'reso_mittente'
  if (s.includes('deliver') && !s.includes('undeliver') && !s.includes('out_for')) return 'consegnata'
  if (s.includes('cancel')) return 'annullata'
  if (s.includes('pickup') || s.includes('out_for')) return 'in_consegna'
  return null
}

// Testo italiano per la cronologia (i tracking_details portano solo il codice, non una frase leggibile).
const DESCR_INPOST: Record<string, string> = {
  created: 'Spedizione creata', confirmed: 'Spedizione confermata',
  dispatched_by_sender: 'Spedita dal mittente', collected_from_sender: 'Ritirata dal mittente',
  taken_by_courier: 'Presa in carico dal corriere', adopted_at_source_branch: 'Arrivata alla filiale di partenza',
  sent_from_source_branch: 'Partita dalla filiale', adopted_at_sorting_center: 'In smistamento',
  out_for_delivery: 'In consegna', out_for_delivery_to_address: 'In consegna',
  ready_to_pickup: 'Disponibile per il ritiro nel locker', ready_to_pickup_from_pok: 'Disponibile per il ritiro nel punto',
  pickup_reminder_sent: 'Promemoria di ritiro inviato', pickup_time_expired: 'Tempo di ritiro scaduto',
  avizo: 'Tentata consegna', delivered: 'Consegnata', rejected_by_receiver: 'Rifiutata dal destinatario',
  undelivered: 'Mancata consegna', returned_to_sender: 'In restituzione al mittente', canceled: 'Annullata',
}

// Tracking. `GET /v1/tracking/{tracking_number}` → { status, tracking_details:[{status,datetime,agency}] }.
// Torna la forma che si aspetta la cron (come trackingBrt): { stati, consegnata, eventi }.
export async function trackingInpost(c: InpostCred, trackingNumber: string): Promise<{ stati: string[]; consegnata: boolean; eventi: { data: string; descrizione: string; luogo: string }[] }> {
  const { ok, status, j } = await chiama(c, 'GET', `${base(c)}/v1/tracking/${encodeURIComponent(trackingNumber)}`)
  if (!ok) throw new Error(erroreInpost(j, status))
  const dettagli: any[] = Array.isArray(j?.tracking_details) ? j.tracking_details : []
  const stati: string[] = []
  const eventi: { data: string; descrizione: string; luogo: string }[] = []
  // lo stato "testa" + tutti gli stati dello storico
  if (j?.status) stati.push(String(j.status))
  for (const d of dettagli) {
    const st = String(d?.status || '').trim()
    if (st) stati.push(st)
    const quando = String(d?.datetime || '').trim()   // ISO con fuso → istanteDaTesto lo gestisce
    const descr = DESCR_INPOST[st.toLowerCase()] || st
    if (quando && descr) eventi.push({ data: quando, descrizione: descr, luogo: String(d?.agency || '').trim() })
  }
  const consegnata = stati.some((s) => mapStatoInpost(s) === 'consegnata')
  return { stati, consegnata, eventi }
}

// ── PUNTI / LOCKER ───────────────────────────────────────────────────────────
export type InpostPunto = { name: string; nome: string; tipo: string; indirizzo: string; citta: string; cap: string; lat?: number; lng?: number; h247?: boolean }
// Cerca i locker/punti vicino a un CAP (o coordinate). SOLO stato 'Operating' è selezionabile.
export async function puntiInpost(c: InpostCred, filtro: { cap?: string; lat?: number; lng?: number; maxDistanza?: number; tipo?: string; limite?: number }): Promise<InpostPunto[]> {
  const q = new URLSearchParams()
  q.set('status', 'Operating')
  if (filtro.lat != null && filtro.lng != null) { q.set('relative_point', `${filtro.lat},${filtro.lng}`); q.set('max_distance', String(filtro.maxDistanza || 10000)) }
  else if (filtro.cap) { q.set('relative_post_code', filtro.cap) }
  if (filtro.tipo) q.set('type', filtro.tipo)
  q.set('per_page', String(filtro.limite || 30))
  q.set('sort_by', 'distance_to_relative_point')
  const { ok, status, j } = await chiama(c, 'GET', `${pointsBase(c)}/v1/points?${q.toString()}`)
  if (!ok) throw new Error(erroreInpost(j, status))
  const items: any[] = Array.isArray(j?.items) ? j.items : Array.isArray(j) ? j : []
  return items.map((p) => ({
    name: String(p?.name || ''), nome: String(p?.display_name || p?.location_description || p?.name || ''),
    tipo: String(p?.type || ''),
    indirizzo: String(p?.address?.line1 || [p?.address_details?.street, p?.address_details?.building_number].filter(Boolean).join(' ') || ''),
    citta: String(p?.address_details?.city || ''), cap: String(p?.address_details?.post_code || ''),
    lat: p?.location?.latitude, lng: p?.location?.longitude, h247: p?.location_247 === true,
  }))
}
