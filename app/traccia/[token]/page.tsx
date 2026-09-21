'use client'
import { useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { CardTracking, cardStyle, type DatiTracking } from '../CardTracking'

// Pagina di tracking PUBBLICA (aperta dal destinatario tramite il link dell'SMS/email). Nessun login.
// Mobile-first: si apre quasi sempre dal telefono.

export default function TrackingPubblico() {
  const params = useParams()
  const token = String((params as any)?.token || '')
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

  const brandNome = dati?.brand?.nome || 'MoovExpress'
  const brandLogo = dati?.brand?.logo || null

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f8', color: '#1a1a1a', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 14px 40px' }}>
      <div style={{ width: '100%', maxWidth: '520px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '0 4px' }}>
        {brandLogo
          ? <img src={brandLogo} alt={brandNome} style={{ height: '30px', maxWidth: '160px', objectFit: 'contain' }} />
          : <span style={{ fontWeight: 800, fontSize: '20px', letterSpacing: '-0.3px' }}>{brandNome}</span>}
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af', fontWeight: 600 }}>Tracking spedizione</span>
      </div>

      {stato === 'carico' && (
        <div style={cardStyle}><div style={{ padding: '48px 20px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>Caricamento…</div></div>
      )}
      {stato === 'nontrovato' && (
        <div style={cardStyle}>
          <div style={{ padding: '44px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '34px', marginBottom: '10px' }}>🔍</div>
            <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '6px' }}>Spedizione non trovata</div>
            <div style={{ fontSize: '13.5px', color: '#6b7280', lineHeight: 1.5 }}>Controlla il link ricevuto: il codice potrebbe non essere corretto o la spedizione non è più disponibile.</div>
          </div>
        </div>
      )}
      {stato === 'errore' && (
        <div style={cardStyle}>
          <div style={{ padding: '44px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: '34px', marginBottom: '10px' }}>⏳</div>
            <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '6px' }}>Tracciamento non disponibile al momento</div>
            <div style={{ fontSize: '13.5px', color: '#6b7280', lineHeight: 1.5, marginBottom: '16px' }}>
              La spedizione c'è: è il servizio che non risponde in questo istante. Riprova fra qualche secondo.
            </div>
            <button onClick={() => setRiprova((n) => n + 1)}
              style={{ background: '#1a1a1a', color: '#fff', border: 'none', borderRadius: '8px', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>
              Riprova
            </button>
          </div>
        </div>
      )}
      {stato === 'ok' && dati && <CardTracking dati={dati} />}

      <div style={{ marginTop: '18px', fontSize: '11.5px', color: '#b0b3ba' }}>Tracking fornito da {brandNome}</div>
    </div>
  )
}
