'use client'
import { useState, useCallback } from 'react'

// Selettore locker/punto InPost. Cerca i punti via /api/inpost/punti (le credenziali restano lato server),
// mostra la lista con indirizzo/24h/tipo e permette di sceglierne uno. Il punto scelto (`id`) va poi in
// `pointId` alla creazione spedizione. Riusabile dal portale master e cliente.
export type InpostPuntoScelto = { id: string; nome: string; indirizzo: string; citta: string; cap: string; tipo: string; h247?: boolean }

export default function InpostLockerPicker({
  corriereId, capIniziale, valore, onSelect,
}: {
  corriereId: string
  capIniziale?: string
  valore?: InpostPuntoScelto | null
  onSelect: (p: InpostPuntoScelto | null) => void
}) {
  const [cap, setCap] = useState(capIniziale || '')
  const [punti, setPunti] = useState<InpostPuntoScelto[]>([])
  const [loading, setLoading] = useState(false)
  const [errore, setErrore] = useState<string | null>(null)
  const [aperto, setAperto] = useState(false)

  const cerca = useCallback(async () => {
    const c = cap.trim()
    if (!c) { setErrore('Inserisci un CAP per cercare i locker'); return }
    setLoading(true); setErrore(null)
    try {
      const r = await fetch(`/api/inpost/punti?corriereId=${encodeURIComponent(corriereId)}&cap=${encodeURIComponent(c)}`)
      const j = await r.json()
      if (!r.ok) { setErrore(j?.error || 'Ricerca non riuscita'); setPunti([]) }
      else { setPunti(Array.isArray(j?.punti) ? j.punti : []); setAperto(true); if (!j?.punti?.length) setErrore('Nessun locker trovato per questo CAP') }
    } catch { setErrore('Ricerca non disponibile in questo momento') }
    finally { setLoading(false) }
  }, [cap, corriereId])

  const box: React.CSSProperties = { border: '1px solid #e8e8e8', borderRadius: 8, padding: 12, background: '#fff' }
  const badge = (t: string, bg: string) => <span style={{ fontSize: 10, fontWeight: 700, color: '#fff', background: bg, borderRadius: 4, padding: '2px 6px' }}>{t}</span>

  return (
    <div style={box}>
      <div style={{ fontSize: 12, fontWeight: 700, color: '#1a1a1a', marginBottom: 8 }}>📍 Locker / Punto di ritiro InPost</div>

      {valore ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 7, padding: '8px 10px' }}>
          <div style={{ fontSize: 12.5 }}>
            <div style={{ fontWeight: 700, color: '#1a1a1a' }}>{valore.nome || valore.id} {valore.h247 ? badge('24/7', '#16a34a') : null}</div>
            <div style={{ color: '#666' }}>{valore.indirizzo} — {valore.cap} {valore.citta} · <span style={{ color: '#999' }}>{valore.id}</span></div>
          </div>
          <button type="button" onClick={() => onSelect(null)} style={{ fontSize: 12, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Cambia</button>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 8 }}>
            <input value={cap} onChange={e => setCap(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cerca() } }}
              placeholder="CAP del destinatario (es. 20121)" inputMode="numeric"
              style={{ flex: 1, padding: '9px 12px', border: '1px solid #e8e8e8', borderRadius: 7, fontSize: 13 }} />
            <button type="button" onClick={cerca} disabled={loading}
              style={{ padding: '9px 18px', background: '#f97316', color: '#fff', border: 'none', borderRadius: 7, fontSize: 13, fontWeight: 700, cursor: 'pointer', opacity: loading ? 0.6 : 1 }}>
              {loading ? 'Cerco…' : 'Cerca'}
            </button>
          </div>
          {errore && <div style={{ fontSize: 12, color: '#dc2626', marginTop: 6 }}>{errore}</div>}
          {aperto && punti.length > 0 && (
            <div style={{ marginTop: 8, maxHeight: 260, overflowY: 'auto', border: '1px solid #f0f0f0', borderRadius: 7 }}>
              {punti.map((p, i) => (
                <button type="button" key={p.id + i} onClick={() => { onSelect(p); setAperto(false) }}
                  style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 11px', borderBottom: i < punti.length - 1 ? '1px solid #f5f5f5' : 'none', background: '#fff', border: 'none', cursor: 'pointer' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700, color: '#1a1a1a', display: 'flex', gap: 6, alignItems: 'center' }}>
                    {p.indirizzo || p.id} {p.h247 ? badge('24/7', '#16a34a') : null} {badge(p.tipo === 'PUDO' ? 'Punto' : 'Locker', '#334155')}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#777' }}>{p.cap} {p.citta} · <span style={{ color: '#aaa' }}>{p.id}</span></div>
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}
