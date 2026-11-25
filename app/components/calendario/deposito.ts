'use client'
// DOVE STANNO LE TUE VOCI: le tabelle del calendario, lette e scritte dalle rotte /api/calendario/* (che controllano che
// ognuno tocchi solo le sue righe). Chi scrive una voce avvisa il calendario aperto, così si ridisegna da sé (anche
// quando la voce nasce dalla finestra «Ricordamelo» del dettaglio spedizione).
import type { EventoMio, Ricorrenza, StatoInvito } from './tipi'

export const CAMBIATO = 'mx-calendario-cambiato'
function avvisa() { try { window.dispatchEvent(new Event(CAMBIATO)) } catch { } }

async function chiedi(url: string, init?: RequestInit): Promise<any> {
  const r = await fetch(url, init)
  const d = await r.json().catch(() => null)
  if (!r.ok) throw new Error(d?.error || 'Operazione non riuscita')
  return d
}
const json = (method: string, body: any): RequestInit => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

export async function leggiMiei(dal: Date, al: Date): Promise<EventoMio[]> {
  const d = await chiedi(`/api/calendario/eventi?dal=${encodeURIComponent(dal.toISOString())}&al=${encodeURIComponent(al.toISOString())}`)
  return (d?.eventi || []) as EventoMio[]
}

// i promemoria ancora da fare fino a oggi compreso (la lista «Da fare»): anche quelli vecchi, finché non li segni
export async function leggiDaFare(): Promise<EventoMio[]> {
  const d = await chiedi('/api/calendario/eventi?dafare=1')
  return (d?.eventi || []) as EventoMio[]
}

export type NuovoEvento = {
  id?: string
  tipo: EventoMio['tipo']; titolo: string; inizio: string; fine: string | null; tutto_il_giorno: boolean
  luogo: string | null; note: string | null; avviso_minuti: number | null; collegamento: EventoMio['collegamento']
  fatto?: boolean
  ricorrenza?: Ricorrenza | null
  invitati?: string[]          // solo quando si cambiano: gli identificativi delle persone invitate
}

// il corpo si costruisce campo per campo: una voce letta dal calendario porta anche le schede degli invitati e i dati
// dell'occorrenza, che rimandati indietro cambierebbero la serie o toglierebbero gli inviti
export async function salvaMio(e: NuovoEvento): Promise<EventoMio> {
  const corpo: any = {
    tipo: e.tipo, titolo: e.titolo, inizio: e.inizio, fine: e.fine, tutto_il_giorno: e.tutto_il_giorno,
    luogo: e.luogo, note: e.note, avviso_minuti: e.avviso_minuti, collegamento: e.collegamento,
    fatto: !!e.fatto, ricorrenza: e.ricorrenza ?? null,
  }
  if (e.invitati) corpo.invitati = e.invitati
  const d = await chiedi('/api/calendario/eventi' + (e.id ? `?id=${encodeURIComponent(e.id)}` : ''), json(e.id ? 'PATCH' : 'POST', corpo))
  avvisa()
  return d.evento as EventoMio
}

// «fatto»: una voce singola si riscrive; di una serie si segna solo quel giorno
export async function segnaFatto(e: EventoMio, fatto: boolean): Promise<void> {
  if (e.ricorrenza && e.occorrenza) return azioneOccorrenza(e.id, e.occorrenza, fatto ? 'fatto' : 'da_fare')
  await salvaMio({
    id: e.id, tipo: e.tipo, titolo: e.titolo, inizio: e.serie_inizio || e.inizio, fine: e.serie_fine !== undefined ? e.serie_fine : e.fine,
    tutto_il_giorno: e.tutto_il_giorno, luogo: e.luogo, note: e.note, avviso_minuti: e.avviso_minuti, collegamento: e.collegamento,
    fatto, ricorrenza: e.ricorrenza ?? null,
  })
}

export async function azioneOccorrenza(id: string, giorno: string, azione: 'salta' | 'fatto' | 'da_fare'): Promise<void> {
  await chiedi('/api/calendario/eventi/occorrenza', json('POST', { id, giorno, azione }))
  avvisa()
}

export async function eliminaMio(id: string): Promise<void> {
  await chiedi(`/api/calendario/eventi?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
  avvisa()
}

export async function rispondiInvito(eventoId: string, risposta: Exclude<StatoInvito, 'in_attesa'>): Promise<void> {
  await chiedi('/api/calendario/inviti', json('POST', { evento_id: eventoId, risposta }))
  avvisa()
}

export type Persona = { id: string; nome: string; ruolo: string; azienda: string | null }
export async function cercaPersone(q: string): Promise<Persona[]> {
  const d = await chiedi('/api/calendario/persone?q=' + encodeURIComponent(q))
  return (d?.persone || []) as Persona[]
}

export type StatoFeed = { attivo: boolean; creato_il: string | null; ultimo_uso: string | null }
export const leggiFeed = (): Promise<StatoFeed> => chiedi('/api/calendario/feed')
export const creaFeed = (): Promise<{ url: string; webcal: string }> => chiedi('/api/calendario/feed', { method: 'POST' })
export const spegniFeed = (): Promise<{ ok: boolean }> => chiedi('/api/calendario/feed', { method: 'DELETE' })
