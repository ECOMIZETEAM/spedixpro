'use client'
import { useState, useCallback, useEffect, useRef } from 'react'

// Selettore locker/punto InPost. Due modalità:
//  - MAPPA (Geowidget ufficiale InPost): se il contratto ha un token Geowidget configurato, si mostra
//    la mappa interattiva di InPost (script esterno geowidget.inpost-group.com) col country=IT e i punti
//    di consegna (config parcelCollect). Il punto scelto arriva dall'evento `onpointselect`: il suo
//    `name` è l'id del punto (es. IT_ITLMI05195P) che va in `pointId` alla creazione.
//  - LISTA (ripiego): ricerca per CAP via /api/inpost/punti (credenziali lato server). Usata se il token
//    Geowidget non è ancora configurato o se la mappa non carica.
// Il token Geowidget è PUBBLICO (InPost lo lega ai nostri domini): lo serve /api/inpost/geowidget.
export type InpostPuntoScelto = { id: string; nome: string; indirizzo: string; citta: string; cap: string; tipo: string; h247?: boolean }

const GEO_HOST = { prod: 'https://geowidget.inpost-group.com', stage: 'https://sandbox-global-geowidget-sdk.easypack24.net' }

// Carica CSS+JS del Geowidget una volta sola (per host). Risolve quando il custom element è definito.
const geoLoad: Record<string, Promise<void> | undefined> = {}
function caricaGeowidget(host: string): Promise<void> {
  if (typeof window === 'undefined') return Promise.reject()
  const cached = geoLoad[host]
  if (cached) return cached
  geoLoad[host] = new Promise<void>((resolve, reject) => {
    try {
      if (!document.querySelector(`link[data-geo="${host}"]`)) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = `${host}/inpost-geowidget.css`; l.setAttribute('data-geo', host); document.head.appendChild(l)
      }
      const done = () => (window as any).customElements?.whenDefined('inpost-geowidget').then(() => resolve()).catch(() => resolve())
      const existing = document.querySelector(`script[data-geo="${host}"]`) as HTMLScriptElement | null
      if (existing) { done(); return }
      const s = document.createElement('script'); s.src = `${host}/inpost-geowidget.js`; s.defer = true; s.setAttribute('data-geo', host)
      s.onload = done; s.onerror = () => reject(new Error('geowidget script'))
      document.head.appendChild(s)
    } catch (e) { reject(e as any) }
  })
  return geoLoad[host]
}

// Mappa il punto dell'evento Geowidget nel nostro formato. `name` = id del punto.
function daEvento(d: any): InpostPuntoScelto | null {
  const id = String(d?.name || '').trim()
  if (!id) return null
  const a = d?.address_details || d?.address || {}
  const via = [a.street, a.building_number].filter(Boolean).join(' ').trim() || String(d?.address?.line1 || '').trim()
  return {
    id, nome: id,
    indirizzo: via, citta: String(a.city || '').trim(), cap: String(a.post_code || a.postal_code || '').trim(),
    tipo: String(d?.type || '').toUpperCase().includes('POP') || String(d?.type || '').toUpperCase().includes('PUDO') ? 'PUDO' : 'APM',
    h247: !!(d?.location_247 ?? d?.location247),
  }
}

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
  // Config Geowidget: undefined = sto caricando; null = nessun token → lista; {token,...} = mappa.
  const [geo, setGeo] = useState<{ token: string; ambiente: 'prod' | 'stage' } | null | undefined>(undefined)
  const [mappaKO, setMappaKO] = useState(false)
  const [modo, setModo] = useState<'mappa' | 'lista'>('lista')
  const geoRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    let vivo = true
    fetch(`/api/inpost/geowidget?corriereId=${encodeURIComponent(corriereId)}`)
      .then(r => r.json()).then(j => { if (!vivo) return; if (j?.token) { setGeo({ token: j.token, ambiente: j.ambiente === 'prod' ? 'prod' : 'stage' }); setModo('mappa') } else setGeo(null) })
      .catch(() => { if (vivo) setGeo(null) })
    return () => { vivo = false }
  }, [corriereId])

  // Monta il Geowidget quando siamo in modalità mappa e senza punto già scelto.
  useEffect(() => {
    if (modo !== 'mappa' || !geo?.token || valore || mappaKO) return
    let vivo = true
    const host = GEO_HOST[geo.ambiente]
    const onPick = (e: any) => { const p = daEvento(e?.detail); if (p) onSelect(p) }
    caricaGeowidget(host).then(() => {
      if (!vivo || !geoRef.current) return
      geoRef.current.innerHTML = ''
      const el = document.createElement('inpost-geowidget') as any
      el.setAttribute('token', geo.token); el.setAttribute('country', 'IT'); el.setAttribute('language', 'it'); el.setAttribute('config', 'parcelCollect')
      el.style.width = '100%'; el.style.height = '460px'; el.style.display = 'block'
      geoRef.current.appendChild(el)
      document.addEventListener('onpointselect', onPick as any)
    }).catch(() => { if (vivo) setMappaKO(true) })
    return () => { vivo = false; document.removeEventListener('onpointselect', onPick as any) }
  }, [modo, geo, valore, mappaKO, onSelect])

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
  const usaMappa = modo === 'mappa' && !!geo?.token && !mappaKO

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
      ) : usaMappa ? (
        <>
          <div ref={geoRef} style={{ width: '100%', minHeight: 460, borderRadius: 7, overflow: 'hidden', border: '1px solid #f0f0f0' }} />
          <button type="button" onClick={() => setModo('lista')} style={{ marginTop: 6, fontSize: 11.5, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer' }}>Preferisci cercare per CAP? →</button>
        </>
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
          {mappaKO && <div style={{ fontSize: 11, color: '#999', marginTop: 6 }}>Mappa non disponibile ora: cerca il punto per CAP.</div>}
          {geo?.token && !mappaKO && <button type="button" onClick={() => setModo('mappa')} style={{ marginTop: 6, fontSize: 11.5, color: '#f97316', background: 'none', border: 'none', cursor: 'pointer' }}>← Torna alla mappa</button>}
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
