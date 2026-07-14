// Confinamento del ruolo AGENTE (staff commerciale senza portale proprio).
// Regole:
//  - vede SOLO i clienti a lui assegnati (clienti.agente = "Nome Cognome") e i loro dati;
//  - SOLA LETTURA + download: nessuna creazione/modifica/eliminazione/impersonazione;
//  - niente dati del master (guadagni/margini master, movimenti/credito) né rete.
// L'aggancio agente↔cliente oggi è per nome+cognome (stringa), non per id.
import { NextResponse } from 'next/server'

export const NESSUN_CLIENTE = '00000000-0000-0000-0000-000000000000'

export type Utente = {
  id?: string
  master_id?: string | null
  ruolo?: string | null
  cliente_id?: string | null
  nome?: string | null
  cognome?: string | null
} | null | undefined

export function isAgente(utente: Utente): boolean {
  return (utente?.ruolo || '').toLowerCase() === 'agente'
}

// Nome completo dell'agente, come salvato in clienti.agente.
export function nomeAgente(utente: Utente): string {
  return (((utente?.nome) || '') + ' ' + ((utente?.cognome) || '')).trim()
}

// Ritorna gli id dei clienti assegnati all'agente (stesso master, match per nome+cognome).
// Array vuoto se non ha clienti (→ nessun risultato nelle liste).
export async function clientiAgente(supabase: any, utente: Utente): Promise<string[]> {
  const nome = nomeAgente(utente)
  if (!utente?.master_id || !nome) return []
  const { data } = await supabase.from('clienti').select('id').eq('master_id', utente.master_id).eq('agente', nome)
  return (data || []).map((c: any) => c.id)
}

// Lista da usare in .in('cliente_id', ...): mai vuota (usa un UUID fittizio) per non far
// collassare il filtro in "nessun filtro".
export function idClientiPerFiltro(ids: string[]): string[] {
  return ids.length ? ids : [NESSUN_CLIENTE]
}

// 403 standard per le scritture / aree vietate all'agente. Ritorna la Response da restituire
// direttamente, oppure null se l'utente NON è agente (si prosegue).
export function bloccaAgente(utente: Utente, messaggio = 'Operazione non consentita: gli agenti hanno accesso in sola lettura.'): NextResponse | null {
  if (isAgente(utente)) return NextResponse.json({ error: messaggio }, { status: 403 })
  return null
}

// 403 per le aree del master vietate all'agente (report guadagno/margini, movimenti/credito, rete).
export function vietatoAlMaster(utente: Utente, messaggio = 'Sezione non disponibile per gli agenti.'): NextResponse | null {
  if (isAgente(utente)) return NextResponse.json({ error: messaggio }, { status: 403 })
  return null
}
