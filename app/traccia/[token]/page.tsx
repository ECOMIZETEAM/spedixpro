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
  const [stato, setStato] = useState<'carico' | 'ok' | 'nontrovato'>('carico')

  useEffect(() => {
    if (!token) return
    ;(async () => {
      try {
        const r = await fetch('/api/pubblico/tracking?t=' + encodeURIComponent(token))
        if (!r.ok) { setStato('nontrovato'); return }
        setDati(await r.json()); setStato('ok')
      } catch { setStato('nontrovato') }
    })()
  }, [token])

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
      {stato === 'ok' && dati && <CardTracking dati={dati} />}

      <div style={{ marginTop: '18px', fontSize: '11.5px', color: '#b0b3ba' }}>Tracking fornito da {brandNome}</div>
    </div>
  )
}
