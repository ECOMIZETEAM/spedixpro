'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import { etichettaTipologia } from '@/lib/punti-poste'

// Punto scelto (quello che serve alla creazione: il codice va in pudo_destinatario).
export type PuntoScelto = { codice: string; nome: string; indirizzo: string; cap: string; localita: string; provincia: string }

// Leaflet caricato da CDN al volo (nessuna dipendenza npm): la mappa è un DI PIÙ sopra la lista —
// se il CDN non è raggiungibile, resta la lista per distanza e la ricerca funziona lo stesso.
let leafletPromise: Promise<any> | null = null
function caricaLeaflet(): Promise<any> {
  if (typeof window === 'undefined') return Promise.reject(new Error('ssr'))
  if ((window as any).L) return Promise.resolve((window as any).L)
  if (leafletPromise) return leafletPromise
  leafletPromise = new Promise((res, rej) => {
    if (!document.getElementById('leaflet-css')) {
      const link = document.createElement('link')
      link.id = 'leaflet-css'; link.rel = 'stylesheet'
      link.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css'
      document.head.appendChild(link)
    }
    const s = document.createElement('script')
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js'
    s.async = true; s.onload = () => res((window as any).L); s.onerror = rej
    document.head.appendChild(s)
  })
  return leafletPromise
}

// Selettore di un punto di CONSEGNA (PuntoPoste / Ufficio Postale) per un contratto DVA "porta a un
// PuntoPoste". Cerca per CAP via /api/punti-poste (ordinati per distanza), mostra mappa + lista.
export default function PuntoPosteSelettore({ corriereId, lato, capIniziale, tipologia, valore, onChange, preferiti = [] }: {
  corriereId: string
  lato: 'partenza' | 'arrivo'
  capIniziale?: string
  tipologia?: string
  valore: PuntoScelto | null
  onChange: (p: PuntoScelto | null) => void
  preferiti?: PuntoScelto[]
}) {
  const [aperto, setAperto] = useState(false)
  const [cap, setCap] = useState((capIniziale || '').replace(/\D/g, '').slice(0, 5))
  const [punti, setPunti] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const mapDiv = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)

  const label = etichettaTipologia(tipologia)

  const cerca = useCallback(async (c: string) => {
    if (!/^\d{5}$/.test(c)) { setErr('Inserisci un CAP di 5 cifre'); setPunti([]); return }
    setErr(''); setLoading(true)
    try {
      const r = await fetch(`/api/punti-poste?corriereId=${encodeURIComponent(corriereId)}&lato=${lato}&cap=${c}`)
      const d = await r.json()
      if (d.error) { setErr(d.error); setPunti([]) }
      else { setPunti(Array.isArray(d.punti) ? d.punti : []); if (!d.punti?.length) setErr('Nessun punto trovato vicino a questo CAP.') }
    } catch { setErr('Ricerca non riuscita, riprova.'); setPunti([]) } finally { setLoading(false) }
  }, [corriereId, lato])

  useEffect(() => { if (aperto && cap && !punti.length && !loading) cerca(cap) /* eslint-disable-next-line */ }, [aperto])

  const scegli = (p: any) => {
    onChange({ codice: p.codice, nome: p.nome, indirizzo: p.indirizzo, cap: p.cap, localita: p.localita, provincia: p.provincia })
    setAperto(false)
  }

  // MAPPA: marker per ogni punto con coordinate; click sul marker = scegli. Fit sui punti.
  const haCoord = punti.some((p: any) => p.lat && p.lon)
  useEffect(() => {
    if (!aperto || !haCoord) return
    let annullato = false
    caricaLeaflet().then((L: any) => {
      if (annullato || !mapDiv.current) return
      if (!mapRef.current) {
        mapRef.current = L.map(mapDiv.current, { scrollWheelZoom: false, attributionControl: false })
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(mapRef.current)
      }
      if (layerRef.current) layerRef.current.remove()
      layerRef.current = L.layerGroup().addTo(mapRef.current)
      const bounds: any[] = []
      for (const p of punti) {
        if (!p.lat || !p.lon) continue
        const mk = L.circleMarker([p.lat, p.lon], { radius: 7, color: '#f97316', fillColor: '#f97316', fillOpacity: 0.85, weight: 2 })
        mk.bindPopup(`<b>${(p.nome || p.codice)}</b><br>${p.indirizzo}, ${p.cap} ${p.localita}`)
        mk.on('click', () => scegli(p))
        mk.addTo(layerRef.current); bounds.push([p.lat, p.lon])
      }
      if (bounds.length) mapRef.current.fitBounds(bounds, { padding: [20, 20], maxZoom: 15 })
      setTimeout(() => { try { mapRef.current && mapRef.current.invalidateSize() } catch {} }, 120)
    }).catch(() => { /* mappa non disponibile: resta la lista */ })
    return () => { annullato = true }
    // eslint-disable-next-line
  }, [aperto, punti])

  useEffect(() => () => { try { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } } catch {} }, [])

  const box: React.CSSProperties = { border: '1px solid #e8e8e8', borderRadius: '8px', padding: '10px 12px', background: '#fff' }
  const inp: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', width: '120px' }
  const btn: React.CSSProperties = { padding: '7px 12px', border: 'none', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', background: '#f97316', color: '#fff' }

  if (valore) {
    return (
      <div style={box}>
        <div style={{ fontSize: '11.5px', color: '#16a34a', fontWeight: 700, marginBottom: '3px' }}>✓ {label} selezionato</div>
        <div style={{ fontSize: '13px', color: '#1a1a1a', fontWeight: 600 }}>{valore.nome || valore.codice}</div>
        <div style={{ fontSize: '12px', color: '#666' }}>{valore.indirizzo}, {valore.cap} {valore.localita} ({valore.provincia})</div>
        <button type="button" onClick={() => { onChange(null); setAperto(true) }} style={{ ...btn, background: '#6b7280', marginTop: '6px', padding: '5px 10px' }}>Cambia punto</button>
      </div>
    )
  }

  return (
    <div style={box}>
      {!aperto ? (
        <button type="button" onClick={() => setAperto(true)} style={btn}>Scegli {label}…</button>
      ) : (
        <>
          {preferiti.length > 0 && (
            <div style={{ marginBottom: '8px' }}>
              <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>I tuoi punti salvati</div>
              {preferiti.map(p => (
                <button key={p.codice} type="button" onClick={() => scegli(p)}
                  style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid #fed7aa', background: '#fff7ed', borderRadius: '6px', padding: '6px 9px', marginBottom: '4px', cursor: 'pointer', fontSize: '12.5px' }}>
                  ★ {p.nome || p.codice} — {p.indirizzo}, {p.cap} {p.localita}
                </button>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px' }}>
            <input value={cap} onChange={e => setCap(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="CAP" style={inp}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cerca(cap) } }} />
            <button type="button" onClick={() => cerca(cap)} style={btn}>Cerca punti</button>
          </div>
          {loading && <div style={{ fontSize: '12px', color: '#666' }}>Ricerca in corso…</div>}
          {err && <div style={{ fontSize: '12px', color: '#dc2626' }}>{err}</div>}
          {haCoord && <div ref={mapDiv} style={{ height: '220px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px', border: '1px solid #eef2f6' }} />}
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {punti.map((p: any) => (
              <button key={p.codice} type="button" onClick={() => scegli(p)}
                style={{ display: 'block', width: '100%', textAlign: 'left', border: '1px solid #eef2f6', background: '#fff', borderRadius: '6px', padding: '8px 10px', marginBottom: '5px', cursor: 'pointer' }}>
                <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>{p.nome || p.codice}</div>
                <div style={{ fontSize: '11.5px', color: '#666' }}>{p.indirizzo}, {p.cap} {p.localita} ({p.provincia}){p.distanzaKm != null ? ` · ${p.distanzaKm} km` : ''}</div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
