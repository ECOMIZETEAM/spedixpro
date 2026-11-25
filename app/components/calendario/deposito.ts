'use client'
// DOVE STANNO LE TUE VOCI. La casa vera è la tabella calendario_eventi, letta e scritta da /api/calendario/eventi
// (la rotta controlla che ognuno tocchi solo le sue righe). Finché la tabella non c'è (ANTEPRIMA: nessuna modifica al
// database di produzione senza l'ok di Lorenzo) la rotta risponde { anteprima: true } e le voci restano in questo
// browser. Il resto del calendario non sa la differenza.
// Da togliere al rilascio, quando la tabella c'è: il ramo «locale» qui sotto.
import type { EventoMio } from './tipi'

const CHIAVE = 'mx_calendario_anteprima_v1'
let modo: 'server' | 'locale' | null = null

// chi scrive una voce (anche la finestra «Ricordamelo» del dettaglio spedizione) avvisa il calendario aperto
export const CAMBIATO = 'mx-calendario-cambiato'
function avvisa() { try { window.dispatchEvent(new Event(CAMBIATO)) } catch { } }

function leggiLocale(): EventoMio[] {
  try { const v = JSON.parse(localStorage.getItem(CHIAVE) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function scriviLocale(v: EventoMio[]) {
  try { localStorage.setItem(CHIAVE, JSON.stringify(v)) } catch { throw new Error('Il browser non lascia salvare (navigazione privata?)') }
}
const dentro = (e: EventoMio, dal: Date, al: Date) => {
  const a = new Date(e.inizio).getTime(), b = new Date(e.fine || e.inizio).getTime()
  return a < al.getTime() && b >= dal.getTime()
}

export function inAnteprima() { return modo === 'locale' }

export async function leggiMiei(dal: Date, al: Date): Promise<EventoMio[]> {
  if (modo !== 'locale') {
    const r = await fetch(`/api/calendario/eventi?dal=${encodeURIComponent(dal.toISOString())}&al=${encodeURIComponent(al.toISOString())}`)
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.error || 'Non riesco a leggere le tue voci')
    if (d?.anteprima) modo = 'locale'
    else { modo = 'server'; return (d?.eventi || []) as EventoMio[] }
  }
  return leggiLocale().filter(e => dentro(e, dal, al))
}

// i promemoria ancora da fare fino a oggi compreso (la lista «Da fare»): anche quelli vecchi, finché non li segni
export async function leggiDaFare(): Promise<EventoMio[]> {
  if (modo === null) await leggiMiei(new Date(), new Date())
  if (modo === 'server') {
    const r = await fetch('/api/calendario/eventi?dafare=1')
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.error || 'Non riesco a leggere i promemoria')
    return (d?.eventi || []) as EventoMio[]
  }
  const fine = new Date(); fine.setHours(23, 59, 59, 999)
  return leggiLocale().filter(e => e.tipo === 'promemoria' && !e.fatto && new Date(e.inizio) <= fine)
}

export type NuovoEvento = Omit<EventoMio, 'id' | 'creato_il' | 'fatto'> & { fatto?: boolean }

export async function salvaMio(e: NuovoEvento & { id?: string }): Promise<EventoMio> {
  if (modo === null) await leggiMiei(new Date(), new Date())
  if (modo === 'server') {
    const r = await fetch('/api/calendario/eventi' + (e.id ? `?id=${encodeURIComponent(e.id)}` : ''), {
      method: e.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e),
    })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.error || 'Salvataggio non riuscito')
    avvisa()
    return d.evento as EventoMio
  }
  const tutti = leggiLocale()
  let fatto: EventoMio
  if (e.id) {
    const i = tutti.findIndex(x => x.id === e.id)
    if (i < 0) throw new Error('Voce non trovata')
    fatto = { ...tutti[i], ...e, id: e.id, fatto: e.fatto ?? tutti[i].fatto }
    tutti[i] = fatto
  } else {
    fatto = { ...e, id: 'loc-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7), creato_il: new Date().toISOString(), fatto: !!e.fatto }
    tutti.push(fatto)
  }
  scriviLocale(tutti)
  avvisa()
  return fatto
}

export async function segnaFatto(e: EventoMio, fatto: boolean): Promise<void> {
  await salvaMio({ ...e, fatto })
}

export async function eliminaMio(id: string): Promise<void> {
  if (modo === 'server') {
    const r = await fetch(`/api/calendario/eventi?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    const d = await r.json().catch(() => null)
    if (!r.ok) throw new Error(d?.error || 'Eliminazione non riuscita')
  } else {
    scriviLocale(leggiLocale().filter(x => x.id !== id))
  }
  avvisa()
}
