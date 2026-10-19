import comuniIT from '@/lib/data/comuni.json'
import frazioniIT from '@/lib/data/frazioni.json'

// LA PROVINCIA NON LA SI CHIEDE A CHI IMPORTA: SI RICAVA DAL CAP.
// Amazon nell'ordine non la scrive proprio ("Lovere, 24065", "Bologna, 40139"), e finche' era fra
// i campi obbligatori quegli ordini venivano SCARTATI — con un messaggio che diceva "dati
// destinatario incompleti" senza dire quale dato. Due ordini veri persi cosi'.
// L'elenco dei comuni ce l'abbiamo gia' in casa (lib/data/comuni.json, 7.904 comuni, piu' 9.878
// frazioni): dal CAP alla sigla e' una lettura, non un indovinello. 24065 -> BG, 40139 -> BO.
// Se un CAP appartenesse a piu' province non si tira a indovinare: si lascia vuota e la riga entra
// lo stesso, correggibile a mano dalla lista. Meglio un ordine da completare che un ordine perso.
//
// Sta qui e non nella rotta dell'import da file perche' serve anche agli ordini Amazon che arrivano
// dal collegamento diretto (lib/amazonSync): stesso problema, stessa risposta.
export const CAP_PROVINCIA: Map<string, string> = (() => {
  const m = new Map<string, string>()
  const ambigui = new Set<string>()
  const aggiungi = (cap: string, sigla: string) => {
    const c = String(cap || '').trim()
    const s = String(sigla || '').toUpperCase().trim()
    if (!/^\d{5}$/.test(c) || s.length !== 2) return
    const gia = m.get(c)
    if (gia && gia !== s) { ambigui.add(c); m.delete(c); return }
    if (!ambigui.has(c)) m.set(c, s)
  }
  for (const c of (comuniIT as any[])) for (const cap of (c.cap || [])) aggiungi(cap, c.sigla)
  for (const f of (frazioniIT as any[])) aggiungi(f.cap, f.sigla)
  return m
})()
