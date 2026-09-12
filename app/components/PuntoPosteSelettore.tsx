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
// PuntoPoste". Cerca per CAP o per posizione (vicino a me) via /api/punti-poste; mappa + lista sincronizzate.
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
  const [evid, setEvid] = useState('')   // codice del punto evidenziato (hover lista ↔ pin)
  const mapDiv = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<any>(null)
  const layerRef = useRef<any>(null)
  const markersRef = useRef<Record<string, any>>({})

  const label = etichettaTipologia(tipologia)

  const cerca = useCallback(async (q: { cap?: string; lat?: number; lon?: number }) => {
    if (q.cap != null && !/^\d{5}$/.test(q.cap)) { setErr('Inserisci un CAP di 5 cifre'); setPunti([]); return }
    setErr(''); setLoading(true); setEvid('')
    const qs = q.cap != null ? `cap=${q.cap}` : `lat=${q.lat}&lon=${q.lon}`
    try {
      const r = await fetch(`/api/punti-poste?corriereId=${encodeURIComponent(corriereId)}&lato=${lato}&${qs}`)
      const d = await r.json()
      if (d.error) { setErr(d.error); setPunti([]) }
      else { setPunti(Array.isArray(d.punti) ? d.punti : []); if (!d.punti?.length) setErr('Nessun punto trovato qui vicino.') }
    } catch { setErr('Ricerca non riuscita, riprova.'); setPunti([]) } finally { setLoading(false) }
  }, [corriereId, lato])

  useEffect(() => { if (aperto && cap && !punti.length && !loading) cerca({ cap }) /* eslint-disable-next-line */ }, [aperto])

  function vicinoAMe() {
    if (!navigator.geolocation) { setErr('Geolocalizzazione non disponibile: cerca per CAP.'); return }
    setErr(''); setLoading(true)
    navigator.geolocation.getCurrentPosition(
      pos => cerca({ lat: pos.coords.latitude, lon: pos.coords.longitude }),
      () => { setLoading(false); setErr('Non riesco a leggere la posizione: cerca per CAP.') },
      { enableHighAccuracy: true, timeout: 8000 },
    )
  }

  const scegli = (p: any) => { onChange({ codice: p.codice, nome: p.nome, indirizzo: p.indirizzo, cap: p.cap, localita: p.localita, provincia: p.provincia }); setAperto(false) }

  // Porta la mappa su un punto e apre il popup (usato dall'hover/click sulla lista).
  const vaiAlPunto = (p: any) => {
    setEvid(p.codice)
    const mk = markersRef.current[p.codice]
    if (mk && mapRef.current && p.lat && p.lon) { mapRef.current.panTo([p.lat, p.lon]); mk.openPopup() }
  }

  const haCoord = punti.some((p: any) => p.lat && p.lon)

  // MAPPA: ricreata da zero a ogni apertura/ricerca (così non resta legata a un div staccato dopo
  // "Cambia") e con zoom pieno (rotella + pulsanti + pinch). Pin numerati come la lista, popup con "Scegli".
  useEffect(() => {
    if (!aperto || !haCoord) return
    let annullato = false
    caricaLeaflet().then((L: any) => {
      if (annullato || !mapDiv.current) return
      if (mapRef.current) { try { mapRef.current.remove() } catch {} ; mapRef.current = null }
      markersRef.current = {}
      const map = L.map(mapDiv.current, { scrollWheelZoom: true, zoomControl: true, attributionControl: false })
      mapRef.current = map
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map)
      layerRef.current = L.layerGroup().addTo(map)
      const bounds: any[] = []
      punti.forEach((p: any, i: number) => {
        if (!p.lat || !p.lon) return
        const icon = L.divIcon({ className: '', iconSize: [26, 26], iconAnchor: [13, 24], popupAnchor: [0, -22],
          html: `<div style="background:#f97316;color:#fff;width:24px;height:24px;border-radius:50% 50% 50% 0;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"><span style="transform:rotate(45deg);font:700 11px system-ui">${i + 1}</span></div>` })
        const mk = L.marker([p.lat, p.lon], { icon }).addTo(layerRef.current)
        const div = document.createElement('div')
        div.innerHTML = `<div style="font-weight:700;margin-bottom:2px">${(p.nome || p.codice)}</div><div style="color:#555">${p.indirizzo}, ${p.cap} ${p.localita}</div>`
        const b = document.createElement('button')
        b.textContent = 'Scegli questo punto'
        b.setAttribute('style', 'margin-top:6px;background:#f97316;color:#fff;border:none;border-radius:5px;padding:5px 10px;font-weight:700;cursor:pointer')
        b.onclick = () => scegli(p)
        div.appendChild(b)
        mk.bindPopup(div)
        mk.on('click', () => setEvid(p.codice))
        markersRef.current[p.codice] = mk
        bounds.push([p.lat, p.lon])
      })
      if (bounds.length) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 15 })
      setTimeout(() => { try { map.invalidateSize() } catch {} }, 120)
    }).catch(() => { /* mappa non disponibile: resta la lista */ })
    return () => { annullato = true }
    // eslint-disable-next-line
  }, [aperto, punti])

  useEffect(() => () => { try { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } } catch {} }, [])

  const box: React.CSSProperties = { border: '1px solid #e8e8e8', borderRadius: '8px', padding: '10px 12px', background: '#fff' }
  const inp: React.CSSProperties = { padding: '7px 10px', border: '1px solid #e8e8e8', borderRadius: '6px', fontSize: '13px', width: '110px' }
  const btn: React.CSSProperties = { padding: '7px 12px', border: 'none', borderRadius: '6px', fontSize: '12.5px', fontWeight: 700, cursor: 'pointer', background: '#f97316', color: '#fff' }
  const btn2: React.CSSProperties = { ...btn, background: '#fff', color: '#f97316', border: '1px solid #f97316' }

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
          <div style={{ display: 'flex', gap: '6px', alignItems: 'center', marginBottom: '8px', flexWrap: 'wrap' }}>
            <input value={cap} onChange={e => setCap(e.target.value.replace(/\D/g, '').slice(0, 5))} placeholder="CAP" style={inp}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); cerca({ cap }) } }} />
            <button type="button" onClick={() => cerca({ cap })} style={btn}>Cerca</button>
            <button type="button" onClick={vicinoAMe} style={btn2}>📍 Vicino a me</button>
          </div>
          {loading && <div style={{ fontSize: '12px', color: '#666' }}>Ricerca in corso…</div>}
          {err && <div style={{ fontSize: '12px', color: '#dc2626' }}>{err}</div>}
          {haCoord && <div ref={mapDiv} style={{ height: '260px', width: '100%', borderRadius: '8px', overflow: 'hidden', marginBottom: '8px', border: '1px solid #eef2f6' }} />}
          <div style={{ maxHeight: '220px', overflowY: 'auto' }}>
            {punti.map((p: any, i: number) => (
              <div key={p.codice}
                onMouseEnter={() => vaiAlPunto(p)}
                onClick={() => scegli(p)}
                style={{ display: 'flex', gap: '8px', alignItems: 'flex-start', border: '1px solid ' + (evid === p.codice ? '#f97316' : '#eef2f6'), background: evid === p.codice ? '#fff7ed' : '#fff', borderRadius: '6px', padding: '8px 10px', marginBottom: '5px', cursor: 'pointer' }}>
                {p.lat && p.lon
                  ? <span style={{ flexShrink: 0, width: '20px', height: '20px', borderRadius: '50%', background: '#f97316', color: '#fff', fontSize: '11px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{i + 1}</span>
                  : <span style={{ flexShrink: 0, width: '20px' }} />}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '12.5px', fontWeight: 600, color: '#1a1a1a' }}>{p.nome || p.codice}</div>
                  <div style={{ fontSize: '11.5px', color: '#666' }}>{p.indirizzo}, {p.cap} {p.localita} ({p.provincia}){p.distanzaKm != null ? ` · ${p.distanzaKm} km` : ''}</div>
                </div>
                <span style={{ flexShrink: 0, alignSelf: 'center', fontSize: '11.5px', fontWeight: 700, color: '#f97316' }}>Scegli</span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
