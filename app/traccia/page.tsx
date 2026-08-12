'use client'
import { useEffect, useState } from 'react'
import { CardTracking, cardStyle, ARANCIO, type DatiTracking } from './CardTracking'

// PORTALE PUBBLICO "cerca spedizioni": il cliente digita il numero/LDV e vede lo stato. Nessun login.
// Complementa /traccia/[token] (link diretto da SMS/email). Espone solo stato + città (nessun dato
// personale — la protezione sta nell'API /api/pubblico/tracking). Supporta anche il link ?n=NUMERO.

export default function CercaSpedizione() {
  const [numero, setNumero] = useState('')
  const [dati, setDati] = useState<DatiTracking | null>(null)
  const [stato, setStato] = useState<'idle' | 'carico' | 'ok' | 'nontrovato'>('idle')

  async function cerca(n: string) {
    const q = n.trim()
    if (!q) return
    setStato('carico'); setDati(null)
    try {
      const r = await fetch('/api/pubblico/tracking?n=' + encodeURIComponent(q))
      if (!r.ok) { setStato('nontrovato'); return }
      setDati(await r.json()); setStato('ok')
    } catch { setStato('nontrovato') }
  }

  // Link diretto ?n=NUMERO → ricerca automatica (come track.spedisci.online).
  useEffect(() => {
    try { const p = new URLSearchParams(window.location.search).get('n'); if (p) { setNumero(p); cerca(p) } } catch {}
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: '#f7f7f8', color: '#1a1a1a', fontFamily: 'system-ui,-apple-system,Segoe UI,Roboto,sans-serif', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 14px 40px' }}>
      <div style={{ width: '100%', maxWidth: '520px', display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px', padding: '0 4px' }}>
        <span style={{ fontWeight: 800, fontSize: '20px', letterSpacing: '-0.3px' }}>MoovExpress</span>
        <span style={{ marginLeft: 'auto', fontSize: '12px', color: '#9ca3af', fontWeight: 600 }}>Tracking spedizione</span>
      </div>

      {/* Ricerca */}
      <div style={{ ...cardStyle, padding: '24px 22px' }}>
        <div style={{ fontSize: '20px', fontWeight: 800, letterSpacing: '-0.3px', marginBottom: '4px' }}>Dov'è il tuo pacco?</div>
        <div style={{ fontSize: '13.5px', color: '#6b7280', marginBottom: '16px' }}>Inserisci il numero di spedizione (lo trovi nell'email o SMS ricevuti).</div>
        <form onSubmit={e => { e.preventDefault(); cerca(numero) }} style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <input
            value={numero}
            onChange={e => setNumero(e.target.value)}
            placeholder="Es. 1UW07WF310483"
            autoCapitalize="characters" autoCorrect="off" spellCheck={false}
            style={{ flex: 1, minWidth: '180px', padding: '12px 14px', border: '1.5px solid #e5e7eb', borderRadius: '10px', fontSize: '15px', color: '#1a1a1a', outline: 'none', boxSizing: 'border-box' }}
            onFocus={e => (e.currentTarget.style.borderColor = ARANCIO)}
            onBlur={e => (e.currentTarget.style.borderColor = '#e5e7eb')}
          />
          <button type="submit" disabled={stato === 'carico' || !numero.trim()}
            style={{ padding: '12px 24px', background: numero.trim() ? ARANCIO : '#d1d5db', color: '#fff', border: 'none', borderRadius: '10px', fontSize: '15px', fontWeight: 700, cursor: numero.trim() ? 'pointer' : 'default' }}>
            {stato === 'carico' ? 'Cerco…' : 'Cerca'}
          </button>
        </form>
      </div>

      {/* Risultato */}
      {stato !== 'idle' && (
        <div style={{ marginTop: '16px', width: '100%', maxWidth: '520px', display: 'flex', justifyContent: 'center' }}>
          {stato === 'carico' && <div style={cardStyle}><div style={{ padding: '40px 20px', textAlign: 'center', color: '#9ca3af', fontSize: '14px' }}>Cerco la spedizione…</div></div>}
          {stato === 'nontrovato' && (
            <div style={cardStyle}>
              <div style={{ padding: '40px 24px', textAlign: 'center' }}>
                <div style={{ fontSize: '34px', marginBottom: '10px' }}>🔍</div>
                <div style={{ fontWeight: 700, fontSize: '17px', marginBottom: '6px' }}>Spedizione non trovata</div>
                <div style={{ fontSize: '13.5px', color: '#6b7280', lineHeight: 1.5 }}>Controlla il numero e riprova. Se l'hai appena ordinato, potrebbe non essere ancora registrato.</div>
              </div>
            </div>
          )}
          {stato === 'ok' && dati && <CardTracking dati={dati} />}
        </div>
      )}

      <div style={{ marginTop: '18px', fontSize: '11.5px', color: '#b0b3ba' }}>Tracking fornito da MoovExpress</div>
    </div>
  )
}
