'use client'
// DOVE STANNO LE TUE VOCI: la tabella calendario_eventi, letta e scritta da /api/calendario/eventi (la rotta controlla
// che ognuno tocchi solo le sue righe). Chi scrive una voce avvisa il calendario aperto, così si ridisegna da sé
// (anche quando la voce nasce dalla finestra «Ricordamelo» del dettaglio spedizione).
import type { EventoMio } from './tipi'

export const CAMBIATO = 'mx-calendario-cambiato'
function avvisa() { try { window.dispatchEvent(new Event(CAMBIATO)) } catch { } }

async function chiedi(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init)
  const d = await r.json().catch(() => null)
  if (!r.ok) throw new Error(d?.error || 'Operazione non riuscita')
  return d
}

export async function leggiMiei(dal: Date, al: Date): Promise<EventoMio[]> {
  const d = await chiedi(`/api/calendario/eventi?dal=${encodeURIComponent(dal.toISOString())}&al=${encodeURIComponent(al.toISOString())}`)
  return (d?.eventi || []) as EventoMio[]
}

// i promemoria ancora da fare fino a oggi compreso (la lista «Da fare»): anche quelli vecchi, finché non li segni
export async function leggiDaFare(): Promise<EventoMio[]> {
  const d = await chiedi('/api/calendario/eventi?dafare=1')
  return (d?.eventi || []) as EventoMio[]
}

export type NuovoEvento = Omit<EventoMio, 'id' | 'creato_il' | 'fatto'> & { fatto?: boolean }

export async function salvaMio(e: NuovoEvento & { id?: string }): Promise<EventoMio> {
  const d = await chiedi('/api/calendario/eventi' + (e.id ? `?id=${encodeURIComponent(e.id)}` : ''), {
    method: e.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(e),
  })
  avvisa()
  return d.evento as EventoMio
}

export async function segnaFatto(e: EventoMio, fatto: boolean): Promise<void> {
  await salvaMio({ ...e, fatto })
}

export async function eliminaMio(id: string): Promise<void> {
  await chiedi(`/api/calendario/eventi?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  avvisa()
}
