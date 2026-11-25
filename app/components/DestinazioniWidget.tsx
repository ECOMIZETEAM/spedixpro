'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoOrthographic, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { PAESE_ISO_NUM, PAESE_NOME_IT } from '@/lib/paesi-iso'
import { prendiAnticipata } from '@/lib/richieste-anticipate'

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

// Esportati perche' la home del master li anticipa insieme a /api/dashboard (vedi
// lib/richieste-anticipate). Nella home del cliente non si anticipa niente e si chiama come sempre.
export const URL_DESTINAZIONI = '/api/dashboard/destinazioni'
export const URL_MAPPA_ITALIA = '/geo/italia-province.json'

// I paesi della vista Europa della Dashboard nuova.
const EUROPA = new Set(['AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE', 'GB', 'CH', 'NO', 'IS', 'LI', 'MC', 'SM', 'VA', 'AD', 'AL', 'BA', 'ME', 'MK', 'RS', 'XK', 'MD', 'UA', 'BY'])

// `fx`: nella Dashboard nuova del master (app/components/dashboard-finexy) cornice, titolo e tasti prendono il disegno
// delle altre schede; mappa, globo e classifica sono gli stessi. Il cliente e l'agente la vedono com'era.
export default function DestinazioniWidget({ fx = false }: { fx?: boolean } = {}) {
  const [dati, setDati] = useState<Dati>(null)
  const [italiaTopo, setItaliaTopo] = useState<any>(null)
  const [worldTopo, setWorldTopo] = useState<any>(null)
  const [errore, setErrore] = useState(false)
  const [vista, setVista] = useState<'italia' | 'europa' | 'mondo'>('italia')
  const [hover, setHover] = useState<{ nome: string; n: number; x: number; y: number } | null>(null)
  const [rot, setRot] = useState<[number, number]>([-12, -42])   // parte centrato sull'Italia
  const boxRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; rot: [number, number] } | null>(null)

  useEffect(() => {
    let vivo = true
    const destinazioni = prendiAnticipata(URL_DESTINAZIONI) ?? fetch(URL_DESTINAZIONI)
    const mappa = prendiAnticipata(URL_MAPPA_ITALIA) ?? fetch(URL_MAPPA_ITALIA)
    destinazioni.then(r => r.json()).then(d => { if (vivo) setDati(d?.error ? { province: [], paesi: [], totale: 0, totalePaesi: 0, nProvince: 0 } : d) }).catch(() => vivo && setErrore(true))
    mappa.then(r => r.json()).then(d => { if (vivo) setItaliaTopo(d) }).catch(() => vivo && setErrore(true))
    return () => { vivo = false }
  }, [])
  // il mondo si carica solo quando si apre la vista globo (108KB in meno all'ingresso)
  useEffect(() => { if (vista !== 'italia' && !worldTopo) fetch('/geo/world-110m.json').then(r => r.json()).then(setWorldTopo).catch(() => setErrore(true)) }, [vista, worldTopo])

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

  // EUROPA (Dashboard nuova, Lorenzo 25/11): i paesi europei fuori dall'Italia, che ha la sua vista.
  const europei = (dati?.paesi || []).filter(p => EUROPA.has(p.code) && p.code !== 'IT')
  const totaleEuropa = europei.reduce((t, p) => t + p.n, 0)
  const classifica = vista === 'italia'
    ? (dati?.province || []).slice(0, 8).map(p => ({ k: p.sigla, nome: p.sigla, n: p.n, perc: p.perc }))
    : vista === 'europa'
      ? europei.slice(0, 8).map(p => ({ k: p.code, nome: PAESE_NOME_IT[p.code] || p.code, n: p.n, perc: totaleEuropa ? p.n / totaleEuropa * 100 : 0 }))
      : (dati?.paesi || []).slice(0, 8).map(p => ({ k: p.code, nome: PAESE_NOME_IT[p.code] || p.code, n: p.n, perc: p.perc }))
  const maxClass = classifica[0]?.n || 1
  const totale = vista === 'italia' ? (dati?.totale || 0) : vista === 'europa' ? totaleEuropa : (dati?.totalePaesi || 0)
  const conteggioLabel = vista === 'italia' ? `${dati?.nProvince || 0} province` : vista === 'europa' ? `${europei.length} paesi europei` : `${(dati?.paesi || []).length} paesi`

  // La sagoma dell'Europa (dal mondo, inquadrata da Lisbona all'Ucraina e da Malta a Capo Nord).
  const WE = 440, HE = 420
  const europaPaths = useMemo(() => {
    if (!worldTopo) return null
    try {
      const obj = worldTopo.objects.countries || worldTopo.objects[Object.keys(worldTopo.objects)[0]]
      const fc: any = feature(worldTopo, obj)
      const cornice: any = { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-11, 35], [-11, 71.5], [40, 71.5], [40, 35], [-11, 35]]] } }
      const path = geoPath(geoMercator().fitExtent([[4, 4], [WE - 4, HE - 4]], cornice))
      // solo i paesi europei: la sagoma dell'Europa, non un riquadro del mondo tagliato ai bordi
      // (l'Islanda resta nella classifica, ma disegnarla allargherebbe la mappa per un'isola)
      return fc.features.filter((f: any) => { const a2 = NUM_ALPHA2[Number(f.id)] || ''; return EUROPA.has(a2) && a2 !== 'IS' })
        .map((f: any) => ({ d: path(f) || '', id: Number(f.id), nome: String(f.properties?.name || '') }))
    } catch { return null }
  }, [worldTopo])

  const tab = (attivo: boolean): React.CSSProperties => fx
    ? { border: 'none', background: attivo ? 'var(--fx-nero)' : 'var(--fx-riquadro)', color: attivo ? 'var(--fx-carta)' : 'var(--fx-grigio)', fontSize: 12, fontWeight: 500, padding: '6px 13px', borderRadius: 999, cursor: 'pointer' }
    : { border: 'none', background: attivo ? '#EA580C' : '#f4f4f4', color: attivo ? '#fff' : '#6b7280', fontSize: 12.5, fontWeight: 700, padding: '5px 12px', borderRadius: 7, cursor: 'pointer' }

  // La mappa in rilievo della Dashboard nuova: lo spessore sono due copie della sagoma, piu' scure e spostate in basso,
  // disegnate una volta sola (al passaggio del mouse cambia solo lo strato colorato sopra).
  const spessore = (paths: any[] | null) => !paths ? null : (
    <>
      <g transform="translate(0,9)" filter="url(#fx-mappa-ombra)">{paths.map((p: any, i: number) => <path key={i} d={p.d} fill="#A9401A" stroke="#A9401A" strokeWidth={1.2} />)}</g>
      <g transform="translate(0,4.5)">{paths.map((p: any, i: number) => <path key={i} d={p.d} fill="#C8501F" stroke="#C8501F" strokeWidth={1.2} />)}</g>
    </>
  )
  const spessoreItalia = useMemo(() => spessore(italiaPaths), [italiaPaths])  // eslint-disable-line react-hooks/exhaustive-deps
  const spessoreEuropa = useMemo(() => spessore(europaPaths), [europaPaths])  // eslint-disable-line react-hooks/exhaustive-deps

  // Dashboard nuova (Lorenzo 25/11): prima «grande, piatta, brutta», poi «troppo piccolo». Una scheda larga due colonne:
  // a sinistra la mappa in rilievo e inclinata come un plastico (Italia, Europa) o il globo (Mondo), a destra la
  // classifica. Il cliente e l'agente vedono il riquadro di sempre, qui sotto.
  if (fx) {
    const ombra = <defs><filter id="fx-mappa-ombra" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="10" stdDeviation="9" floodColor="#5A1E08" floodOpacity="0.32" /></filter></defs>
    const sopra = (nome: string, n: number) => (e: React.MouseEvent) => { if (drag.current) return; const r = boxRef.current?.getBoundingClientRect(); setHover({ nome, n, x: e.clientX - (r?.left || 0), y: e.clientY - (r?.top || 0) }) }
    const carico = (testo: string) => <div className="fx-vuoto">{errore ? 'Mappa non disponibile' : testo}</div>
    return (
      <section className="fx-scheda fx-largo fx-destinazioni">
        <div className="fx-testa">
          <div><h2>Destinazioni</h2><p className="fx-sotto">Ultimi 30 giorni · {totale.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} spedizioni · {conteggioLabel}</p></div>
          <span style={{ display: 'inline-flex', gap: 4 }}>
            {(['italia', 'europa', 'mondo'] as const).map(v => <button key={v} onClick={() => { setVista(v); setHover(null) }} style={tab(vista === v)}>{v === 'italia' ? 'Italia' : v === 'europa' ? 'Europa' : 'Mondo'}</button>)}
          </span>
        </div>
        <div className="fx-dest-corpo">
          <div ref={boxRef} className="fx-mappa" onMouseLeave={() => { setHover(null); onUp() }}>
            {vista === 'italia' ? (
              !italiaPaths ? carico('Carico la mappa…')
                : <svg key="italia" viewBox={`-6 -6 ${W + 12} ${H + 24}`} className="fx-mappa-plastico" role="img" aria-label="Spedizioni per provincia, ultimi 30 giorni">
                  {ombra}{spessoreItalia}
                  {italiaPaths.map((p: any, i: number) => {
                    const n = perSigla.get(p.sigla) || 0
                    return <path key={i} d={p.d} fill={coloreVolume(n, maxProv)} stroke="#fff" strokeWidth={0.5} style={{ cursor: n ? 'pointer' : 'default' }} onMouseMove={sopra(p.nome, n)} />
                  })}
                </svg>
            ) : vista === 'europa' ? (
              !europaPaths ? carico('Carico l\'Europa…')
                : <svg key="europa" viewBox={`0 0 ${WE} ${HE + 14}`} className="fx-mappa-plastico fx-mappa-europa" role="img" aria-label="Spedizioni per paese europeo, ultimi 30 giorni">
                  {ombra}{spessoreEuropa}
                  {europaPaths.map((c: any, i: number) => {
                    const a2 = NUM_ALPHA2[c.id]
                    const n = a2 && a2 !== 'IT' ? (numToN.get(c.id) || 0) : 0
                    const maxE = Math.max(1, ...europei.map(p => p.n))
                    return <path key={i} d={c.d} fill={a2 === 'IT' ? '#E2D9D3' : n ? coloreVolume(n, maxE) : '#F1E9E3'} stroke="#fff" strokeWidth={0.5}
                      onMouseMove={sopra(a2 === 'IT' ? 'Italia (vedi la vista Italia)' : ((a2 && PAESE_NOME_IT[a2]) || c.nome), n)} />
                  })}
                </svg>
            ) : (
              !globo ? carico('Carico il globo…')
                : <svg key="mondo" viewBox={`0 0 ${W} ${H}`} className="fx-mappa-globo" style={{ cursor: drag.current ? 'grabbing' : 'grab', userSelect: 'none' }}
                  onMouseDown={onDown} onMouseMove={onMoveGlobo} onMouseUp={onUp}>
                  <defs><radialGradient id="fx-globo-luce" cx="35%" cy="30%" r="75%"><stop offset="0" stopColor="#FFFFFF" /><stop offset="1" stopColor="#E3ECF1" /></radialGradient></defs>
                  <path d={globo.sphere} fill="url(#fx-globo-luce)" stroke="#D6E2E8" strokeWidth={0.6} />
                  {globo.countries.map((c: any, i: number) => {
                    const n = numToN.get(c.id) || 0
                    const a2 = NUM_ALPHA2[c.id]
                    return <path key={i} d={c.d} fill={n ? coloreVolume(n, maxPaese) : '#DCE5EA'} stroke="#fff" strokeWidth={0.3} onMouseMove={sopra((a2 && PAESE_NOME_IT[a2]) || c.nome, n)} />
                  })}
                </svg>
            )}
            {hover && (hover.n > 0 || vista !== 'mondo') && (
              <div className="fx-mappa-nota" style={{ left: hover.x + 12, top: hover.y + 12 }}>{hover.nome}{hover.n ? `: ${hover.n.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}` : ''}</div>
            )}
            {vista === 'mondo' && globo && <div className="fx-mappa-aiuto">Trascina per girare il globo</div>}
          </div>
          <div className="fx-righe">
            {!dati ? <div className="fx-vuoto">Carico…</div> : !classifica.length
              ? <div className="fx-vuoto">{vista === 'italia' ? 'Nessuna spedizione in Italia negli ultimi 30 giorni.' : vista === 'europa' ? 'Nessuna spedizione verso l\'Europa negli ultimi 30 giorni.' : 'Nessuna spedizione estera negli ultimi 30 giorni.'}</div>
              : classifica.slice(0, 6).map(p => (
                <div key={p.k} className="fx-riga fx-dest-riga">
                  <span><b className="fx-sigla" title={p.nome} style={{ width: vista === 'italia' ? 34 : 104 }}>{p.nome}</b><i className="fx-barretta"><i style={{ width: `${Math.max(4, (p.n / maxClass) * 100)}%` }} /></i></span>
                  <b>{p.n.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} <span style={{ color: 'var(--fx-grigio)', fontWeight: 400 }}>· {p.perc.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</span></b>
                </div>
              ))}
          </div>
        </div>
      </section>
    )
  }

  const card: React.CSSProperties = { background: '#fff', border: '1px solid #eee', borderRadius: 14, padding: 18 }
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
                    <div style={{ width: 44, textAlign: 'right', fontSize: 12, color: '#9a9a9a', fontVariantNumeric: 'tabular-nums' }}>{p.perc.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%</div>
                  </div>
                ))}
                <div style={{ fontSize: 12, color: '#9a9a9a', marginTop: 10 }}>
                  <b style={{ color: '#1a1a1a' }}>{totale.toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)}</b> spedizioni · {conteggioLabel}
                </div>
              </>}
        </div>
      </div>
    </div>
  )
}
