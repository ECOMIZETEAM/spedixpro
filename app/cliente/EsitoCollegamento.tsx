'use client'
import { useEffect, useState } from 'react'
import { messaggioEsito, PARAM_ERRORE, PARAM_COLLEGATO } from '@/lib/esiti-collegamento'

// L'ESITO DI UN COLLEGAMENTO DI NEGOZIO, LETTO DALL'INDIRIZZO.
//
// Sta in due posti soli: nel layout del portale (il cliente che e' dentro) e nel modulo di accesso (chi
// non ha sessione). Il middleware si porta dietro ?error= e ?connected= nei due rimbalzi del cliente
// (senza sessione → modulo di accesso, modulo di accesso con sessione → dashboard): prima l'esito si
// perdeva proprio li', e il negoziante si ritrovava sulla dashboard o sul login senza sapere cosa fosse
// successo. Resta perso in un caso solo: se nel browser e' aperta una sessione di master o di staff,
// il middleware porta su /dashboard, dove questo componente non c'e'.
export default function EsitoCollegamento() {
  const [esito, setEsito] = useState<{ tipo: 'ok' | 'errore'; testo: string } | null>(null)

  useEffect(() => {
    const q = new URLSearchParams(window.location.search)
    const e = messaggioEsito(q)
    if (!e) return
    setEsito(e)
    // Pulisco l'indirizzo: un aggiornamento non deve rimostrare l'avviso, e il codice non deve restare
    // nella cronologia o in un link copiato. Si tolgono solo i due parametri dell'esito.
    q.delete(PARAM_ERRORE)
    q.delete(PARAM_COLLEGATO)
    const resto = q.toString()
    const pulito = window.location.pathname + (resto ? '?' + resto : '') + window.location.hash
    // Non subito: al primo caricamento questo effetto gira PRIMA di quello con cui il router di Next
    // aggancia history.replaceState (gli effetti dei figli vengono prima di quelli dei genitori). Il
    // replaceState nativo toglierebbe a questa voce lo stato di Next — «Indietro» fin qui non
    // ridisegnerebbe la pagina — e il router resterebbe convinto che l'indirizzo abbia ancora ?error=.
    // Al giro dopo passa dalla versione di Next, che aggiorna anche il suo indirizzo. Lo stato va
    // lasciato null: se riceve lo stato di Next (__NA), quella versione salta l'aggiornamento.
    const t = setTimeout(() => window.history.replaceState(null, '', pulito), 0)
    return () => clearTimeout(t)
  }, [])

  if (!esito) return null
  const ok = esito.tipo === 'ok'
  return (
    <div role={ok ? 'status' : 'alert'} style={{
      display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '16px', padding: '10px 14px',
      borderRadius: '8px', fontSize: '13px', lineHeight: 1.5,
      border: `1px solid ${ok ? '#bbf7d0' : '#fecaca'}`, background: ok ? '#f0fdf4' : '#fef2f2', color: ok ? '#15803d' : '#b91c1c',
    }}>
      <span style={{ flex: 1 }}>{esito.testo}</span>
      <button type="button" onClick={() => setEsito(null)} aria-label="Chiudi"
        style={{ background: 'none', border: 'none', color: 'inherit', fontSize: '16px', lineHeight: 1, cursor: 'pointer', padding: 0 }}>×</button>
    </div>
  )
}
