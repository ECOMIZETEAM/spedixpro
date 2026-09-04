'use client'
import { useEffect } from 'react'

// Le due dashboard tengono un'ISTANTANEA dell'ultima schermata in sessionStorage, sotto una
// chiave fissa, per mostrare subito qualcosa mentre i dati si ricaricano. La chiave non e' legata
// all'utente: su una postazione condivisa (magazzino, ufficio) chi entrava dopo vedeva per un
// istante credito, fatturato e ultime spedizioni di chi era entrato prima.
// Qui siamo su una pagina di ACCESSO: chiunque stia per entrare non deve trovare niente di
// quello di prima.
export default function PuliziaSessione() {
  useEffect(() => {
    try {
      sessionStorage.removeItem('dash_master_v1')
      sessionStorage.removeItem('dash_cliente_v1')
    } catch {}
    // Filtri di lista ricordati (useFiltriPersistenti, chiavi 'flt:...'): su una postazione condivisa
    // chi entra dopo non deve ereditare i filtri di chi c'era prima. Si azzerano all'ACCESSO.
    try {
      const daTogliere: string[] = []
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k && k.startsWith('flt:')) daTogliere.push(k) }
      daTogliere.forEach(k => localStorage.removeItem(k))
    } catch {}
  }, [])
  return null
}
