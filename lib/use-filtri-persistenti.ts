'use client'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'

// STATO PERSISTENTE (filtri di lista). Si comporta come useState ma RICORDA il valore in localStorage,
// così i filtri che master/clienti impostano NON si azzerano cambiando pagina o dopo un'azione: restano
// finché non premono "Azzera" (che rimette i default) o fanno logout.
//
// Caricamento nell'effect (non nell'inizializzatore) di proposito: al primo render server e client usano
// entrambi `iniziale` → niente mismatch di hydration; subito dopo il mount si rilegge da localStorage.
// La scrittura parte solo DOPO il primo caricamento, così il default non sovrascrive un valore salvato.
//
// La chiave va resa UNICA per pagina (es. 'spedizioni-master:filtri'); il prefisso 'flt:' permette a
// PuliziaSessione di azzerarle tutte al logout (una macchina condivisa non deve mostrare i filtri altrui).
export function useFiltriPersistenti<T>(chiave: string, iniziale: T): [T, Dispatch<SetStateAction<T>>, () => void] {
  const full = 'flt:' + chiave
  const [v, setV] = useState<T>(iniziale)
  const caricato = useRef(false)

  useEffect(() => {
    try {
      const s = window.localStorage.getItem(full)
      if (s != null) setV(JSON.parse(s) as T)
    } catch { /* localStorage non disponibile / JSON rotto: si tiene l'iniziale */ }
    caricato.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  useEffect(() => {
    if (!caricato.current) return   // non salvare l'iniziale prima di aver letto il salvato
    try { window.localStorage.setItem(full, JSON.stringify(v)) } catch { /* quota/privato: pazienza */ }
  }, [full, v])

  // azzera(): rimette l'iniziale E cancella dal localStorage (per il bottone "Azzera filtri").
  const azzera = () => {
    try { window.localStorage.removeItem(full) } catch {}
    setV(iniziale)
  }

  return [v, setV, azzera]
}
