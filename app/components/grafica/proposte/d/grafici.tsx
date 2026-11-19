'use client'
// I micro-grafici della Proposta D «Bento»: a trama (puntini a mezzatinta, righe oblique), un solo accento arancio,
// mai grafici da foglio di calcolo. Si disegnano quando arrivano i dati (le barre crescono, l'anello si chiude): il
// disegno è nei fogli di stile (classi bd-cresce, bd-traccia), e chi chiede meno movimento li vede già fermi.
// Le misure si prendono dal contenitore DOPO l'apertura: al primo disegno (server e browser) il grafico è vuoto, così
// le due pagine coincidono.
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { fmtN } from '../../PlanciaNuova'

// la misura del contenitore: la larghezza sempre, l'altezza quando il grafico riempie lo spazio che resta nella
// tessera (senza altezza data)
function useMisure<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [m, setM] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = ref.current; if (!el) return
    const metti = () => { const r = el.getBoundingClientRect(); setM(v => (v.w === Math.round(r.width) && v.h === Math.round(r.height) ? v : { w: Math.round(r.width), h: Math.round(r.height) })) }
    const ro = new ResizeObserver(metti); ro.observe(el); metti()
    return () => ro.disconnect()
  }, [])
  return [ref, m.w, m.h] as const
}
// gli id dei motivi devono essere unici nella pagina (le stesse trame stanno nella tessera e nel foglio aperto)
const useIdTrama = () => 'bd' + useId().replace(/[^a-zA-Z0-9]/g, '')

export function Trame({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id + 'p'} width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.25" fill="var(--gx-inchiostro)" opacity=".82" /></pattern>
      <pattern id={id + 'a'} width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="var(--gx-accento)" /></pattern>
      <pattern id={id + 'r'} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.1" height="5" fill="var(--gx-accento)" /></pattern>
    </defs>
  )
}

// ── le ore di oggi: le create già in distinta a puntini, quelle ancora fuori distinta a righe arancio ──
export function Ore({ ore, adesso, alto: dato, grande }: { ore: any[]; adesso: number | null; alto?: number; grande?: boolean }) {
  const [ref, w, hm] = useMisure<HTMLDivElement>()
  const alto = dato || hm
  const id = useIdTrama()
  const primo = ore.findIndex(o => o.create > 0), ultimo = ore.length - 1 - [...ore].reverse().findIndex(o => o.create > 0)
  const da = Math.min(7, primo < 0 ? 7 : ore[primo].ora), a = Math.max(20, primo < 0 ? 20 : ore[ultimo].ora)
  const vista = ore.filter(o => o.ora >= da && o.ora <= a)
  const max = Math.max(4, ...vista.map(o => o.create))
  const basso = 20, cima = grande ? 20 : 6, y0 = alto - basso, H = y0 - cima
  const passo = w / Math.max(1, vista.length), bw = Math.min(passo * .58, grande ? 30 : 22)
  const Y = (v: number) => y0 - v / max * H
  const ogni = passo < 26 ? 3 : 2
  return (
    <div ref={ref} className={'bd-grafico' + (dato ? '' : ' bd-grafico--pieno')} style={dato ? { height: dato } : undefined}>
      {w > 0 && alto > 40 && (
        <svg width={w} height={alto} role="img" aria-label={'Create oggi ora per ora: ' + vista.filter(o => o.create).map(o => `alle ${o.ora} ${o.create}`).join(', ')}>
          <Trame id={id} />
          <line x1="0" x2={w} y1={y0 + .5} y2={y0 + .5} stroke="var(--gx-filo)" />
          {vista.map((o, i) => {
            const x = i * passo + (passo - bw) / 2, dentro = o.create - o.fuoriDistinta, ora = o.ora === adesso
            return (
              <g key={o.ora}>
                {o.create === 0 && <rect x={x} y={y0 - 2} width={bw} height="2" rx="1" fill="var(--gx-filo)" />}
                {dentro > 0 && <rect className="bd-cresce" style={{ animationDelay: i * 35 + 'ms' }} x={x} y={Y(dentro)} width={bw} height={y0 - Y(dentro)} rx={Math.min(5, bw / 3)} fill={`url(#${id}p)`} />}
                {o.fuoriDistinta > 0 && <rect className="bd-cresce" style={{ animationDelay: i * 35 + 120 + 'ms' }} x={x} y={Y(o.create)} width={bw} height={Math.max(2, Y(dentro) - Y(o.create) - (dentro > 0 ? 2 : 0))} rx={Math.min(5, bw / 3)} fill={`url(#${id}r)`} stroke="var(--gx-accento)" strokeWidth="1" />}
                {grande && o.create > 0 && <text className="bd-svg-valore" x={x + bw / 2} y={Y(o.create) - 6} textAnchor="middle">{o.create}</text>}
                {(o.ora % ogni === 0 || ora) && <text className={'bd-svg-asse' + (ora ? ' bd-svg-asse--ora' : '')} x={x + bw / 2} y={alto - 4} textAnchor="middle">{ora ? 'ora' : o.ora}</text>}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ── colonne a puntini (i giorni dei soldi, i mesi): l'ultima, o quella scelta, nell'arancio ──
export type Colonna = { k: string; v: number; sotto?: string; sopra?: string; accento?: boolean; tenue?: boolean; titolo?: string }
export function Colonne({ valori, alto: dato, assi, minimo = 1, larghezzaMax = 34 }: { valori: Colonna[]; alto?: number; assi?: (v: number) => string; minimo?: number; larghezzaMax?: number }) {
  const [ref, w, hm] = useMisure<HTMLDivElement>()
  const alto = dato || hm
  const id = useIdTrama()
  const max = Math.max(minimo, ...valori.map(v => v.v))
  const passi = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000]
  const tacca = passi.find(p => max / p <= 3) || 200000, cimaV = assi ? Math.ceil(max / tacca) * tacca : max
  const sx = assi ? 64 : 0, basso = valori.some(v => v.sotto) ? 20 : 4, cima = valori.some(v => v.sopra) ? 18 : 4
  const y0 = alto - basso, H = y0 - cima
  const passo = (w - sx) / Math.max(1, valori.length), bw = Math.min(passo * .6, larghezzaMax)
  const Y = (v: number) => y0 - Math.max(0, v) / cimaV * H
  const ogni = Math.max(1, Math.ceil(valori.length / Math.max(1, Math.floor((w - sx) / 46))))
  return (
    <div ref={ref} className={'bd-grafico' + (dato ? '' : ' bd-grafico--pieno')} style={dato ? { height: dato } : undefined}>
      {w > 0 && alto > 40 && (
        <svg width={w} height={alto} role="img" aria-label={valori.map(v => `${v.titolo || v.sotto || v.k}: ${v.sopra || fmtN.format(v.v)}`).join('; ')}>
          <Trame id={id} />
          {assi && Array.from({ length: Math.round(cimaV / tacca) + 1 }, (_, i) => i * tacca).map(t => (
            <g key={t}><line x1={sx} x2={w} y1={Y(t) + .5} y2={Y(t) + .5} stroke="var(--gx-filo)" /><text className="bd-svg-asse" x={sx - 10} y={Y(t) + 4} textAnchor="end">{assi(t)}</text></g>
          ))}
          {!assi && <line x1="0" x2={w} y1={y0 + .5} y2={y0 + .5} stroke="var(--gx-filo)" />}
          {valori.map((v, i) => {
            const x = sx + i * passo + (passo - bw) / 2
            return (
              <g key={v.k} opacity={v.tenue ? .45 : 1}>
                <rect className="bd-cresce" style={{ animationDelay: i * 22 + 'ms' }} x={x} y={Y(v.v)} width={bw} height={Math.max(1.5, y0 - Y(v.v))} rx={Math.min(6, bw / 3)}
                  fill={`url(#${id}${v.accento ? 'r' : 'p'})`} stroke={v.accento ? 'var(--gx-accento)' : 'none'} strokeWidth="1"><title>{(v.titolo || v.sotto || v.k) + ': ' + (v.sopra || fmtN.format(v.v))}</title></rect>
                {v.sopra && <text className={'bd-svg-valore' + (v.accento ? ' bd-svg-valore--accento' : '')} x={x + bw / 2} y={Y(v.v) - 6} textAnchor="middle">{v.sopra}</text>}
                {v.sotto && (i % ogni === 0 || v.accento) && <text className={'bd-svg-asse' + (v.accento ? ' bd-svg-asse--ora' : '')} x={x + bw / 2} y={alto - 4} textAnchor="middle">{v.sotto}</text>}
              </g>
            )
          })}
        </svg>
      )}
    </div>
  )
}

// ── il mosaico dei 30 giorni: cento puntini, uno per ogni centesimo delle spedizioni ──
// consegnate in inchiostro, in corso nell'arancio, i problemi in rosso (un puntino di stato), le annullate vuote
export function Mosaico({ gruppi, lato = 150 }: { gruppi: { k: string; n: number }[]; lato?: number }) {
  const tot = gruppi.reduce((a, g) => a + g.n, 0)
  // il metodo dei resti più grandi: i cento puntini tornano sempre cento
  const quote = useMemo(() => {
    if (!tot) return gruppi.map(() => 0)
    const esatte = gruppi.map(g => g.n / tot * 100), intere = esatte.map(Math.floor)
    let manca = 100 - intere.reduce((a, b) => a + b, 0)
    esatte.map((e, i) => [e - intere[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (manca > 0) { intere[i]++; manca-- } })
    return intere
  }, [gruppi, tot])
  const celle: string[] = []
  gruppi.forEach((g, i) => { for (let j = 0; j < quote[i]; j++) celle.push(g.k) })
  const c = lato / 10
  return (
    <svg className="bd-mosaico" width={lato} height={lato} viewBox={`0 0 ${lato} ${lato}`} role="img" aria-label={gruppi.map((g, i) => `${g.k} ${quote[i]}%`).join(', ')}>
      {Array.from({ length: 100 }, (_, i) => {
        const k = celle[i], x = (i % 10) * c + c / 2, y = Math.floor(i / 10) * c + c / 2
        return <circle key={i} className={'bd-cella bd-cella--' + (k || 'vuota')} style={{ animationDelay: (Math.floor(i / 10) * 40 + (i % 10) * 12) + 'ms' }} cx={x} cy={y} r={c * .36} />
      })}
    </svg>
  )
}

// ── l'anello del piano del mese ──
export function Anello({ quota, lato = 92, spessore = 9, children }: { quota: number; lato?: number; spessore?: number; children?: React.ReactNode }) {
  const r = (lato - spessore) / 2, giro = 2 * Math.PI * r, q = Math.max(0, Math.min(1, quota))
  return (
    <span className="bd-anello" style={{ width: lato, height: lato }}>
      <svg width={lato} height={lato} viewBox={`0 0 ${lato} ${lato}`} aria-hidden="true">
        <circle cx={lato / 2} cy={lato / 2} r={r} fill="none" stroke="var(--gx-incavo)" strokeWidth={spessore} />
        <circle cx={lato / 2} cy={lato / 2} r={r} fill="none" stroke="var(--bd-filo-forte)" strokeWidth="1" strokeDasharray="1 5" />
        {q > 0 && <circle className="bd-traccia" cx={lato / 2} cy={lato / 2} r={r} fill="none" stroke="var(--gx-accento)" strokeWidth={spessore} strokeLinecap="round"
          strokeDasharray={`${Math.max(.0001, q * giro)} ${giro}`} transform={`rotate(-90 ${lato / 2} ${lato / 2})`} style={{ ['--giro' as any]: giro }} />}
      </svg>
      {children && <span className="bd-anello__in">{children}</span>}
    </span>
  )
}

// ── la quota: una riga sottile a puntini che si riempie d'arancio ──
export function Quota({ v, etichetta }: { v: number; etichetta?: string }) {
  return <span className="bd-quota" role="img" aria-label={etichetta || `${Math.round(v * 100)}%`}><i style={{ width: Math.max(0, Math.min(100, v * 100)) + '%' }} /></span>
}

// ── la strada dei pacchi in corso: lavorazione, spedita, transito, consegna; il transito in arancio ──
export function Strada({ s }: { s: Record<string, number> }) {
  const passi = [['in_lavorazione', 'lavorazione'], ['spedita', 'spedite'], ['in_transito', 'transito'], ['in_consegna', 'consegna']] as const
  const tot = passi.reduce((a, [k]) => a + Number(s[k] || 0), 0)
  if (!tot) return null
  return (
    <span className="bd-strada" role="img" aria-label={'Negli ultimi 30 giorni: ' + passi.map(([k, n]) => `${n} ${fmtN.format(Number(s[k] || 0))}`).join(', ')}>
      {passi.map(([k]) => Number(s[k] || 0) > 0 && <i key={k} className={k === 'in_transito' ? 'bd-strada--su' : undefined} style={{ flex: Number(s[k] || 0) }} />)}
    </span>
  )
}

// ── i puntini delle giacenze: uno per giacenza (rossi: sono puntini di stato), fino a 24 ──
export function Puntini({ n }: { n: number }) {
  if (!n) return <span className="bd-puntini"><i className="bd-puntino bd-puntino--bene" /></span>
  return (
    <span className="bd-puntini" role="img" aria-label={`${n} giacenze`}>
      {Array.from({ length: Math.min(24, n) }, (_, i) => <i key={i} className="bd-puntino bd-puntino--problema" style={{ animationDelay: i * 40 + 'ms' }} />)}
      {n > 24 && <em>+{fmtN.format(n - 24)}</em>}
    </span>
  )
}

// ── l'Italia: ogni provincia più arancio quante più spedizioni riceve ──
const SCALA: Record<string, string[]> = { giorno: ['#FDE9D8', '#F9B583', '#F2772E', '#C24A0C'], notte: ['#3A4562', '#8A5236', '#E5702A', '#FF9A55'] }
function colore(n: number, max: number, tema: string) {
  if (!n) return tema === 'notte' ? 'rgba(255,255,255,.07)' : '#EDF0F4'
  const u = Math.pow(Math.sqrt(n) / Math.sqrt(max), 0.85) * 3, i = Math.min(2, Math.floor(u)), t = u - i
  const a = SCALA[tema][i], b = SCALA[tema][i + 1]
  const mix = [1, 3, 5].map(j => Math.round(parseInt(a.slice(j, j + 2), 16) * (1 - t) + parseInt(b.slice(j, j + 2), 16) * t))
  return `rgb(${mix.join(',')})`
}
export function useForme(topo: any, W: number, H: number) {
  return useMemo(() => {
    if (!topo?.objects) return null
    try {
      const fc: any = feature(topo, topo.objects[Object.keys(topo.objects)[0]])
      const path = geoPath(geoMercator().fitSize([W, H], fc))
      return fc.features.map((f: any) => ({ d: path(f) || '', sigla: String(f.properties?.prov_acr || '').toUpperCase(), nome: String(f.properties?.prov_name || ''), y: path.centroid(f)[1] }))
    } catch { return null }
  }, [topo, W, H])
}
export function Italia({ forme, province, tema, W, H, acceso, accendi }: { forme: any[] | null; province: any[]; tema: string; W: number; H: number; acceso?: string | null; accendi?: (s: string | null) => void }) {
  const per = useMemo(() => { const m = new Map<string, any>(); for (const p of province) m.set(p.sigla, p); return m }, [province])
  const max = Math.max(1, ...province.map(p => p.n))
  if (!forme) return <svg className="bd-italia" viewBox={`0 0 ${W} ${H}`} aria-hidden="true" />
  return (
    <svg className="bd-italia" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Spedizioni per provincia: ' + province.slice(0, 8).map(p => `${p.sigla} ${p.n}`).join(', ')}
      onPointerLeave={accendi ? () => accendi(null) : undefined}>
      {forme.map((f, i) => (
        <path key={i} d={f.d} fill={colore(per.get(f.sigla)?.n || 0, max, tema)} stroke={tema === 'notte' ? 'rgba(23,30,43,.9)' : '#FFFFFF'} strokeWidth={acceso === f.sigla ? 1.4 : .45}
          opacity={acceso && acceso !== f.sigla ? .5 : 1} style={{ animationDelay: (f.y / H * 700).toFixed(0) + 'ms' }} className="bd-provincia"
          onPointerEnter={accendi ? () => accendi(f.sigla) : undefined}><title>{f.nome}: {fmtN.format(per.get(f.sigla)?.n || 0)}</title></path>
      ))}
    </svg>
  )
}
export const scalaItalia = (tema: string) => `linear-gradient(90deg, ${SCALA[tema === 'notte' ? 'notte' : 'giorno'].join(',')})`

// ── di cosa è fatto il guadagno: una barra sola a segmenti (la voce più grande nell'arancio, le altre a puntini) ──
export function Composizione({ parti }: { parti: { k: string; nome: string; v: number }[] }) {
  const pos = parti.filter(p => p.v > 0.005).sort((a, b) => b.v - a.v), tot = pos.reduce((a, p) => a + p.v, 0)
  if (!tot) return null
  const q = (v: number) => { const x = v / tot * 100; return x < 1 ? '<1%' : Math.round(x) + '%' }
  return (
    <div className="bd-comp" role="img" aria-label={'Il guadagno per voce: ' + pos.map(p => `${p.nome} ${q(p.v)}`).join(', ')}>
      <span className="bd-comp__barra">{pos.map((p, i) => <i key={p.k} className={i === 0 ? 'bd-comp__su' : undefined} style={{ flex: p.v, opacity: i === 0 ? 1 : Math.max(.35, 1 - i * .16) }} />)}</span>
      <ul className="bd-comp__legenda">{pos.slice(0, 4).map((p, i) => <li key={p.k}><i className={i === 0 ? 'bd-l-r' : 'bd-l-p'} />{p.nome}<b>{q(p.v)}</b></li>)}</ul>
    </div>
  )
}
