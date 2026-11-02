/* LE SPEDIZIONI FATTE CON UN ALTRO GESTIONALE. Un detentore non spedisce solo da Moove: sullo stesso conto
 * BRT passano pacchi creati altrove, e la fattura li porta tutti. Le righe che Moove non trova si abbinano
 * all'export spedizioni di quel gestionale, e alla fine si restituisce il file di rettifiche nel SUO
 * formato, da caricare là: qui non si addebita niente.
 *
 * Il gestionale si riconosce dalle colonne del file, non dal nome: il nome dei fornitori non compare mai a
 * schermo (CLAUDE.md). Un formato nuovo = un elemento in FORMATI.
 *
 * Niente database: gira nel browser, sul file che il detentore ha in mano. */
import type { RigaFatturaBrt } from '@/lib/fattura-brt'

export type SpedizioneEsterna = {
  ldv: string
  cliente: string
  destinatario: string
  cap: string
  citta: string
  provincia: string
  colli: number
  peso: number                     // il peso su cui il gestionale ha fatto il prezzo (tassabile, se c'è)
  prezzoCliente: number            // quanto ha pagato il cliente, contrassegno compreso
  contrassegno: number
  data: string
  stato: string
}

export type FormatoEsterno = {
  id: string
  descrizione: string              // a schermo: cosa si è riconosciuto, senza nomi di fornitori
  riconosci: (colonne: string[]) => boolean
  leggi: (r: Record<string, any>) => SpedizioneEsterna
  // Il file da caricare nel gestionale: colonne e foglio come li vuole lui.
  rettifiche: { foglio: string; colonne: string[]; riga: (x: { ldv: string; peso: number }) => (string | number)[] }
}

// Numeri come li scrive l'export: "7,00" in testo oppure 1 come numero vero.
const num = (x: any) => {
  if (typeof x === 'number') return x
  const s = String(x ?? '').trim()
  if (!s) return 0
  return Number(s.includes(',') ? s.replace(/\./g, '').replace(',', '.') : s) || 0
}
const txt = (x: any) => String(x ?? '').trim()

export const FORMATI: FormatoEsterno[] = [
  {
    // Export spedizioni con la lettera di vettura in "ldv" e il peso tassabile: il file di rettifiche che
    // accetta ha LDV, identificativo multicollo, peso e le tre misure (tracciato mandato da Wave, 02/11).
    id: 'export-ldv',
    descrizione: 'Export spedizioni con lettera di vettura e peso tassabile',
    riconosci: c => ['ldv', 'peso_tassabile', 'costo_cliente', 'destinatario', 'cap'].every(k => c.includes(k)),
    leggi: r => ({
      ldv: txt(r.ldv), cliente: txt(r.Cliente), destinatario: txt(r.destinatario), cap: txt(r.cap), citta: txt(r.citta),
      provincia: txt(r.provincia), colli: num(r.colli) || 1, peso: num(r.peso_tassabile) || num(r.peso),
      prezzoCliente: num(r.costo_cliente), contrassegno: num(r.contrassegno), data: txt(r.Data_spedizione), stato: txt(r.status),
    }),
    rettifiche: {
      foglio: 'Rettifiche',
      colonne: ['LDV', 'IDENTIFICATIVO MULTICOLLO', 'PESO', 'LARGHEZZA', 'PROFONDITA', 'ALTEZZA'],
      riga: x => [x.ldv, '', x.peso, '', '', ''],
    },
  },
]

export const riconosciFormato = (colonne: string[]) => FORMATI.find(f => f.riconosci(colonne.map(c => String(c).trim()))) || null

// ── ABBINAMENTO ──
// L'andata (F1) porta lo stesso segnacollo della lettera di vettura. Reso (A2) e bolla accessoria (F3)
// hanno un segnacollo loro: si riconoscono dalla persona (nel reso è il MITTENTE, perché il pacco torna
// indietro; nella bolla accessoria è il destinatario), dal CAP e dalla filiale BRT di destinazione
// dell'andata, che sta dentro il segnacollo (reso 167067… ↔ andata 067167…, bolla 000087… ↔ andata
// 067087…). Sulla fattura di Wave di ottobre: 13 su 14, ognuna con un solo candidato. Se i candidati sono
// due, o nessuno, la riga resta non abbinata: meglio dirlo che attaccarla al pacco sbagliato.

const parole = (s: string) => new Set(String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
  .replace(/[^A-Z ]/g, ' ').split(/\s+/).filter(w => w.length > 1))
const somiglianza = (a: string, b: string) => {
  const A = parole(a), B = parole(b)
  if (!A.size || !B.size) return 0
  let k = 0; for (const w of A) if (B.has(w)) k++
  return k / Math.min(A.size, B.size)
}
const filialeArrivo = (ldv: string) => ldv.slice(3, 6)

export type AbbinataEsterna = {
  sped: SpedizioneEsterna
  andata: RigaFatturaBrt | null
  rientri: RigaFatturaBrt[]        // resi e bolle accessorie (giacenze) attaccati a questa spedizione
  brtAndata: number                // non arrotondati: i totali si sommano da qui (BRT scrive tre decimali)
  brtRientri: number
  // Prezzo al cliente − andata BRT: negativo = ci hai perso. Solo se l'andata è in QUESTA fattura: un pacco
  // di cui qui c'è solo il reso o la giacenza l'andata l'ha fatturata un'altra fattura, e il prezzo pagato
  // dal cliente era per quella. Resi e giacenze stanno a parte: l'export non dice se il cliente li ha pagati.
  margineAndata: number | null
  pesoBrt: number | null
  daRettificare: boolean           // BRT l'ha tassata più del peso su cui il gestionale ha fatto il prezzo
  multicollo: boolean              // la fattura dà il peso totale, non collo per collo: non va nel file
}

export function abbinaEsterne(righe: RigaFatturaBrt[], spedizioni: SpedizioneEsterna[]) {
  const perLdv = new Map(spedizioni.filter(s => s.ldv).map(s => [s.ldv, s]))
  const perCap = new Map<string, SpedizioneEsterna[]>()
  for (const s of spedizioni) { const v = perCap.get(s.cap) || []; v.push(s); perCap.set(s.cap, v) }

  const usate = new Map<string, { andata: RigaFatturaBrt | null; rientri: RigaFatturaBrt[] }>()
  const nonAbbinate: RigaFatturaBrt[] = []
  const prendi = (ldv: string) => { const v = usate.get(ldv) || { andata: null, rientri: [] }; usate.set(ldv, v); return v }

  for (const r of righe) {
    if (r.andata) {
      if (perLdv.has(r.segnacollo)) { prendi(r.segnacollo).andata = r; continue }
      nonAbbinate.push(r); continue
    }
    const reso = r.tipoBolla.startsWith('A')
    const persona = reso ? r.mittente : r.destinatario
    const cap = (reso ? r.capMittente : r.cap) || ''
    const filiale = reso ? r.segnacollo.slice(0, 3) : r.segnacollo.slice(3, 6)
    const candidati = (perCap.get(cap) || []).filter(s => filialeArrivo(s.ldv) === filiale && somiglianza(persona, s.destinatario) >= 0.5)
    if (candidati.length === 1) prendi(candidati[0].ldv).rientri.push(r)
    else nonAbbinate.push(r)
  }

  const r2 = (n: number) => Math.round(n * 100) / 100
  const abbinate: AbbinataEsterna[] = Array.from(usate.entries()).map(([ldv, v]) => {
    const sped = perLdv.get(ldv)!
    const brtAndata = v.andata?.totale || 0
    const brtRientri = v.rientri.reduce((s, x) => s + x.totale, 0)
    const pesoBrt = v.andata ? r2(v.andata.pesoTassato) : null
    const multicollo = sped.colli > 1
    return { sped, andata: v.andata, rientri: v.rientri, brtAndata, brtRientri,
      margineAndata: v.andata ? r2(sped.prezzoCliente - brtAndata) : null, pesoBrt,
      daRettificare: pesoBrt != null && pesoBrt > sped.peso + 0.001, multicollo }
  })
  return { abbinate, nonAbbinate }
}

// Le righe del file di rettifiche: solo le andate tassate da BRT più del peso del gestionale, una per
// lettera di vettura, col peso tassato da BRT. I multicollo restano fuori: la fattura dà il peso totale e il
// file lo vuole collo per collo; si fanno a mano.
export const righeRettificheEsterne = (abbinate: AbbinataEsterna[]) =>
  abbinate.filter(a => a.daRettificare && !a.multicollo).map(a => ({ ldv: a.sped.ldv, peso: a.pesoBrt! }))
