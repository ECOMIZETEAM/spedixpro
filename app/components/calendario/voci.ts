// Dalle tre fonti (le tue voci, i ritiri, le giacenze) alle voci di ogni giorno, nella stessa forma.
import type { EventoMio, RitiroCal, GiacenzaCal, Voce, Filtri } from './tipi'
import { STATO_RITIRO, RITIRO_FALLITO } from './tipi'
import { chiaveGiorno, daChiave, inizioGiorno, piuGiorni } from './date'

// oltre questi numeri in un giorno le voci automatiche diventano una riga sola («43 ritiri»): una cella di mese ne
// mostra tre, e un master con decine di ritiri al giorno non deve vedere un muro di righe uguali. Da due in su:
// a 1280 px una pillola «Giacenza · …» si riduce a «Giacenza…» e non dice niente, «3 giacenze» sì
const SOGLIA_RITIRI = 1
const SOGLIA_GIACENZE = 1

const colli = (n: number | null) => (n == null ? null : `${n} ${n === 1 ? 'collo' : 'colli'}`)
const unisci = (...p: (string | null | undefined | false)[]) => p.filter(Boolean).join(' · ') || null

export function voceDaMio(e: EventoMio): Voce {
  return {
    // una voce che si ripete ha una chiave per occorrenza
    chiave: 'mio:' + e.id + (e.occorrenza ? ':' + e.occorrenza : ''), tipo: e.tipo, titolo: e.titolo,
    // la spedizione collegata ha già il suo cartellino nella riga: qui il luogo, e per un invito chi l'ha mandato
    sotto: [e.luogo, e.ruolo === 'invitato' && e.invito ? 'invito di ' + e.invito.organizzatore : null].filter(Boolean).join(' · ') || null,
    inizio: new Date(e.inizio), fine: e.fine ? new Date(e.fine) : null,
    tuttoIlGiorno: e.tutto_il_giorno, fatto: e.fatto, mio: e, ritiri: null, giacenze: null,
  }
}

function voceRitiro(r: RitiroCal, cliente: boolean): Voce {
  const chi = cliente ? null : (r.mittente || r.cliente)
  return {
    chiave: 'ritiro:' + r.id, tipo: 'ritiro',
    titolo: chi ? `Ritiro · ${chi}` : unisci('Ritiro', r.contratto) || 'Ritiro',
    sotto: unisci(cliente ? null : r.contratto, colli(r.colli), STATO_RITIRO[r.stato] || r.stato),
    inizio: daChiave(r.giorno), fine: null, tuttoIlGiorno: true, fatto: RITIRO_FALLITO.has(r.stato),
    mio: null, ritiri: [r], giacenze: null,
  }
}

function voceGiacenza(g: GiacenzaCal): Voce {
  return {
    chiave: 'giacenza:' + g.id, tipo: 'giacenza',
    titolo: `Giacenza · ${g.destinatario || g.numero || 'spedizione'}`,
    sotto: unisci(g.numero, g.citta, g.motivo),
    inizio: daChiave(g.giorno), fine: null, tuttoIlGiorno: true, fatto: false,
    mio: null, ritiri: null, giacenze: [g],
  }
}

// «BRT 20 · GLS 23»: di che corrieri è fatto un gruppo
function perCorriere(v: (RitiroCal | GiacenzaCal)[]): string | null {
  const n = new Map<string, number>()
  for (const x of v) { const k = x.contratto || 'altro'; n.set(k, (n.get(k) || 0) + 1) }
  return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([k, c]) => `${k} ${c}`).join(' · ') || null
}

export function costruisciGiorni(
  { miei, ritiri, giacenze, filtri, dal, al, cliente }:
  { miei: EventoMio[]; ritiri: RitiroCal[]; giacenze: GiacenzaCal[]; filtri: Filtri; dal: Date; al: Date; cliente: boolean },
): Map<string, Voce[]> {
  const giorni = new Map<string, Voce[]>()
  const metti = (k: string, v: Voce) => { const l = giorni.get(k); if (l) l.push(v); else giorni.set(k, [v]) }
  const dentro = (d: Date) => d >= dal && d < al

  if (filtri.miei) {
    for (const e of miei) {
      const v = voceDaMio(e)
      if (!e.tutto_il_giorno) { if (dentro(inizioGiorno(v.inizio))) metti(chiaveGiorno(v.inizio), v); continue }
      // tutto il giorno su più giorni: compare in ognuno (al massimo nel periodo mostrato)
      const ultimo = inizioGiorno(v.fine || v.inizio)
      for (let d = inizioGiorno(v.inizio); d <= ultimo; d = piuGiorni(d, 1)) if (dentro(d)) metti(chiaveGiorno(d), v)
    }
  }
  if (filtri.ritiri) {
    const per = new Map<string, RitiroCal[]>()
    for (const r of ritiri) { const l = per.get(r.giorno); if (l) l.push(r); else per.set(r.giorno, [r]) }
    for (const [k, l] of per) {
      if (!dentro(daChiave(k))) continue
      if (l.length <= SOGLIA_RITIRI) { for (const r of l) metti(k, voceRitiro(r, cliente)); continue }
      metti(k, {
        chiave: 'ritiri:' + k, tipo: 'ritiro', titolo: `${l.length} ritiri`, sotto: perCorriere(l),
        inizio: daChiave(k), fine: null, tuttoIlGiorno: true, fatto: false, mio: null, ritiri: l, giacenze: null,
      })
    }
  }
  if (filtri.giacenze) {
    const per = new Map<string, GiacenzaCal[]>()
    for (const g of giacenze) { const l = per.get(g.giorno); if (l) l.push(g); else per.set(g.giorno, [g]) }
    for (const [k, l] of per) {
      if (!dentro(daChiave(k))) continue
      if (l.length <= SOGLIA_GIACENZE) { for (const g of l) metti(k, voceGiacenza(g)); continue }
      metti(k, {
        chiave: 'giacenze:' + k, tipo: 'giacenza', titolo: `${l.length} giacenze`, sotto: perCorriere(l),
        inizio: daChiave(k), fine: null, tuttoIlGiorno: true, fatto: false, mio: null, ritiri: null, giacenze: l,
      })
    }
  }
  // in ogni giorno: prima le voci di tutto il giorno (ritiri, giacenze, le tue), poi quelle con l'ora
  const peso = (v: Voce) => (v.tuttoIlGiorno ? (v.tipo === 'ritiro' ? 0 : v.tipo === 'giacenza' ? 1 : 2) : 3)
  for (const l of giorni.values()) l.sort((a, b) => peso(a) - peso(b) || a.inizio.getTime() - b.inizio.getTime() || a.titolo.localeCompare(b.titolo))
  return giorni
}

// le voci con l'ora di un giorno, sistemate in colonne quando si accavallano (come Google)
export type Disposta = { v: Voce; inizioMin: number; fineMin: number; col: number; cols: number }
export function disponi(voci: Voce[], giorno: Date): Disposta[] {
  const t0 = inizioGiorno(giorno).getTime()
  const righe = voci.filter(v => !v.tuttoIlGiorno).map(v => {
    const a = Math.max(0, (v.inizio.getTime() - t0) / 60000)
    const b0 = v.fine ? (v.fine.getTime() - t0) / 60000 : a + 30
    return { v, inizioMin: a, fineMin: Math.min(24 * 60, Math.max(b0, a + 30)), col: 0, cols: 1 }
  }).sort((x, y) => x.inizioMin - y.inizioMin || y.fineMin - x.fineMin)
  const out: Disposta[] = []
  let gruppo: Disposta[] = [], fineGruppo = -1
  const chiudi = () => {
    const colonne: number[] = []
    for (const x of gruppo) {
      let c = colonne.findIndex(f => f <= x.inizioMin)
      if (c < 0) { c = colonne.length; colonne.push(0) }
      colonne[c] = x.fineMin; x.col = c
    }
    for (const x of gruppo) { x.cols = colonne.length; out.push(x) }
    gruppo = []; fineGruppo = -1
  }
  for (const x of righe) {
    if (gruppo.length && x.inizioMin >= fineGruppo) chiudi()
    gruppo.push(x); fineGruppo = Math.max(fineGruppo, x.fineMin)
  }
  if (gruppo.length) chiudi()
  return out
}
