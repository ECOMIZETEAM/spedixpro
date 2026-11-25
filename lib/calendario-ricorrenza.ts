// LE VOCI CHE SI RIPETONO (calendario, fase 2, 25/11/2026). Una regola sola per tutti quelli che le srotolano: il
// calendario (/api/calendario/eventi), la campanella (/api/notifiche/mie), il giro delle email
// (/api/cron/calendario-avvisi) e il link per Google e iPhone (/api/calendario/ical). Funzione pura: vale sul server
// (Vercel gira in UTC) e nel browser.
//
// SI RAGIONA IN ORA DI ROMA. Una riunione «ogni lunedì alle 9» resta alle 9 anche dopo il cambio dell'ora: si
// sommano giorni di calendario all'ora «da orologio», e solo alla fine si passa all'istante (istanteDaOraRoma).
// Sommare 7×24 ore all'istante la sposterebbe alle 8 o alle 10 per mezzo anno.
//
// Come i calendari che tutti conoscono (e come la norma dei file .ics, RFC 5545):
//  - «ogni mese il 31» salta i mesi che non hanno il 31; «ogni anno il 29 febbraio» salta gli anni non bisestili;
//  - «dopo N volte» conta anche le occorrenze tolte una a una (eccezioni);
//  - «fino al» è compreso.
import { istanteDaOraRoma } from '@/lib/date-roma'

export type Frequenza = 'giorno' | 'settimana' | 'mese' | 'anno'
export type Ricorrenza = {
  freq: Frequenza
  ogni: number                 // ogni N giorni/settimane/mesi/anni
  giorni?: number[] | null     // solo «settimana»: 0 = lunedì … 6 = domenica
  fino?: string | null         // 'YYYY-MM-DD' compreso
  volte?: number | null        // dopo N occorrenze
}

export type Occorrenza = { giorno: string; inizio: Date; fine: Date | null; n: number }

const FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Europe/Rome', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})
// l'ora «da orologio» di Roma di un istante
export function partiRoma(d: Date): { a: number; m: number; g: number; h: number; mi: number } {
  const p: Record<string, string> = {}
  for (const x of FMT.formatToParts(d)) p[x.type] = x.value
  return { a: +p.year, m: +p.month, g: +p.day, h: +p.hour, mi: +p.minute }
}
const chiave = (a: number, m: number, g: number) => `${a}-${String(m).padStart(2, '0')}-${String(g).padStart(2, '0')}`
// aritmetica sui giorni di calendario, senza fusi: il giorno UTC fa da contatore
const spostaGiorni = (a: number, m: number, g: number, n: number) => { const d = new Date(Date.UTC(a, m - 1, g + n)); return { a: d.getUTCFullYear(), m: d.getUTCMonth() + 1, g: d.getUTCDate() } }
const giorniNelMese = (a: number, m: number) => new Date(Date.UTC(a, m, 0)).getUTCDate()
const giornoSettimana = (a: number, m: number, g: number) => (new Date(Date.UTC(a, m - 1, g)).getUTCDay() + 6) % 7

export function ricorrenzaValida(r: any, inizio: Date): { ok: true; r: Ricorrenza } | { ok: false; errore: string } {
  if (!r) return { ok: false, errore: 'Ricorrenza mancante' }
  const freq = String(r.freq || '') as Frequenza
  if (!['giorno', 'settimana', 'mese', 'anno'].includes(freq)) return { ok: false, errore: 'Ricorrenza non valida' }
  const ogni = Number(r.ogni ?? 1)
  if (!Number.isInteger(ogni) || ogni < 1 || ogni > 99) return { ok: false, errore: 'Ogni quanto: da 1 a 99' }
  let giorni: number[] | null = null
  if (freq === 'settimana') {
    const p = partiRoma(inizio)
    const lista: any[] = Array.isArray(r.giorni) && r.giorni.length ? r.giorni : [giornoSettimana(p.a, p.m, p.g)]
    const scelti = [...new Set<number>(lista.map(Number))].filter((x) => Number.isInteger(x) && x >= 0 && x <= 6).sort()
    if (!scelti.length) return { ok: false, errore: 'Scegli almeno un giorno della settimana' }
    giorni = scelti
  }
  const fino = r.fino ? String(r.fino).slice(0, 10) : null
  if (fino && !/^\d{4}-\d{2}-\d{2}$/.test(fino)) return { ok: false, errore: 'Data di fine non valida' }
  const pi = partiRoma(inizio)
  if (fino && fino < chiave(pi.a, pi.m, pi.g)) return { ok: false, errore: 'La ripetizione finisce prima di cominciare' }
  const volte = r.volte == null || r.volte === '' ? null : Number(r.volte)
  if (volte != null && (!Number.isInteger(volte) || volte < 1 || volte > 999)) return { ok: false, errore: 'Numero di volte: da 1 a 999' }
  return { ok: true, r: { freq, ogni, giorni, fino: fino || null, volte: fino ? null : volte } }
}

// Le occorrenze che toccano [dal, al). `tuttoIlGiorno`: inizio e fine sono mezzanotti di Roma, e la durata si conta
// in giorni (con le ore, al cambio dell'ora la fine scivolerebbe al giorno prima).
export function occorrenze(
  e: { inizio: string | Date; fine?: string | Date | null; tutto_il_giorno?: boolean; ricorrenza?: Ricorrenza | null; eccezioni?: string[] | null },
  dal: Date, al: Date, massimo = 1000,
): Occorrenza[] {
  const inizio = new Date(e.inizio)
  const fine = e.fine ? new Date(e.fine) : null
  const r = e.ricorrenza
  const p = partiRoma(inizio)
  const tutto = !!e.tutto_il_giorno
  // durata: in giorni per «tutto il giorno», in millisecondi per le voci con l'ora
  const pf = fine ? partiRoma(fine) : null
  const giorniDurata = tutto && pf ? Math.round((Date.UTC(pf.a, pf.m - 1, pf.g) - Date.UTC(p.a, p.m - 1, p.g)) / 86400000) : 0
  const msDurata = !tutto && fine ? fine.getTime() - inizio.getTime() : 0
  const costruisci = (a: number, m: number, g: number, n: number): Occorrenza => {
    const ini = istanteDaOraRoma(a, m, g, tutto ? 0 : p.h, tutto ? 0 : p.mi)
    let fin: Date | null = null
    if (fine) {
      if (tutto) { const f = spostaGiorni(a, m, g, giorniDurata); fin = istanteDaOraRoma(f.a, f.m, f.g) }
      else fin = new Date(ini.getTime() + msDurata)
    }
    return { giorno: chiave(a, m, g), inizio: ini, fine: fin, n }
  }
  const tocca = (o: Occorrenza) => o.inizio.getTime() < al.getTime() && (o.fine || o.inizio).getTime() >= dal.getTime()

  if (!r) { const o = costruisci(p.a, p.m, p.g, 1); return tocca(o) ? [o] : [] }

  const salta = new Set(e.eccezioni || [])
  const finoChiave = r.fino || null
  // l'ultimo giorno che può ancora toccare il periodo: la fine del periodo (e per le voci lunghe, la loro durata prima)
  const pal = partiRoma(al)
  const limite = chiave(pal.a, pal.m, pal.g)
  const out: Occorrenza[] = []
  let n = 0
  const prova = (a: number, m: number, g: number): boolean => {
    const k = chiave(a, m, g)
    if (finoChiave && k > finoChiave) return false
    if (k > limite) return false
    n++
    if (r.volte && n > r.volte) return false
    if (!salta.has(k)) { const o = costruisci(a, m, g, n); if (tocca(o)) out.push(o) }
    return out.length < massimo
  }
  let giri = 0
  const MAX_GIRI = 20000   // guardia: ogni giorno per 50 anni
  if (r.freq === 'giorno') {
    for (let k = 0; giri++ < MAX_GIRI; k += r.ogni) { const d = spostaGiorni(p.a, p.m, p.g, k); if (!prova(d.a, d.m, d.g)) break }
  } else if (r.freq === 'settimana') {
    const giorni = (r.giorni && r.giorni.length ? r.giorni : [giornoSettimana(p.a, p.m, p.g)]).slice().sort()
    const lun = spostaGiorni(p.a, p.m, p.g, -giornoSettimana(p.a, p.m, p.g))
    const inizioK = chiave(p.a, p.m, p.g)
    fuori: for (let w = 0; giri++ < MAX_GIRI; w += r.ogni) {
      for (const gs of giorni) {
        const d = spostaGiorni(lun.a, lun.m, lun.g, w * 7 + gs)
        if (chiave(d.a, d.m, d.g) < inizioK) continue
        if (!prova(d.a, d.m, d.g)) break fuori
      }
    }
  } else if (r.freq === 'mese') {
    for (let k = 0; giri++ < MAX_GIRI; k += r.ogni) {
      const tot = (p.m - 1) + k, a = p.a + Math.floor(tot / 12), m = (tot % 12) + 1
      if (chiave(a, m, 1) > limite || (finoChiave && chiave(a, m, 1) > finoChiave)) break
      if (p.g > giorniNelMese(a, m)) continue
      if (!prova(a, m, p.g)) break
    }
  } else {
    for (let k = 0; giri++ < MAX_GIRI; k += r.ogni) {
      const a = p.a + k
      if (chiave(a, 1, 1) > limite || (finoChiave && chiave(a, 1, 1) > finoChiave)) break
      if (p.m === 2 && p.g === 29 && giorniNelMese(a, 2) < 29) continue
      if (!prova(a, p.m, p.g)) break
    }
  }
  return out
}

// «Ogni settimana il lunedì e il giovedì, fino al 31 dicembre»: la frase per le schede e le email
const NOMI_GIORNI = ['lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato', 'domenica']
const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
export function descriviRicorrenza(r: Ricorrenza | null | undefined, inizio: string | Date): string {
  if (!r) return ''
  const p = partiRoma(new Date(inizio))
  const elenco = (v: string[]) => v.length < 2 ? v.join('') : v.slice(0, -1).join(', ') + ' e ' + v[v.length - 1]
  let s = ''
  if (r.freq === 'giorno') s = r.ogni === 1 ? 'Ogni giorno' : `Ogni ${r.ogni} giorni`
  else if (r.freq === 'settimana') {
    const g = r.giorni || []
    const feriali = g.length === 5 && [0, 1, 2, 3, 4].every((x) => g.includes(x))
    s = feriali && r.ogni === 1 ? 'Dal lunedì al venerdì'
      : `${r.ogni === 1 ? 'Ogni settimana' : `Ogni ${r.ogni} settimane`} ${elenco(g.map((x) => (x === 6 ? 'la ' : 'il ') + NOMI_GIORNI[x]))}`
  } else if (r.freq === 'mese') s = `${r.ogni === 1 ? 'Ogni mese' : `Ogni ${r.ogni} mesi`} il giorno ${p.g}`
  else s = `${r.ogni === 1 ? 'Ogni anno' : `Ogni ${r.ogni} anni`} il ${p.g} ${MESI[p.m - 1]}`
  if (r.fino) { const [a, m, g] = r.fino.split('-').map(Number); s += `, fino al ${g} ${MESI[m - 1]} ${a}` }
  else if (r.volte) s += `, ${r.volte} ${r.volte === 1 ? 'volta' : 'volte'}`
  return s
}
