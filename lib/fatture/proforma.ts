import { righeSpesa, voceSpesa, VOCI_SPESA, type RigaVoce } from './voci'
import { inizioGiornoRomaISO, fineGiornoRomaISO, giornoRoma } from '@/lib/date-roma'
import { senzaNomiFornitori } from '@/lib/corriere-logo'
import { ivaVendite } from '@/lib/iva-vendita'
import type { RegimeIva } from '@/lib/iva-calcolo'

// LA FATTURA PROFORMA (Lorenzo, 13/11/2026): il master sceglie un cliente e un periodo, e la proforma
// dice tutto quello che il cliente gli deve per quei giorni — spedizioni, rettifiche, giacenze, resi,
// servizi, voci scritte a mano, meno i rimborsi — "non importa se credito o fattura a scalare".
// Non e' una fattura: niente SDI, niente numero fiscale. Ha un suo numero per master e per anno.

// `iva_inclusa`: il movimento e' di una spedizione venduta IVA inclusa (l'importo contiene l'IVA).
// `esente`: il movimento e' di una spedizione venduta esente IVA (21/11/2026).
export type MovimentoProforma = { created_at: string; voce: string; descrizione: string; importo: number; iva_inclusa?: boolean; esente?: true }
export type Accrediti = { n: number; importo: number }
// Una voce scritta a mano dal master: entra solo se lui la spunta (lib/fatture/voci.ts, 'a_mano').
export type VoceAMano = { id: string; created_at: string; descrizione: string; importo: number; inclusa: boolean }

export type CalcoloProforma = {
  righe: RigaVoce[]
  imponibile: number
  movimenti: MovimentoProforma[]
  aMano: VoceAMano[]
  // Per informazione, fuori dal totale: quanto il cliente ha ricaricato e quanti contrassegni gli sono
  // stati accreditati nello stesso periodo (importi positivi = a favore del cliente).
  ricariche: Accrediti
  contrassegni: Accrediti
  // Movimenti di spedizioni vendute IVA inclusa: quanto e' uscito dal credito e quanta IVA conteneva.
  // Nelle righe sono gia' al netto (lib/fatture/voci.ts → righeSpesa).
  ivaInclusa: { lordo: number; iva: number }
  // Movimenti venduti esenti IVA: righe loro nel riepilogo, fuori dall'imponibile. Totale = imponibile + IVA + esente.
  esente: number
  // I movimenti che questa proforma prende: alla creazione si legano a lei (fatture_proforma_movimenti).
  legami: string[]
  // Le spese del periodo gia' in un'altra proforma: non entrano, e il master vede dove sono.
  gia: GiaInProforma
}

export type GiaInProforma = { n: number; importo: number; proforme: { id: string; numero: string; n: number; importo: number }[] }

// Oltre un anno il PDF diventa un libro, e la lettura tiene occupato il database per niente.
export const GIORNI_MAX = 366
// Il cliente piu' grosso fa ~7.000 movimenti al mese: 60.000 sono otto mesi del piu' grosso.
const MOVIMENTI_MAX = 60000

const GIORNO = /^\d{4}-\d{2}-\d{2}$/
const cent = (x: number) => Math.round((Number(x) || 0) * 100) / 100

export function motivoPeriodo(dal: string, al: string): string | null {
  if (!GIORNO.test(dal) || !GIORNO.test(al) || isNaN(Date.parse(dal)) || isNaN(Date.parse(al))) return 'Periodo non valido'
  if (dal > al) return 'La data di inizio è dopo quella di fine'
  if (al > giornoRoma()) return 'Il periodo non può finire dopo oggi'
  const giorni = (Date.parse(al) - Date.parse(dal)) / 86400000 + 1
  if (giorni > GIORNI_MAX) return `Il periodo può durare al massimo ${GIORNI_MAX} giorni`
  return null
}

// I movimenti del cliente nel periodo, gamba del cliente verso QUESTO master. Ordine stabile (giorno,
// id): si legge a pagine da 1.000, e un movimento nuovo arriva sempre in fondo, quindi non sposta le
// pagine gia' lette. `aManoIncluse`: gli id delle voci scritte a mano che il master ha spuntato; un id
// che non e' una voce a mano di questo cliente in questo periodo non conta.
// `aliquota`: quella del cliente (aliquotaDi), serve a scorporare i movimenti venduti IVA inclusa.
export async function calcolaProforma(admin: any, masterId: string, clienteId: string, dal: string, al: string, aManoIncluse: string[] = [], aliquota = 22): Promise<CalcoloProforma> {
  const inizio = inizioGiornoRomaISO(dal)
  const fine = fineGiornoRomaISO(al)
  const spuntate = new Set(aManoIncluse)
  const grezzi: { id: string; created_at: string; tipo: string; descrizione: string | null; importo: number; con_spedizione: boolean; spedizione_id: string | null; regime: RegimeIva; aliquota_compresa: number | null }[] = []
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('movimenti')
      .select('id,created_at,tipo,descrizione,importo,spedizione_id')
      .eq('master_id', masterId)
      .eq('cliente_id', clienteId)
      .is('master_target_id', null)
      .gte('created_at', inizio)
      .lte('created_at', fine)
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(da, da + 999)
    if (error) throw new Error('Movimenti non leggibili: ' + error.message)
    for (const m of data || []) {
      grezzi.push({ id: m.id, created_at: m.created_at, tipo: String(m.tipo || ''), descrizione: m.descrizione, importo: Number(m.importo) || 0, con_spedizione: !!m.spedizione_id, spedizione_id: m.spedizione_id || null, regime: 'esclusa', aliquota_compresa: null })
    }
    if (grezzi.length > MOVIMENTI_MAX) throw new Error('Troppi movimenti per una proforma sola: scegli un periodo più corto')
    if (!data || data.length < 1000) break
  }

  // UN MOVIMENTO IN UNA PROFORMA SOLA (27/11/2026). M.C LOGISTICA ha rifatto proforme su periodi gia' coperti
  // e le stesse spedizioni sono tornate dentro: la N.1/2026 di IN PUNTA DI PIEDI CASORIA (334 movimenti,
  // 1.573,19 €) era intera anche nella N.3, nella N.5 e nella N.7. Le spese gia' in una proforma restano fuori,
  // qualunque periodo si scelga; le si conta a parte per dire al master dove sono.
  const legati = await legamiNelPeriodo(admin, clienteId, inizio, fine)
  const giaPer = new Map<string, { n: number; importo: number }>()
  const liberi = grezzi.filter(m => {
    const p = legati.get(m.id)
    if (!p) return true
    const v = giaPer.get(p) || { n: 0, importo: 0 }
    v.n++; v.importo += -m.importo
    giaPer.set(p, v)
    return false
  })
  grezzi.splice(0, grezzi.length, ...liberi)
  const gia = await giaInProforma(admin, giaPer)

  // Come il master ha venduto la spedizione di ogni movimento: IVA inclusa, esclusa o esente. Lo decide il
  // database (fn_iva_vendita_regime, stessa regola dei report); i tipi che non seguono il listino: esclusa.
  const regime = await ivaVendite(admin, masterId, grezzi.map(m => m.spedizione_id ? { t: 'cliente' as const, s: clienteId, p: m.spedizione_id, m: m.tipo } : null))
  grezzi.forEach((m, i) => { m.regime = regime[i] })
  // Spese aggiunte a mano con l'IVA gia' dentro (Consumabili → Aggiungi spesa): si leggono le loro aliquote.
  const compresa = await aliquoteCompresa(admin, grezzi.filter(m => m.tipo === 'consumabile').map(m => m.id))
  for (const m of grezzi) { const a = compresa.get(m.id); if (a) m.aliquota_compresa = a }

  const movimenti: MovimentoProforma[] = []
  const aMano: VoceAMano[] = []
  const ricariche: Accrediti = { n: 0, importo: 0 }
  const contrassegni: Accrediti = { n: 0, importo: 0 }
  const contano: typeof grezzi = []
  for (const m of grezzi) {
    if (m.tipo === 'ricarica') { ricariche.n++; ricariche.importo += m.importo; continue }
    if (m.tipo === 'contrassegno') { contrassegni.n++; contrassegni.importo += m.importo; continue }
    const voce = voceSpesa(m.tipo, m.con_spedizione)
    if (!voce) continue
    // Il PDF arriva al cliente: le descrizioni scritte a mano passano dallo stesso filtro della Lista
    // Movimenti, che toglie i nomi dei fornitori tecnici.
    const descrizione = senzaNomiFornitori(String(m.descrizione || ''))
    if (voce === 'a_mano') {
      const inclusa = spuntate.has(m.id)
      aMano.push({ id: m.id, created_at: m.created_at, descrizione, importo: cent(-m.importo), inclusa })
      if (!inclusa) continue
    }
    contano.push(m)
    movimenti.push({ created_at: m.created_at, voce, descrizione, importo: cent(-m.importo), ...(m.regime === 'inclusa' || m.aliquota_compresa ? { iva_inclusa: true } : m.regime === 'esente' ? { esente: true as const } : {}) })
  }
  // Qui dentro ci sono gia' solo le voci a mano spuntate.
  const { righe, imponibile, esente, inclusa: ivaInclusa } = righeSpesa(contano.map(m => ({ tipo: m.tipo, con_spedizione: m.con_spedizione, n: 1, importo: m.importo, regime: m.regime, aliquota_compresa: m.aliquota_compresa })), true, aliquota)
  ricariche.importo = cent(ricariche.importo)
  contrassegni.importo = cent(contrassegni.importo)
  return { righe, imponibile, movimenti, aMano, ricariche, contrassegni, ivaInclusa, esente, legami: contano.map(m => m.id), gia }
}

// I movimenti del cliente nel periodo gia' legati a una proforma: id del movimento → id della proforma. Si
// cerca per cliente e giorno del movimento (indice idx_proforma_mov_cliente), a pagine da 1.000.
async function legamiNelPeriodo(admin: any, clienteId: string, inizio: string, fine: string): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  for (let da = 0; ; da += 1000) {
    const { data, error } = await admin.from('fatture_proforma_movimenti')
      .select('movimento_id,proforma_id')
      .eq('cliente_id', clienteId)
      .gte('movimento_creato', inizio)
      .lte('movimento_creato', fine)
      .order('movimento_id', { ascending: true })
      .range(da, da + 999)
    // Senza sapere cosa e' gia' in proforma non si calcola: si rischierebbe di rimettere dentro le stesse spese.
    if (error) throw new Error('Proforme precedenti non leggibili: ' + error.message)
    for (const r of data || []) out.set(r.movimento_id, r.proforma_id)
    if (!data || data.length < 1000) break
  }
  return out
}

async function giaInProforma(admin: any, per: Map<string, { n: number; importo: number }>): Promise<GiaInProforma> {
  if (!per.size) return { n: 0, importo: 0, proforme: [] }
  const { data, error } = await admin.from('fatture_proforma').select('id,numero,anno').in('id', [...per.keys()])
  if (error) throw new Error('Proforme precedenti non leggibili: ' + error.message)
  const num = new Map<string, string>((data || []).map((p: any) => [p.id, `${p.numero}/${p.anno}`]))
  const proforme = [...per.entries()]
    .map(([id, v]) => ({ id, numero: num.get(id) || '?', n: v.n, importo: cent(v.importo) }))
    .sort((a, b) => a.numero.localeCompare(b.numero, 'it', { numeric: true }))
  return { n: proforme.reduce((t, p) => t + p.n, 0), importo: cent(proforme.reduce((t, p) => t + p.importo, 0)), proforme }
}

// L'aliquota gia' compresa in ogni movimento segnato (scripts/iva-spese-compresa.sql). A blocchi di 200 id
// (oltre, l'indirizzo della richiesta diventa troppo lungo). Finche' la tabella non c'e', nessuna spesa e'
// segnata: tutto come prima. Qualunque altro errore ferma il calcolo, come le altre letture della proforma.
export async function aliquoteCompresa(admin: any, ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await admin.from('movimenti_iva_compresa').select('movimento_id,aliquota').in('movimento_id', ids.slice(i, i + 200))
    if (error) {
      if (['42P01', 'PGRST205'].includes(String(error.code || ''))) return out
      throw new Error('Spese con IVA compresa non leggibili: ' + error.message)
    }
    for (const r of data || []) out.set(r.movimento_id, Number(r.aliquota) || 0)
  }
  return out
}

// ── Chi la emette e a chi va ─────────────────────────────────────────────────────────────────────

export type Emittente = {
  nome: string; piva: string; cf: string; indirizzo: string; email: string; pec: string; telefono: string
  iban: string; banca: string; intestatario: string; logo: string | null
}
export type Destinatario = {
  ragione_sociale: string; piva: string; cf: string; indirizzo: string; email: string; pec: string; codice_cliente: string
}

const t = (v: any) => String(v ?? '').trim()
const riga = (...p: any[]) => p.map(t).filter(Boolean).join(' ')

// Prima l'indirizzo di fatturazione, se il master l'ha scritto; poi la sede.
export function emittenteDa(m: any): Emittente {
  const fatt = t(m?.indirizzo_fatturazione)
  const indirizzo = fatt
    ? riga(m.indirizzo_fatturazione, '-', m.cap_fatturazione, m.citta_fatturazione, m.provincia_fatturazione ? `(${t(m.provincia_fatturazione)})` : '')
    : riga(m?.indirizzo, m?.indirizzo ? '-' : '', m?.cap, m?.citta, m?.provincia ? `(${t(m.provincia)})` : '')
  // La partita IVA e' quella che il master scrive in Impostazioni (partita_iva); `piva` e' il campo
  // vecchio e su alcuni master e' diverso (GTS EXPRESS): vale solo se l'altro e' vuoto.
  return {
    nome: t(m?.nome), piva: t(m?.partita_iva) || t(m?.piva), cf: t(m?.codice_fiscale),
    indirizzo: indirizzo.replace(/^-\s*|\s*-$/g, ''), email: t(m?.email_sede) || t(m?.email), pec: t(m?.pec), telefono: t(m?.telefono),
    iban: t(m?.iban).replace(/\s/g, ''), banca: t(m?.banca), intestatario: t(m?.intestatario), logo: t(m?.logo_url) || null,
  }
}

export function destinatarioDa(c: any): Destinatario {
  return {
    ragione_sociale: t(c?.ragione_sociale), piva: t(c?.piva), cf: t(c?.cf),
    indirizzo: riga(c?.sl_indirizzo, c?.sl_indirizzo ? '-' : '', c?.sl_cap, c?.sl_citta, c?.sl_provincia ? `(${t(c.sl_provincia)})` : '').replace(/\s*-$/, ''),
    email: t(c?.email), pec: t(c?.pec), codice_cliente: t(c?.codice_cliente),
  }
}

export const CAMPI_MASTER = 'nome,partita_iva,piva,codice_fiscale,indirizzo,cap,citta,provincia,indirizzo_fatturazione,cap_fatturazione,citta_fatturazione,provincia_fatturazione,email,email_sede,pec,telefono,iban,banca,intestatario,logo_url,demo'
export const CAMPI_CLIENTE = 'id,master_id,ragione_sociale,piva,cf,pec,email,codice_cliente,sl_indirizzo,sl_cap,sl_citta,sl_provincia,aliquota_iva,natura_iva,tipo_contratto'

// L'aliquota del cliente; vuota = 22, come nel Report Fatture e nel report spedizioni del cliente.
export function aliquotaDi(c: any): number {
  const a = Number(c?.aliquota_iva)
  return c?.aliquota_iva != null && Number.isFinite(a) && a >= 0 ? a : 22
}

export function ivaDi(imponibile: number, aliquota: number): number {
  return cent(imponibile * aliquota / 100)
}

export const etichettaVoce = (chiave: string) => VOCI_SPESA.find(v => v.chiave === chiave)?.descrizione || chiave
