import { righeSpesa, voceSpesa, VOCI_SPESA, type RigaVoce } from './voci'
import { inizioGiornoRomaISO, fineGiornoRomaISO, giornoRoma } from '@/lib/date-roma'
import { senzaNomiFornitori } from '@/lib/corriere-logo'

// LA FATTURA PROFORMA (Lorenzo, 13/11/2026): il master sceglie un cliente e un periodo, e la proforma
// dice tutto quello che il cliente gli deve per quei giorni — spedizioni, rettifiche, giacenze, resi,
// servizi, voci scritte a mano, meno i rimborsi — "non importa se credito o fattura a scalare".
// Non e' una fattura: niente SDI, niente numero fiscale. Ha un suo numero per master e per anno.

export type MovimentoProforma = { created_at: string; voce: string; descrizione: string; importo: number }
export type Accrediti = { n: number; importo: number }

export type CalcoloProforma = {
  righe: RigaVoce[]
  imponibile: number
  movimenti: MovimentoProforma[]
  // Per informazione, fuori dal totale: quanto il cliente ha ricaricato e quanti contrassegni gli sono
  // stati accreditati nello stesso periodo (importi positivi = a favore del cliente).
  ricariche: Accrediti
  contrassegni: Accrediti
}

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
// pagine gia' lette.
export async function calcolaProforma(admin: any, masterId: string, clienteId: string, dal: string, al: string): Promise<CalcoloProforma> {
  const inizio = inizioGiornoRomaISO(dal)
  const fine = fineGiornoRomaISO(al)
  const grezzi: { created_at: string; tipo: string; descrizione: string | null; importo: number; con_spedizione: boolean }[] = []
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
      grezzi.push({ created_at: m.created_at, tipo: String(m.tipo || ''), descrizione: m.descrizione, importo: Number(m.importo) || 0, con_spedizione: !!m.spedizione_id })
    }
    if (grezzi.length > MOVIMENTI_MAX) throw new Error('Troppi movimenti per una proforma sola: scegli un periodo più corto')
    if (!data || data.length < 1000) break
  }

  const movimenti: MovimentoProforma[] = []
  const ricariche: Accrediti = { n: 0, importo: 0 }
  const contrassegni: Accrediti = { n: 0, importo: 0 }
  for (const m of grezzi) {
    if (m.tipo === 'ricarica') { ricariche.n++; ricariche.importo += m.importo; continue }
    if (m.tipo === 'contrassegno') { contrassegni.n++; contrassegni.importo += m.importo; continue }
    const voce = voceSpesa(m.tipo, m.con_spedizione)
    if (!voce) continue
    // Il PDF arriva al cliente: le descrizioni scritte a mano passano dallo stesso filtro della Lista
    // Movimenti, che toglie i nomi dei fornitori tecnici.
    movimenti.push({ created_at: m.created_at, voce, descrizione: senzaNomiFornitori(String(m.descrizione || '')), importo: cent(-m.importo) })
  }
  const { righe, imponibile } = righeSpesa(grezzi.map(m => ({ tipo: m.tipo, con_spedizione: m.con_spedizione, n: 1, importo: m.importo })))
  ricariche.importo = cent(ricariche.importo)
  contrassegni.importo = cent(contrassegni.importo)
  return { righe, imponibile, movimenti, ricariche, contrassegni }
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
