'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CardTracking, CartaCaricamento, CartaMessaggio, GuscioTracking, testiTracking, useLinguaTracking, type DatiTracking } from '../CardTracking'

// Pagina di tracking PUBBLICA (aperta dal destinatario tramite il link dell'SMS/email, o dal link che il
// negozio Shopify gli manda all'evasione). Nessun login. Mobile-first: si apre quasi sempre dal telefono.

export default function TrackingPubblico() {
  const params = useParams()
  const token = String((params as any)?.token || '')
  const lingua = useLinguaTracking()
  const t = testiTracking(lingua)
  const [dati, setDati] = useState<DatiTracking | null>(null)
  const [stato, setStato] = useState<'carico' | 'ok' | 'nontrovato' | 'errore'>('carico')
  const [riprova, setRiprova] = useState(0)

  // SOLO IL 404 VUOL DIRE "NON ESISTE".
  //
  // Prima qualunque risposta storta — database lento, rete caduta, 500 — finiva in "Spedizione non
  // trovata": al destinatario che aspetta un pacco stavamo dicendo che il suo pacco non esiste.
  // Ora il 404 (l'unico caso in cui abbiamo davvero guardato e non c'era) resta "non trovata";
  // tutto il resto diventa "non riusciamo a caricarlo adesso", con un pulsante per riprovare.
  useEffect(() => {
    if (!token) return
    let vivo = true
    ;(async () => {
      setStato('carico')
      try {
        const r = await fetch('/api/pubblico/tracking?t=' + encodeURIComponent(token))
        if (!vivo) return
        if (r.status === 404) { setStato('nontrovato'); return }
        if (!r.ok) { setStato('errore'); return }
        setDati(await r.json()); setStato('ok')
      } catch { if (vivo) setStato('errore') }
    })()
    return () => { vivo = false }
  }, [token, riprova])

  return (
    <GuscioTracking brand={dati?.brand || null} lingua={lingua}>
      {stato === 'carico' && <CartaCaricamento />}
      {stato === 'nontrovato' && <CartaMessaggio icona="cerca" titolo={t.nonTrovataTitolo} testo={t.nonTrovataTesto} />}
      {stato === 'errore' && (
        <CartaMessaggio icona="attesa" titolo={t.erroreTitolo} testo={t.erroreTesto}
          azione={<button type="button" className="tk-bottone" onClick={() => setRiprova((n) => n + 1)}>{t.riprova}</button>} />
      )}
      {stato === 'ok' && dati && <CardTracking dati={dati} lingua={lingua} />}
    </GuscioTracking>
  )
}
