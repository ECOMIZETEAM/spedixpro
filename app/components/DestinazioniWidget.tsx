'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoOrthographic, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { PAESE_ISO_NUM, PAESE_NOME_IT } from '@/lib/paesi-iso'

// DESTINAZIONI PRINCIPALI — widget home (master/agente/cliente). Due viste con switch:
//  - ITALIA: choropleth delle province colorate per volume (ultimi 30gg) nel nostro arancione + tooltip;
//  - MONDO: globo 3D (proiezione orthographic) che parte FERMO sull'Italia e si RUOTA trascinando col
//    mouse, nazioni colorate per volume. Scope deciso dal server per ruolo (/api/dashboard/destinazioni).
// Dati geo leggeri in /public/geo. Solo d3-geo + topojson-client (niente librerie pesanti).

type Prov = { sigla: string; n: number; perc: number }
type Paese = { code: string; n: number; perc: number }
type Dati = { province: Prov[]; paesi: Paese[]; totale: number; totalePaesi: number; nProvince: number } | null

const ARANCIO: [number, number, number] = [0xEA, 0x58, 0x0C]
const CHIARO: [number, number, number] = [0xFF, 0xF3, 0xE6]
function coloreVolume(n: number, max: number): string {
  if (!n || max <= 0) return '#f1f1f0'
  const t = Math.sqrt(n / max)
  const c = CHIARO.map((a, i) => Math.round(a + (ARANCIO[i] - a) * t))
  return `rgb(${c[0]},${c[1]},${c[2]})`
}
// numerico ISO -> alpha2 (per il nome italiano nel tooltip del globo)
const NUM_ALPHA2: Record<number, string> = Object.entries(PAESE_ISO_NUM).reduce((m, [a2, num]) => { if (!m[num]) m[num] = a2; return m }, {} as Record<number, string>)

export default function DestinazioniWidget() {
  const [dati, setDati] = useState<Dati>(null)
  const [italiaTopo, setItaliaTopo] = useState<any>(null)
  const [worldTopo, setWorldTopo] = useState<any>(null)
  const [errore, setErrore] = useState(false)
  const [vista, setVista] = useState<'italia' | 'mondo'>('italia')
  const [hover, setHover] = useState<{ nome: string; n: number; x: number; y: number } | null>(null)
  const [rot, setRot] = useState<[number, number]>([-12, -42])   // parte centrato sull'Italia
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; rot: [number, number] } | null>(null)

  useEffect(() => {
    let vivo = true
    fetch('/api/dashboard/destinazioni').then(r => r.json()).then(d => { if (vivo) setDati(d?.error ? { province: [], paesi: [], totale: 0, totalePaesi: 0, nProvince: 0 } : d) }).catch(() => vivo && setErrore(true))
    fetch('/geo/italia-province.json').then(r => r.json()).then(d => { if (vivo) setItaliaTopo(d) }).catch(() => vivo && setErrore(true))
    return () => { vivo = false }
  }, [])
  // il mondo si carica solo quando si apre la vista globo (108KB in meno all'ingresso)
  useEffect(() => { if (vista === 'mondo' && !worldTopo) fetch('/geo/world-110m.json').then(r => r.json()).then(setWorldTopo).catch(() => setErrore(true)) }, [vista, worldTopo])

  const W = 380, H = 440
  const perSigla = useMemo(() => { const m = new Map<string, number>(); for (const p of (dati?.province || [])) m.set(p.sigla, p.n); return m }, [dati])
  const maxProv = useMemo(() => Math.max(1, ...(dati?.province || []).map(p => p.n)), [dati])
  const numToN = useMemo(() => { const m = new Map<number, number>(); for (const p of (dati?.paesi || [])) { const num = PAESE_ISO_NUM[p.code]; if (num) m.set(num, (m.get(num) || 0) + p.n) } return m }, [dati])
  const maxPaese = useMemo(() => Math.max(1, ...Array.from(numToN.values())), [numToN])

  const italiaPaths = useMemo(() => {
    if (!italiaTopo) return null
    try {
      const obj = italiaTopo.objects[Object.keys(italiaTopo.objects)[0]]
      const fc: any = feature(italiaTopo, obj)
      const path = geoPath(geoMercator().fitSize([W, H], fc))
      return fc.features.map((f: any) => ({ d: path(f) || '', sigla: String(f.properties?.prov_acr || '').toUpperCase(), nome: String(f.properties?.prov_name || '') }))
    } catch { return null }
  }, [italiaTopo])

  const globo = useMemo(() => {
    if (!worldTopo) return null
    try {
      const obj = worldTopo.objects.countries || worldTopo.objects[Object.keys(worldTopo.objects)[0]]
      const fc: any = feature(worldTopo, obj)
      const proj = geoOrthographic().rotate(rot).translate([W / 2, H / 2]).scale(Math.min(W, H) / 2 - 2)
      const path = geoPath(proj)
      return { sphere: path({ type: 'Sphere' } as any) || '', countries: fc.features.map((f: any) => ({ d: path(f) || '', id: Number(f.id), nome: String(f.properties?.name || '') })) }
    } catch { return null }
  }, [worldTopo, rot])

  function onDown(e: React.MouseEvent) { drag.current = { x: e.clientX, y: e.clientY, rot: [...rot] as [number, number] } }
  function onMoveGlobo(e: React.MouseEvent) {
    if (!drag.current) return
    const dx = e.clientX - drag.current.x, dy = e.clientY - drag.current.y
    setRot([drag.current.rot[0] + dx * 0.5, Math.max(-90, Math.min(90, drag.current.rot[1] - dy * 0.5))])
  }
  function onUp() { drag.current = null }

  const classifica = vista === 'italia'
    ? (dati?.province || []).slice(0, 8).map(p => ({ k: p.sigla, nome: p.sigla, n: p.n, perc: p.perc }))
    : (dati?.paesi || []).slice(0, 8).map(p => ({ k: p.code, nome: PAESE_NOME_IT[p.code] || p.code, n: p.n, perc: p.perc }))
  const maxClass = classifica[0]?.n || 1
  const totale = vista === 'italia' ? (dati?.totale || 0) : (dati?.totalePaesi || 0)
  const conteggioLabel = vista === 'italia' ? `${dati?.nProvince || 0} province` : `${(dati?.paesi || []).length} paesi`

  const card: React.CSSProperties = { background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 18 }
  const tab = (attivo: boolean): React.CSSProperties => ({ border: 'none', background: attivo ? '#EA580C' : '#f4f4f4', color: attivo ? '#fff' : '#6b7280', fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 7, cursor: 'pointer' })

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 10 }}>
        <div style={{ fontSize: 16, fontWeight: 800, color: '#1a1a1a', display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#EA580C' }}>📍</span> Destinazioni principali
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            <button onClick={() => setVista('italia')} style={tab(vista === 'italia')}>Italia</button>
            <button onClick={() => setVista('mondo')} style={tab(vista === 'mondo')}>Mondo</button>
          </span>
          <span style={{ fontSize: 12, color: '#9a9a9a' }}>Ultimi 30 gg</span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 18, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        {/* MAPPA / GLOBO */}
        <div ref={boxRef} style={{ position: 'relative', flex: '1 1 300px', minWidth: 260 }} onMouseLeave={() => { setHover(null); onUp() }}>
          {vista === 'italia' ? (
            !italiaPaths ? <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>{errore ? 'Mappa non disponibile' : 'Carico la mappa…'}</div>
              : <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
                {italiaPaths.map((p: any, i: number) => {
                  const n = perSigla.get(p.sigla) || 0
                  return <path key={i} d={p.d} fill={coloreVolume(n, maxProv)} stroke="#fff" strokeWidth={0.4} style={{ cursor: n ? 'pointer' : 'default', transition: 'fill .15s' }}
                    onMouseMove={e => { const r = boxRef.current?.getBoundingClientRect(); setHover({ nome: p.nome, n, x: e.clientX - (r?.left || 0), y: e.clientY - (r?.top || 0) }) }} />
                })}
              </svg>
          ) : (
            !globo ? <div style={{ height: H, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#bbb', fontSize: 13 }}>{errore ? 'Globo non disponibile' : 'Carico il globo…'}</div>
              : <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', display: 'block', cursor: drag.current ? 'grabbing' : 'grab', userSelect: 'none' }}
                onMouseDown={onDown} onMouseMove={onMoveGlobo} onMouseUp={onUp}>
                <path d={globo.sphere} fill="#eef4f7" stroke="#dbe6ec" strokeWidth={0.6} />
                {globo.countries.map((c: any, i: number) => {
                  const n = numToN.get(c.id) || 0
                  return <path key={i} d={c.d} fill={n ? coloreVolume(n, maxPaese) : '#dfe7ec'} stroke="#fff" strokeWidth={0.3}
                    onMouseMove={e => { if (drag.current) return; const r = boxRef.current?.getBoundingClientRect(); const a2 = NUM_ALPHA2[c.id]; setHover({ nome: (a2 && PAESE_NOME_IT[a2]) || c.nome, n, x: e.clientX - (r?.left || 0), y: e.clientY - (r?.top || 0) }) }} />
                })}
              </svg>
          )}
          {hover && (hover.n > 0 || vista === 'italia') && (
            <div style={{ position: 'absolute', left: Math.min(hover.x + 10, W - 90), top: hover.y + 10, background: '#1a1a1a', color: '#fff', fontSize: 12, fontWeight: 600, padding: '4px 8px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap', zIndex: 5 }}>
              {hover.nome}: {hover.n}
            </div>
          )}
          {vista === 'mondo' && globo && <div style={{ fontSize: 11, color: '#9a9a9a', textAlign: 'center', marginTop: 4 }}>Trascina per ruotare il globo</div>}
        </div>

        {/* CLASSIFICA */}
        <div style={{ flex: '1 1 260px', minWidth: 240 }}>
          {!dati ? <div style={{ color: '#bbb', fontSize: 13, padding: 20 }}>Carico…</div>
            : classifica.length === 0 ? <div style={{ color: '#9a9a9a', fontSize: 13, padding: '20px 0' }}>{vista === 'italia' ? 'Nessuna spedizione in Italia negli ultimi 30 giorni.' : 'Nessuna spedizione estera negli ultimi 30 giorni.'}</div>
              : <>
                {classifica.map((p, i) => (
                  <div key={p.k} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < classifica.length - 1 ? '1px solid #f4f4f4' : 'none' }}>
                    <div style={{ minWidth: 34, maxWidth: 90, fontSize: 12.5, fontWeight: 700, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nome}</div>
                    <div style={{ flex: 1, height: 8, background: '#f4f4f4', borderRadius: 5, overflow: 'hidden' }}>
                      <div style={{ width: `${Math.max(3, (p.n / maxClass) * 100)}%`, height: '100%', background: '#EA580C', borderRadius: 5 }} />
                    </div>
                    <div style={{ width: 44, textAlign: 'right', fontSize: 13, fontWeight: 700, color: '#1a1a1a', fontVariantNumeric: 'tabular-nums' }}>{p.n}</div>
                    <div style={{ width: 44, textAlign: 'right', fontSize: 12, color: '#9a9a9a', fontVariantNumeric: 'tabular-nums' }}>{p.perc.toFixed(1)}%</div>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 10 }}>
                  <b style={{ color: '#1a1a1a' }}>{totale.toLocaleString('it-IT')}</b> spedizioni · {conteggioLabel}
                </div>
              </>}
        </div>
      </div>
    </div>
  )
}
