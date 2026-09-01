'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'

// DESTINAZIONI PRINCIPALI — widget home (master/cliente/agente). Mappa dell'Italia colorata per
// PROVINCIA in base al volume di spedizioni degli ultimi 30 giorni (nel nostro arancione), col
// tooltip al passaggio del mouse, + classifica a fianco. Lo scope lo decide il server per ruolo
// (vedi /api/dashboard/destinazioni). Dati geografici: /public/geo/italia-province.json (topojson
// leggero, prop `prov_acr` = sigla, che combacia con dest_provincia). Il globo 3D mondiale arriva a
// parte. Niente librerie pesanti: solo d3-geo + topojson-client.

type Prov = { sigla: string; n: number; perc: number }
type Dati = { province: Prov[]; totale: number; nProvince: number } | null

// Scala arancione MoovExpress: da quasi-bianco caldo a arancio pieno, su radice quadrata (piu' leggibile).
const ARANCIO: [number, number, number] = [0xEA, 0x58, 0x0C]     // #EA580C
const CHIARO: [number, number, number] = [0xFF, 0xF3, 0xE6]      // panna caldo
function coloreVolume(n: number, max: number): string {
  if (!n || max <= 0) return '#f1f1f0'                            // nessuna spedizione = grigio neutro
  const t = Math.sqrt(n / max)                                   // sqrt: distribuisce meglio i colori
  const c = CHIARO.map((a, i) => Math.round(a + (ARANCIO[i] - a) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}

export default function DestinazioniWidget() {
  const [dati, setDati] = useState<Dati>(null)
  const [topo, setTopo] = useState<any>(null)
  const [errore, setErrore] = useState(false)
  const [hover, setHover] = useState<{ nome: string; n: number; x: number; y: number } | null>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/dashboard/destinazioni').then(r => r.json()).then(d => { if (vivo) setDati(d?.error ? { province: [], totale: 0, nProvince: 0 } : d) }).catch(() => vivo && setErrore(true))
    fetch('/geo/italia-province.json').then(r => r.json()).then(d => { if (vivo) setTopo(d) }).catch(() => vivo && setErrore(true))
    return () => { vivo = false }
  }, [])

  const W = 380, H = 440
  const perSigla = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of (dati?.province || [])) m.set(p.sigla, p.n)
    return m
  }, [dati])
  const maxN = useMemo(() => Math.max(1, ...(dati?.province || []).map(p => p.n)), [dati])

  // Province in SVG: geojson dal topojson + proiezione Mercator adattata al riquadro.
  const paths = useMemo(() => {
    if (!topo) return null
    try {
      const obj = topo.objects[Object.keys(topo.objects)[0]]
      const fc: any = feature(topo, obj)
      const proj = geoMercator().fitSize([W, H], fc)
      const path = geoPath(proj)
      return fc.features.map((f: any) => ({
        d: path(f) || '',
        sigla: String(f.properties?.prov_acr || '').toUpperCase(),
        nome: String(f.properties?.prov_name || ''),
      }))
    } catch { return null }
  }, [topo])

  const top = (dati?.province || []).slice(0, 8)
  const card: React.CSSProperties = { background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 18 }

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#EA580C' }}>📍</span> Destinazioni principali
        </div>
        <div style={{ fontSize: 12, color: '#9a9a9a' }}>Ultimi 30 giorni</div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* MAPPA */}
        <div ref={boxRef} style={{ position: 'relative', flex: '1 1 300px', minWidth: 260 }}
          onMouseLeave={() => setHover(null)}>
          {!paths ? (
            <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>
              {errore ? 'Mappa non disponibile' : 'Carico la mappa…'}
            </div>
          ) : (
            <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
              {paths.map((p: any, i: number) => {
                const n = perSigla.get(p.sigla) || 0
                return (
                  <path key={i} d={p.d} fill={coloreVolume(n, maxN)} stroke="#fff" strokeWidth={0.4}
                    style={{ cursor: n ? 'pointer' : 'default', transition: 'fill .15s' }}
                    onMouseMove={e => {
                      const r = boxRef.current?.getBoundingClientRect()
                      setHover({ nome: p.nome, n, x: e.clientX - (r?.left || 0), y: e.clientY - (r?.top || 0) })
                    }} />
                )
              })}
            </svg>
          )}
          {hover && (
            <div style={{ position: 'absolute', left: Math.min(hover.x + 10, W - 90), top: hover.y + 10, background: '#1a1a1a', color: '#fff', fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5 }}>
              {hover.nome}: {hover.n}
            </div>
          )}
        </div>

        {/* CLASSIFICA */}
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          {!dati ? (
            <div style={{ color: '#bbb', fontSize: 13, padding: 20 }}>Carico…</div>
          ) : top.length === 0 ? (
            <div style={{ color: '#9a9a9a', fontSize: 13, padding: '20px 0' }}>Nessuna spedizione negli ultimi 30 giorni.</div>
          ) : (
            <>
              {top.map((p, i) => (
                <div key={p.sigla} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < top.length - 1 ? '1px solid #f4f4f4' : 'none' }}>
                  <div style={{ width: 30, fontSize: 12, fontWeight: 700, color: '#9a9a9a', fontVariantNumeric: 'tabular-nums' }}>{p.sigla}</div>
                  <div style={{ flex: 1, height: 8, background: '#f4f4f4', borderRadius: 5, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.max(3, (p.n / (top[0].n || 1)) * 100)}%`, height: '100%', background: '#EA580C', borderRadius: 5 }} />
                  </div>
                  <div style={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>{p.n}</div>
                  <div style={{ width: 44, textAlign: 'right', fontSize: 12, color: '#9a9a9a', fontVariantNumeric: 'tabular-nums' }}>{p.perc.toFixed(1)}%</div>
                </div>
              ))}
              <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 10 }}>
                <b style={{ color: '#1a1a1a' }}>{dati.totale.toLocaleString('it-IT')}</b> spedizioni · {dati.nProvince} province
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
