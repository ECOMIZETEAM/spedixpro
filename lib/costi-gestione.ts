import { eTitolareOAdmin } from '@/lib/ruoli'

// COSTI DI GESTIONE: le spese dell'azienda del master che il portale non vede (personale, affitto,
// mezzi, marketing...). Servono a una cosa sola: dal Guadagno Totale all'UTILE NETTO. Non sono
// movimenti e non toccano il credito di nessuno (scripts/costi-gestione.sql).
//
// Il calcolo di quanto pesa una voce in un periodo sta QUI e solo qui: lo usano la pagina, la card
// della dashboard, il Guadagno Totale e il Report Guadagno, e devono dare la stessa cifra.

// Proposte, non un elenco chiuso: il master puo' scriverne di sue (Lorenzo, 22/10).
export const CATEGORIE_PROPOSTE = [
  'Personale',
  'Autisti',
  'Mezzi e carburante',
  'Affitto e utenze',
  'Abbonamento piattaforma',
  'Sito e software',
  'Marketing e pubblicità',
  'Imballaggi e materiali',
  'Commercialista e consulenze',
  'Assicurazioni',
  'Banca e commissioni',
  'Tasse e imposte',
  'Altro',
]

export type Periodicita = 'una_tantum' | 'mensile' | 'annuale'
export type CostoGestione = {
  id: string
  categoria: string
  descrizione: string
  importo: number
  periodicita: Periodicita
  data_inizio: string
  data_fine: string | null
  note?: string | null
}

/** Stipendi e affitti sono affari del titolare: solo lui e i suoi admin. Non l'operatore, non l'agente,
 *  non il cliente (che ha anche lui un master_id, vedi lib/ruoli). */
export function puoGestireCosti(u: { ruolo?: string | null, master_id?: string | null, cliente_id?: string | null } | null | undefined): boolean {
  return !!u?.master_id && !u?.cliente_id && eTitolareOAdmin(u)
}

const r2 = (x: number) => Math.round(x * 100) / 100

// Le date viaggiano come 'YYYY-MM-DD' e si contano in giorni UTC: nessun fuso orario, un giorno e' un giorno.
const GIORNO = 86400000
const giorno = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / GIORNO
const daGiorno = (g: number) => new Date(g * GIORNO).toISOString().slice(0, 10)

export function dataValida(s: unknown): s is string {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const anno = +s.slice(0, 4)
  return anno >= 2000 && anno <= 2100 && daGiorno(giorno(s)) === s
}

/** Quanto pesa la voce nei giorni da `dal` ad `al`, inclusi.
 *  Una volta sola: tutto l'importo nel suo giorno. Ogni mese / ogni anno: la quota del mese (l'annuale
 *  diviso 12) divisa fra i giorni di QUEL mese. Cosi' un mese intero vale esattamente la quota, 1.500 €
 *  a ottobre come a febbraio, e un periodo qualunque della dashboard (oggi, ultimi 7 giorni, dal 1° a
 *  oggi) prende solo la parte maturata. */
export function quotaNelPeriodo(c: Pick<CostoGestione, 'importo' | 'periodicita' | 'data_inizio' | 'data_fine'>, dal: string, al: string): number {
  const importo = Number(c.importo) || 0
  if (c.periodicita === 'una_tantum') return c.data_inizio >= dal && c.data_inizio <= al ? r2(importo) : 0
  const da = Math.max(giorno(dal), giorno(c.data_inizio))
  const a = Math.min(giorno(al), c.data_fine ? giorno(c.data_fine) : Infinity)
  if (a < da) return 0
  const alMese = c.periodicita === 'annuale' ? importo / 12 : importo
  let tot = 0
  for (let g = da; g <= a;) {
    const d = new Date(g * GIORNO)
    const fineMese = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0) / GIORNO
    const giorniMese = new Date(fineMese * GIORNO).getUTCDate()
    const fino = Math.min(a, fineMese)
    tot += alMese * (fino - g + 1) / giorniMese
    g = fino + 1
  }
  return r2(tot)
}

/** Ultimo giorno di una durata: dal 01/10 per 3 mesi = fino al 31/12 (il giorno prima del 01/01). Se il
 *  giorno non esiste nel mese d'arrivo (31 gennaio + 1 mese) si arriva all'ultimo di quel mese. */
export function dataFineDaDurata(inizio: string, mesi: number): string {
  const y = +inizio.slice(0, 4), m = +inizio.slice(5, 7) - 1, d = +inizio.slice(8, 10)
  const giorniArrivo = new Date(Date.UTC(y, m + mesi + 1, 0)).getUTCDate()
  const arrivo = Date.UTC(y, m + mesi, Math.min(d, giorniArrivo)) / GIORNO
  return daGiorno(arrivo - 1)
}

export type RiepilogoCosti = {
  totale: number
  perCategoria: { categoria: string, importo: number, voci: { id: string, descrizione: string, importo: number }[] }[]
}

export function riepilogoCosti(costi: CostoGestione[], dal: string, al: string): RiepilogoCosti {
  const perCat = new Map<string, RiepilogoCosti['perCategoria'][number]>()
  let totale = 0
  for (const c of costi) {
    const q = quotaNelPeriodo(c, dal, al)
    if (!q) continue
    totale += q
    const k = c.categoria
    if (!perCat.has(k)) perCat.set(k, { categoria: k, importo: 0, voci: [] })
    const cat = perCat.get(k)!
    cat.importo = r2(cat.importo + q)
    cat.voci.push({ id: c.id, descrizione: c.descrizione, importo: q })
  }
  const perCategoria = Array.from(perCat.values()).sort((a, b) => b.importo - a.importo)
  for (const cat of perCategoria) cat.voci.sort((a, b) => b.importo - a.importo)
  return { totale: r2(totale), perCategoria }
}

/** Le voci del master che toccano il periodo (tutte, se il periodo manca). Poche righe per master:
 *  il conto si fa in memoria con quotaNelPeriodo. */
export async function leggiCostiGestione(admin: { from: (t: string) => any }, masterId: string, dal?: string, al?: string): Promise<CostoGestione[]> {
  let q = admin.from('costi_gestione')
    .select('id,categoria,descrizione,importo,periodicita,data_inizio,data_fine,note')
    .eq('master_id', masterId)
  if (dal && al) q = q.lte('data_inizio', al).or(`data_fine.is.null,data_fine.gte.${dal}`)
  const { data, error } = await q.order('data_inizio', { ascending: false }).order('id', { ascending: true })
  if (error) throw new Error(error.message)
  return ((data || []) as any[]).map(r => ({ ...r, importo: Number(r.importo) }))
}

/** Oggi a Roma, 'YYYY-MM-DD': i server girano in UTC e fra mezzanotte e le due "oggi" sarebbe ieri. */
export function oggiRoma(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
}
