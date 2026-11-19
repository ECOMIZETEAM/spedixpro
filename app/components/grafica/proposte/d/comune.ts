'use client'
// Gli attrezzi della Proposta D «Bento» (27/10): il periodo dei soldi, la lettura delle rotte, i nomi degli stati e
// del vettore. Tutto in sola lettura: la Plancia legge e basta.
import { useEffect, useState } from 'react'
import { MESI, iso } from '../../PlanciaNuova'
import { vettoreFisico } from '@/lib/vettore'

// ── il periodo UNICO delle tessere dei soldi ──
// Si calcola dopo l'apertura: «oggi» del server (UTC su Vercel) e quello del browser possono essere giorni diversi
export type NomePeriodo = 'oggi' | 'settimana' | 'mese' | 'scorso'
export type Periodo = { nome: NomePeriodo; da: Date; a: Date; titolo: string }
export const PERIODI: [NomePeriodo, string][] = [['oggi', 'Oggi'], ['settimana', 'Questa settimana'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso']]
export function periodo(nome: NomePeriodo): Periodo {
  const oggi = new Date()
  const lun = new Date(oggi); lun.setDate(oggi.getDate() - ((oggi.getDay() + 6) % 7))
  if (nome === 'oggi') return { nome, da: oggi, a: oggi, titolo: 'oggi' }
  if (nome === 'settimana') return { nome, da: lun, a: oggi, titolo: 'questa settimana' }
  if (nome === 'scorso') { const d = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); return { nome, da: d, a: new Date(oggi.getFullYear(), oggi.getMonth(), 0), titolo: MESI[d.getMonth()] } }
  return { nome: 'mese', da: new Date(oggi.getFullYear(), oggi.getMonth(), 1), a: oggi, titolo: MESI[oggi.getMonth()] + ', fino a oggi' }
}
export const dalAl = (p: Periodo | null) => p ? `?dal=${iso(p.da)}&al=${iso(p.a)}` : null

// ── la lettura di una rotta ──
// Come usaJson, ma distingue «sto leggendo» da «la rotta non lo dà» (permesso, errore): la tessera deve poterlo dire.
// Al cambio di indirizzo (il periodo) tiene il dato di prima finché arriva il nuovo, così i numeri scorrono dal
// vecchio al nuovo invece di sparire.
// I fogli leggono le loro rotte solo quando servono: la lettura parte già quando il mouse arriva sulla tessera
// (precarica), così il foglio si apre col dato pronto invece di allungarsi un attimo dopo. Una copia vale un minuto.
const copie = new Map<string, { t: number; p: Promise<any> ; d?: any }>()
function leggi(url: string) {
  const c = copie.get(url)
  if (c && Date.now() - c.t < 60000) return c.p
  const p = fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(x => { const v = x && !x.error ? x : null; const k = copie.get(url); if (k) k.d = v; return v })
  copie.set(url, { t: Date.now(), p })
  p.catch(() => copie.delete(url))
  return p
}
export function precarica(...url: string[]) { for (const u of url) leggi(u).catch(() => {}) }
export type Lettura<T> = { d: T | null; stato: 'attesa' | 'ok' | 'manca' }
export function useLettura<T = any>(url: string | null, copia = false): Lettura<T> {
  // copia: il dato già precaricato si usa subito (solo nei fogli, che non si disegnano sul server)
  const [l, setL] = useState<Lettura<T>>(() => {
    const c = copia && url ? copie.get(url) : undefined
    return c && c.d !== undefined && Date.now() - c.t < 60000 ? { d: c.d, stato: c.d ? 'ok' : 'manca' } : { d: null, stato: 'attesa' }
  })
  useEffect(() => {
    if (!url) return
    let vivo = true
    const p = copia ? leggi(url) : fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(x => x && !x.error ? x : null)
    p.then(x => { if (vivo) setL(x ? { d: x, stato: 'ok' } : { d: null, stato: 'manca' }) })
      .catch(() => { if (vivo) setL(q => ({ d: q.d, stato: q.d ? 'ok' : 'manca' })) })
    return () => { vivo = false }
  }, [url, copia])
  return l
}
// le rotte dei fogli: le stesse che i fogli leggono, per precaricarle
export const URL_GIACENZE = '/api/spedizioni/lista?page=1&perPage=5&stato=in_giacenza'
export const urlContrattiOggi = () => { const o = iso(new Date()); return `/api/distinte/contratti?dal=${o}&al=${o}` }

// ── gli stati delle spedizioni: nome, e il puntino (verde e rosso solo qui, come puntini di stato) ──
export const STATI: Record<string, { nome: string; tipo: '' | 'bene' | 'problema' | 'fermo' }> = {
  in_lavorazione: { nome: 'In lavorazione', tipo: '' }, spedita: { nome: 'Spedita', tipo: '' }, in_transito: { nome: 'In transito', tipo: '' },
  in_consegna: { nome: 'In consegna', tipo: '' }, consegnata: { nome: 'Consegnata', tipo: 'bene' }, in_giacenza: { nome: 'In giacenza', tipo: 'problema' },
  non_consegnato: { nome: 'Non consegnata', tipo: 'problema' }, reso_mittente: { nome: 'Reso al mittente', tipo: 'problema' },
  annullata: { nome: 'Annullata', tipo: 'fermo' }, storno_richiesto: { nome: 'Storno richiesto', tipo: 'fermo' }, annullamento_pending: { nome: 'In annullamento', tipo: 'fermo' },
}
// i quattro gruppi degli ultimi 30 giorni
export function gruppiStati(s: Record<string, number> | undefined) {
  const x = s || {}, somma = (k: string[]) => k.reduce((a, c) => a + Number(x[c] || 0), 0)
  const g = [
    { k: 'corso', nome: 'In corso', n: somma(['in_lavorazione', 'spedita', 'in_transito', 'in_consegna']) },
    { k: 'bene', nome: 'Consegnate', n: somma(['consegnata']) },
    { k: 'problema', nome: 'Problemi', n: somma(['in_giacenza', 'non_consegnato', 'reso_mittente']) },
    { k: 'fermo', nome: 'Annullate', n: somma(['annullata', 'storno_richiesto', 'annullamento_pending']) },
  ]
  return { g, tot: g.reduce((a, c) => a + c.n, 0) }
}

// ── il vettore di un contratto, mai il fornitore tecnico ──
// vettoreFisico, quando non riconosce il corriere, ripiega sulla prima parola del nome: se quella fosse il nome di un
// fornitore tecnico, qui diventa «Altro corriere». Il tipo del contratto non si mostra mai.
const TECNICI = /spediamo|spedisci|easy\s*parcel|\bdva\b/i
export function vettoreSicuro(c: { tipo?: string | null; nome_contratto?: string | null }) {
  if ((c?.tipo || '').toLowerCase() === 'interno') return 'Mezzi propri'
  const v = vettoreFisico(c)
  return TECNICI.test(v) ? 'Altro corriere' : v
}

// statsMensili porta il mese all'inglese («Jul 26», dalla funzione del database)
const INGLESE: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
export function meseItaliano(m: any) {
  const s = String(m || '').trim(), i = INGLESE[s.slice(0, 3).toLowerCase()]
  return i === undefined ? s.toLowerCase() : MESI[i]
}

export const pct = (v: number) => (Math.round(v * 10) / 10).toLocaleString('it-IT')
export const maiuscola = (s: string) => s ? s[0].toUpperCase() + s.slice(1) : s
