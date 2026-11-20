'use client'
/* SUGGERIMENTI MENTRE SI SCRIVE: rubrica mittenti e destinatari della nuova spedizione (master e
 * cliente).
 *
 * Prima partiva una ricerca a OGNI tasto dal secondo carattere, senza annullare la precedente. Il
 * 19/10/2026 (06-18 UTC) sono state 41.274 chiamate a /api/destinatari/cerca e 16.445 a
 * /api/mittenti/cerca; per un master grande senza cliente scelto ognuna arrivava a 5-6 secondi, e
 * scrivere un nome di dieci lettere ne metteva in fila nove. In piu' le risposte potevano arrivare
 * fuori ordine: quella di "ma" dopo quella di "mario" (la tendina mostrava i nomi del testo vecchio),
 * o dopo aver cancellato il testo (riapriva una tendina appena chiusa).
 *
 * Qui: si aspetta una pausa nella scrittura; la richiesta superata si annulla; conta solo la
 * risposta dell'ULTIMA richiesta; e non si richiede il testo che e' gia' a schermo. Per un dato testo
 * si chiede lo stesso indirizzo di prima e si mostra la stessa risposta: cambia solo quante volte si
 * chiede. Il nucleo non dipende da React, cosi' si prova da solo (digitazione rapida, risposte
 * fuori ordine) senza montare la pagina. */
import { useEffect, useState } from 'react'

// Pausa nella scrittura dopo cui si cerca: sotto, chi scrive di seguito non fa partire niente.
export const ATTESA_SUGGERIMENTI_MS = 250
// Per quanto la lista a schermo vale come risposta per lo stesso testo. Oltre, si richiede: la
// rubrica cambia (una spedizione appena creata salva il suo destinatario).
const VALIDITA_MOSTRATI_MS = 30_000

export type AzioniSuggerimenti = {
  mostra: (lista: unknown[]) => void   // risposta arrivata: lista + tendina aperta
  errore: () => void               // rete o risposta illeggibile: lista vuota (com'era prima)
  svuota: () => void               // testo troppo corto: lista vuota e tendina chiusa
}

export type RicercaSuggerimenti = {
  cerca: (url: string) => void     // il testo e' cambiato e va cercato
  svuota: () => void               // il testo e' troppo corto per cercare
  dimentica: () => void            // il modulo e' stato azzerato: niente a schermo vale piu'
  ferma: () => void                // la pagina si chiude
}

type Scarica = (url: string, segnale: AbortSignal) => Promise<unknown>
const scaricaJson: Scarica = (url, segnale) => fetch(url, { signal: segnale }).then(r => r.json())

export function creaRicercaSuggerimenti(
  azioni: AzioniSuggerimenti,
  opzioni: { attesaMs?: number; scarica?: Scarica; adesso?: () => number } = {},
): RicercaSuggerimenti {
  const attesaMs = opzioni.attesaMs ?? ATTESA_SUGGERIMENTI_MS
  const scarica = opzioni.scarica ?? scaricaJson
  const adesso = opzioni.adesso ?? Date.now
  let timer: ReturnType<typeof setTimeout> | null = null
  let controllo: AbortController | null = null
  let inCorso: string | null = null   // indirizzo in attesa della pausa o in viaggio
  let giro = 0                        // cresce a ogni richiesta superata: le sue risposte si scartano
  let mostrato: { url: string; lista: unknown[]; alle: number } | null = null

  function annulla() {
    if (timer) { clearTimeout(timer); timer = null }
    if (controllo) { controllo.abort(); controllo = null }
    inCorso = null
    giro++
  }

  function invia(url: string) {
    timer = null
    const mio = ++giro
    const c = new AbortController()
    controllo = c
    scarica(url, c.signal).then(
      j => {
        if (mio !== giro) return                       // superata da un testo piu' recente
        controllo = null; inCorso = null
        const lista = Array.isArray(j) ? j : []
        mostrato = { url, lista, alle: adesso() }
        azioni.mostra(lista)
      },
      () => {
        if (mio !== giro) return                       // annullata apposta: non e' un errore
        controllo = null; inCorso = null; mostrato = null
        azioni.errore()
      },
    )
  }

  return {
    cerca(url) {
      if (url === inCorso) return                      // gia' in attesa o in viaggio, uguale
      annulla()
      // Lo stesso testo di cio' che e' a schermo (scritto e cancellato prima della pausa): la
      // risposta c'e' gia', si rimette com'era invece di richiederla.
      if (mostrato && mostrato.url === url && adesso() - mostrato.alle < VALIDITA_MOSTRATI_MS) {
        azioni.mostra(mostrato.lista)
        return
      }
      inCorso = url
      timer = setTimeout(() => invia(url), attesaMs)
    },
    svuota() { annulla(); mostrato = null; azioni.svuota() },
    dimentica() { annulla(); mostrato = null },
    ferma() { annulla() },
  }
}

// Le azioni si leggono UNA volta, al primo disegno: devono usare solo i setter di useState, che non
// cambiano mai. Una funzione che legge altro stato della pagina lo vedrebbe fermo al primo disegno.
export function useRicercaSuggerimenti(azioni: AzioniSuggerimenti): RicercaSuggerimenti {
  const [ricerca] = useState(() => creaRicercaSuggerimenti(azioni))
  useEffect(() => () => ricerca.ferma(), [ricerca])
  return ricerca
}
