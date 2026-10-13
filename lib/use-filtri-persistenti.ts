'use client'
import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { giornoRoma } from '@/lib/date-roma'

// STATO PERSISTENTE (filtri di lista). Si comporta come useState ma RICORDA il valore in localStorage,
// così i filtri che master/clienti impostano NON si azzerano cambiando pagina o dopo un'azione: restano
// finché non premono "Azzera" (che rimette i default) o fanno logout.
//
// MA SOLO PER LA GIORNATA (decisione di Lorenzo, 13/10/2026). Prima il valore restava per sempre, e con
// lui le date: il periodo predefinito (ultimi 30 giorni fino a OGGI) veniva salvato già alla prima
// apertura, e il giorno dopo la data salvata vinceva sul nuovo "oggi" — l'elenco si fermava al giorno
// della prima visita e le spedizioni nuove non comparivano. Il 13/10 420 clienti su 552 hanno ricevuto
// almeno un elenco fermo a un giorno passato, il più vecchio da 38 giorni. Ora ogni valore porta il
// giorno (di Roma) in cui è nato e il giorno dopo si riparte dai default: anche cliente, negozio e
// ricerca, che lasciati accesi svuotano l'elenco senza che nessuno se ne accorga.
// `perSempre` è per le PREFERENZE che non nascondono niente (righe per pagina): quelle restano.
//
// Caricamento nell'effect (non nell'inizializzatore) di proposito: al primo render server e client usano
// entrambi `iniziale` → niente mismatch di hydration; subito dopo il mount si rilegge da localStorage.
// La scrittura parte solo DOPO il primo caricamento, così il default non sovrascrive un valore salvato.
// `iniziale` può essere una FUNZIONE (come in useState): va usata quando il default contiene date,
// così "oggi" si calcola quando serve e non una volta per tutte al caricamento del modulo.
//
// La chiave va resa UNICA per pagina (es. 'spedizioni-master:filtri'); il prefisso 'flt:' permette a
// PuliziaSessione di azzerarle tutte all'accesso (una macchina condivisa non deve mostrare i filtri altrui).
type Salvato<T> = { giorno: string; valore: T }

function eSalvato<T>(x: unknown): x is Salvato<T> {
  return !!x && typeof x === 'object' && !Array.isArray(x) && typeof (x as any).giorno === 'string' && 'valore' in (x as any)
}

export function useFiltriPersistenti<T>(
  chiave: string,
  iniziale: T | (() => T),
  opzioni?: { perSempre?: boolean },
): [T, Dispatch<SetStateAction<T>>, () => void] {
  const full = 'flt:' + chiave
  const perSempre = !!opzioni?.perSempre
  // Il default si ricalcola ogni volta che serve (mount, azzera, cambio di giorno): con le date dentro,
  // un valore calcolato una volta sola sarebbe di nuovo una data ferma.
  const inizialeRef = useRef(iniziale)
  inizialeRef.current = iniziale
  const calcolaIniziale = (): T => {
    const i = inizialeRef.current
    return typeof i === 'function' ? (i as () => T)() : i
  }
  const [v, setV] = useState<T>(calcolaIniziale)
  const caricato = useRef(false)
  // Il giorno a cui appartiene il valore ATTUALE. Si scrive con questo, non con la data di adesso: un
  // filtro cambiato dopo mezzanotte su una pagina aperta da ieri porta ancora le date di ieri.
  const giornoValore = useRef<string>('')

  useEffect(() => {
    const oggi = giornoRoma()
    giornoValore.current = oggi
    try {
      const s = window.localStorage.getItem(full)
      if (s != null) {
        const x = JSON.parse(s)
        if (eSalvato<T>(x)) {
          if (perSempre || x.giorno === oggi) setV(x.valore)
          else window.localStorage.removeItem(full)
        } else if (perSempre) {
          setV(x as T)   // formato di prima (valore nudo): per le preferenze va bene così com'è
        } else {
          // Formato di prima, senza giorno: non si sa di quando è, ed è proprio il valore che teneva
          // fermo l'elenco. Si butta.
          window.localStorage.removeItem(full)
        }
      }
    } catch { /* localStorage non disponibile / JSON rotto: si tiene l'iniziale */ }
    caricato.current = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full])

  useEffect(() => {
    if (!caricato.current) return   // non salvare l'iniziale prima di aver letto il salvato
    try {
      const salvato: Salvato<T> = { giorno: giornoValore.current || giornoRoma(), valore: v }
      window.localStorage.setItem(full, JSON.stringify(salvato))
    } catch { /* quota/privato: pazienza */ }
  }, [full, v])

  // CAMBIO DI GIORNO A PAGINA APERTA. Chi lascia l'elenco aperto la sera e lo riguarda la mattina dopo
  // non ricarica la pagina: si controlla quando la scheda torna visibile, quando la finestra riprende il
  // fuoco e una volta al minuto (la postazione del magazzino resta sempre in primo piano).
  useEffect(() => {
    if (perSempre) return
    const controlla = () => {
      if (!caricato.current || !giornoValore.current) return
      const oggi = giornoRoma()
      if (oggi === giornoValore.current) return
      giornoValore.current = oggi
      try { window.localStorage.removeItem(full) } catch {}
      setV(calcolaIniziale())
    }
    const suVisibile = () => { if (document.visibilityState === 'visible') controlla() }
    document.addEventListener('visibilitychange', suVisibile)
    window.addEventListener('focus', controlla)
    const t = window.setInterval(controlla, 60_000)
    return () => {
      document.removeEventListener('visibilitychange', suVisibile)
      window.removeEventListener('focus', controlla)
      window.clearInterval(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, perSempre])

  // azzera(): rimette il default DI OGGI E cancella dal localStorage (per il bottone "Azzera filtri").
  const azzera = () => {
    try { window.localStorage.removeItem(full) } catch {}
    giornoValore.current = giornoRoma()
    setV(calcolaIniziale())
  }

  return [v, setV, azzera]
}
