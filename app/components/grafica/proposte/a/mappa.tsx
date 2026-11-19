'use client'
// L'ITALIA DELLA TORRE (proposta A, 27/10): la mappa vera delle province (d3-geo) messa su un tavolo inclinato e
// vista in prospettiva, fatta coi conti e non con WebGL. La lastra ha spessore e ombra; ogni provincia si accende
// col suo volume degli ultimi 30 giorni; le più servite si alzano in prismi e pulsano con gli anelli; gli archi di
// luce sono spedizioni vere (dal mittente al destinatario) o, se la sede del master è nota, dalla sede alle
// destinazioni principali. Il 3D già disegnato (italia-*.webp) non si usa: ha i volumi di un altro giorno cotti dentro.
import { memo, useEffect, useMemo, useState } from 'react'
import { geoCentroid, geoCircle, geoMercator, geoPath, geoTransform } from 'd3-geo'
import { feature, merge } from 'topojson-client'
import { calmo } from '../../movimento'
import { fmtN } from '../../PlanciaNuova'

type XY = [number, number]
export type Provincia = { sigla: string; n: number; perc: number }
export type Volo = { id: string; da: string; a: string; nuovo: boolean }
type Rett = { x: number; y: number; w: number; h: number }

// La Sardegna del 2016: le spedizioni nuove arrivano con SU (Sud Sardegna), la carta ha ancora le quattro province
// di prima. SU si disegna su Carbonia-Iglesias e Medio Campidano, che ne sono il cuore.
const ALIAS: Record<string, string[]> = { SU: ['CI', 'VS'] }
const NOMI_ALIAS: Record<string, string> = { SU: 'Sud Sardegna' }

// la camera: inclinazione del tavolo (0 = dall'alto), rotazione sul tavolo e distanza (prospettiva lieve)
const INCLINA = 55 * Math.PI / 180, GIRA = -15 * Math.PI / 180, FUOCO = 2100
const SPESSORE = 18, ALTEZZA = 50

// le scale dei colori: di giorno dal gesso all'arancio bruciato, di notte dall'ardesia alla brace che si accende
const SCALA: Record<string, string[]> = {
  giorno: ['#F3F5F8', '#FCE7D8', '#F9C6A2', '#F59A62', '#F26B1D'],
  notte: ['#263047', '#34405C', '#6E4636', '#E0621E', '#FFA060'],
}
const hex = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
export function tinta(n: number, max: number, tema: string) {
  const s = SCALA[tema] || SCALA.giorno
  if (!n || !max) return s[0]
  const u = Math.pow(n / max, 0.72) * (s.length - 2) + 1, i = Math.min(s.length - 2, Math.floor(u)), t = Math.min(1, u - i)
  const a = hex(s[i]), b = hex(s[i + 1])
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * t)).join(',')})`
}

// le pareti di un prisma hanno il colore della sua cima, più scuro (la luce viene da sinistra)
const scurisci = (c: string, k: number) => { const m = c.match(/\d+/g); return m ? `rgb(${m.slice(0, 3).map(v => Math.round(+v * (1 - k))).join(',')})` : c }
const gradi = (v: number, pos: string, neg: string) => { const a = Math.abs(v), g = Math.floor(a), m = Math.round((a - g) * 60); return `${g}°${String(m).padStart(2, '0')}′${v >= 0 ? pos : neg}` }

export const MappaItalia = memo(function MappaItalia({ W, H, box, fin, topo, dest, sede, voli, tema, nomi }: {
  W: number; H: number; box: Rett; fin: Rett; topo: any; dest: Provincia[] | null; sede: string | null; voli: Volo[]; tema: string
  nomi?: (m: Map<string, string>) => void
}) {
  // ── la geometria: dipende solo dalla carta e dalla misura del palco ──
  const geo = useMemo(() => {
    if (!topo?.objects?.prov || W < 10) return null
    const oggetto = topo.objects.prov
    const fc: any = feature(topo, oggetto)
    const terra: any = merge(topo, oggetto.geometries)
    const merc = geoMercator().fitSize([1000, 1000], fc)
    const ci = Math.cos(INCLINA), si = Math.sin(INCLINA), cg = Math.cos(GIRA), sg = Math.sin(GIRA)
    const grezzo = (x: number, y: number, z: number): [number, number, number] => {
      const X0 = x - 500, Y0 = y - 500
      const X = X0 * cg - Y0 * sg, Y = X0 * sg + Y0 * cg
      const dz = -Y * si - z * ci, k = FUOCO / (FUOCO + dz)
      return [X * k, (Y * ci - z * si) * k, k]
    }
    // la misura: tutta la terra a quota zero più la cima dei prismi più alti, dentro il riquadro libero del palco
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity
    const anelli: XY[][] = []
    for (const poli of terra.coordinates) anelli.push(poli[0])
    for (const anello of anelli) for (const c of anello) {
      const m = merc(c as XY)!; const [a, b] = grezzo(m[0], m[1], 0)
      x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b)
    }
    const S = Math.min(box.w / (x1 - x0), box.h / (y1 - y0))
    const ox = box.x + (box.w - (x1 - x0) * S) / 2 - x0 * S, oy = box.y + (box.h - (y1 - y0) * S) / 2 - y0 * S
    const sc = (x: number, y: number, z = 0): [number, number, number] => { const [a, b, k] = grezzo(x, y, z); return [ox + a * S, oy + b * S, k] }
    const pr = (c: XY, z = 0) => { const m = merc(c)!; return sc(m[0], m[1], z) }
    const flusso: any = { stream: (out: any) => merc.stream(geoTransform({ point(this: any, x: number, y: number) { const p = sc(x, y, 0); this.stream.point(p[0], p[1]) } }).stream(out)) }
    const path = geoPath(flusso)
    const dPunti = (p: XY[]) => 'M' + p.map(q => q[0].toFixed(1) + ' ' + q[1].toFixed(1)).join('L') + 'Z'

    // la lastra: cima, pareti (le facce verso chi guarda) e ombra sul pavimento
    const pareti = (anello: XY[], z0: number, z1: number) => {
      const b = anello.map(c => pr(c, z0)), t = anello.map(c => pr(c, z1))
      let area = 0; for (let i = 0; i < b.length - 1; i++) area += b[i][0] * b[i + 1][1] - b[i + 1][0] * b[i][1]
      const verso = area > 0 ? 1 : -1
      const luce: string[] = [], ombra: string[] = []
      for (let i = 0; i < b.length - 1; i++) {
        const ex = b[i + 1][0] - b[i][0], ey = b[i + 1][1] - b[i][1]
        // la normale verso fuori: si vedono solo le pareti che guardano chi guarda (verso il basso dello schermo)
        const nx = ey * verso, ny = -ex * verso
        if (ny <= 0) continue
        const q = `M${b[i][0].toFixed(1)} ${b[i][1].toFixed(1)}L${b[i + 1][0].toFixed(1)} ${b[i + 1][1].toFixed(1)}L${t[i + 1][0].toFixed(1)} ${t[i + 1][1].toFixed(1)}L${t[i][0].toFixed(1)} ${t[i][1].toFixed(1)}Z`
        ;(nx < 0 ? luce : ombra).push(q)
      }
      return { luce: luce.join(''), ombra: ombra.join(''), cima: dPunti(t.map(p => [p[0], p[1]] as XY)) }
    }
    const lastra = anelli.map(a => pareti(a, -SPESSORE, 0))

    const nomi = new Map<string, string>()
    const province = fc.features.map((f: any) => {
      const sigla = String(f.properties?.prov_acr || '').toUpperCase(), nome = String(f.properties?.prov_name || sigla)
      nomi.set(sigla, nome)
      const c = geoCentroid(f) as XY, p = pr(c)
      const poli: XY[][] = f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.coordinates.map((x: any) => x[0])
      return { sigla, nome, d: path(f) || '', c, p, poli }
    })
    const perSigla = new Map<string, any>(province.map((p: any) => [p.sigla, p]))

    // il pavimento: una griglia sul tavolo, allineata alla camera (l'Italia ci sta sopra girata), che fugge nella
    // prospettiva come quella di una sala vera. Davanti si ferma prima che la prospettiva esploda.
    const cam = (X: number, Y: number) => { const dz = -Y * si, k = FUOCO / (FUOCO + dz); return [ox + X * k * S, oy + Y * ci * k * S] }
    const linee: string[] = [], lontano = -2600, vicino = 0.6 * FUOCO / si, L = (a: number[], b: number[]) => `M${a[0].toFixed(0)} ${a[1].toFixed(0)}L${b[0].toFixed(0)} ${b[1].toFixed(0)}`
    for (let g = -3600; g <= 3600; g += 100) linee.push(L(cam(g, lontano), cam(g, vicino)))
    for (let g = lontano; g <= vicino; g += 100) linee.push(L(cam(-3600, g), cam(3600, g)))
    return { pr, path, terra, lastra, province, perSigla, nomi, griglia: linee.join(''), dPunti, pareti, S, si }
  }, [topo, W, H, box.x, box.y, box.w, box.h])

  useEffect(() => { if (geo && nomi) nomi(geo.nomi) }, [geo, nomi])

  // ── i volumi: per sigla (con l'alias della Sardegna), il massimo e i primi ──
  const vol = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of dest || []) {
      const s = String(p.sigla || '').toUpperCase().trim()
      for (const k of ALIAS[s] || [s]) m.set(k, (m.get(k) || 0) + Number(p.n || 0))
    }
    const max = Math.max(1, ...m.values())
    const primi = (dest || []).map(p => ({ ...p, sigla: String(p.sigla || '').toUpperCase().trim() }))
      .filter(p => p.n > 0 && (geo?.perSigla.has(p.sigla) || ALIAS[p.sigla])).sort((a, b) => b.n - a.n).slice(0, 6)
    return { m, max, primi }
  }, [dest, geo])

  // dove sta una sigla sulla carta (il centro; per SU il centro delle due province che la disegnano)
  const centro = (s: string): XY | null => {
    if (!geo) return null
    const k = ALIAS[s] ? ALIAS[s].map(x => geo.perSigla.get(x)).filter(Boolean) : [geo.perSigla.get(s)].filter(Boolean)
    if (!k.length) return null
    return [k.reduce((a: number, p: any) => a + p.c[0], 0) / k.length, k.reduce((a: number, p: any) => a + p.c[1], 0) / k.length]
  }

  // ── l'accensione: la passata di luce scende sulla carta quando arrivano i volumi, una volta ──
  const [acceso, setAcceso] = useState(false)
  const [cresci, setCresci] = useState(0)
  // finita la prima accensione i ritardi si tolgono: al cambio giorno/notte le province cambiano tutte insieme
  const [fermo, setFermo] = useState(false)
  // parte quando ci sono insieme la carta e i volumi (un booleano: col doppio giro dei controlli di React in sviluppo
  // l'effetto si smonta e si rimonta, e con un ricordo «già partito» la carta restava spenta)
  const pronta = !!dest && !!geo
  useEffect(() => {
    if (!pronta) return
    if (calmo()) { setAcceso(true); setCresci(1); setFermo(true); return }
    let raf = 0
    const t0 = setTimeout(() => setAcceso(true), 60), t2 = setTimeout(() => setFermo(true), 3200)
    // i prismi salgono quando la passata è finita
    const t1 = setTimeout(() => {
      const inizio = performance.now()
      const passo = (t: number) => { const k = Math.min(1, (t - inizio) / 1300); setCresci(1 - Math.pow(1 - k, 3)); if (k < 1) raf = requestAnimationFrame(passo) }
      raf = requestAnimationFrame(passo)
    }, 1500)
    return () => { clearTimeout(t0); clearTimeout(t1); clearTimeout(t2); cancelAnimationFrame(raf) }
  }, [pronta])

  if (!geo) return null
  const { pr, province, lastra, griglia } = geo
  const zero = tinta(0, 1, tema)
  const alto = box.y, basso = box.y + box.h

  // i prismi delle province più servite, dal fondo verso chi guarda (quelle davanti coprono quelle dietro)
  const prismi = vol.primi.map((p, i) => {
    const sigle = ALIAS[p.sigla] || [p.sigla]
    const h = ALTEZZA * Math.sqrt(p.n / vol.max) * cresci
    const forme = sigle.map(s => geo.perSigla.get(s)).filter(Boolean).flatMap((f: any) => f.poli.map((a: XY[]) => geo.pareti(a, 0, h)))
    const c = centro(p.sigla)!, base = pr(c, 0), cima = pr(c, h)
    const xs = sigle.map(s => geo.perSigla.get(s)).filter(Boolean).flatMap((f: any) => f.poli.flat().map((q: XY) => pr(q)[0]))
    const largo = xs.length ? (Math.max(...xs) - Math.min(...xs)) / 2 : 12
    return { ...p, i, forme, base, cima, largo, nome: NOMI_ALIAS[p.sigla] || geo.nomi.get(p.sigla) || p.sigla, colore: tinta(p.n, vol.max, tema) }
  }).sort((a, b) => a.base[1] - b.base[1])

  // gli archi: una parabola sul tavolo, alta in proporzione alla strada che fa
  const arco = (da: XY, a: XY) => {
    const p0 = pr(da), p1 = pr(a), lungo = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / geo.S
    const hm = 30 + Math.min(lungo, 760) * 0.3, pt: string[] = []
    for (let i = 0; i <= 40; i++) {
      const t = i / 40, q = pr([da[0] + (a[0] - da[0]) * t, da[1] + (a[1] - da[1]) * t], hm * 4 * t * (1 - t))
      pt.push(q[0].toFixed(1) + ' ' + q[1].toFixed(1))
    }
    return 'M' + pt.join('L')
  }
  const sedeC = sede ? centro(sede) : null
  const archiSede = sedeC ? vol.primi.filter(p => p.sigla !== sede).slice(0, 6).map(p => ({ k: p.sigla, d: arco(sedeC, centro(p.sigla)!), fine: pr(centro(p.sigla)!) })) : []
  const archiVoli = voli.map(v => { const da = centro(v.da), a = centro(v.a); return da && a && v.da !== v.a ? { ...v, d: arco(da, a), fine: pr(a), inizio: pr(da) } : null }).filter(Boolean) as any[]

  // le etichette dei primi cinque: sopra la cima, spostate in su finché non si toccano
  const posate: Rett[] = []
  const etichette = prismi.slice().sort((a, b) => a.i - b.i).slice(0, 5).map(p => {
    const w = 96, h = 36, tocca = (r: Rett) => posate.some(q => r.x < q.x + q.w + 4 && r.x + r.w + 4 > q.x && r.y < q.y + q.h + 4 && r.y + r.h + 4 > q.y)
    const sx = fin.x + 8 + w / 2, dx = fin.x + fin.w - 8 - w / 2, su = fin.y + h + 8
    // le posizioni da provare: sopra, più su, ai lati, sotto; se si toccano tutte, quella che si tocca meno
    const prove = [[0, 0], [0, -30], [-w * .75, -6], [w * .75, -6], [-w * 1.1, 24], [w * 1.1, 24], [-w * .75, -40], [w * .75, -40], [0, 70], [w * .9, 70], [-w * .9, 70]]
    let x = p.cima[0], y = p.cima[1] - 16, meglio = Infinity
    for (const [ox, oy] of prove) {
      const cx = Math.max(sx, Math.min(dx, p.cima[0] + ox)), cy = Math.max(su, p.cima[1] - 16 + oy), r = { x: cx - w / 2, y: cy - h, w, h }
      const quanto = posate.reduce((a, q) => a + Math.max(0, Math.min(r.x + r.w, q.x + q.w) - Math.max(r.x, q.x) + 4) * Math.max(0, Math.min(r.y + r.h, q.y + q.h) - Math.max(r.y, q.y) + 4), 0)
      if (quanto < meglio) { meglio = quanto; x = cx; y = cy }
      if (!tocca(r)) break
    }
    posate.push({ x: x - w / 2, y: y - h, w, h })
    return { ...p, x, y, filo: Math.hypot(p.cima[0] - x, p.cima[1] - y) }
  })

  // la bussola: dove punta il nord sullo schermo, misurato sulla carta stessa (l'Italia è girata sul tavolo)
  const n0 = pr([12.5, 41.5]), n1 = pr([12.5, 42.5]), nord = Math.atan2(n1[0] - n0[0], n0[1] - n1[1]) * 180 / Math.PI
  const bx = fin.x + fin.w - 30, by = fin.y + 32
  const cerchi = sedeC ? [100, 250, 500].map(km => ({ km, d: geo.path(geoCircle().center(sedeC).radius(km / 111.2).precision(4)() as any) || '', p: pr([sedeC[0], sedeC[1] - km / 111.2]) })) : []

  return (
    <div className={'pa-mappa' + (acceso ? ' pa-mappa--accesa' : '')} aria-hidden="true">
      <svg className="pa-mappa__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        <defs>
          <radialGradient id="pa-sfuma" cx="50%" cy="50%" r="60%">
            <stop offset="0" stopColor="#fff" stopOpacity="1" /><stop offset=".55" stopColor="#fff" stopOpacity=".55" /><stop offset="1" stopColor="#fff" stopOpacity="0" />
          </radialGradient>
          <mask id="pa-maschera-griglia"><rect x="0" y="0" width={W} height={H} fill="url(#pa-sfuma)" /></mask>
          <filter id="pa-ombra" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="14" /></filter>
          <filter id="pa-brace" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" result="b" /><feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
          <linearGradient id="pa-lucido" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".55" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <linearGradient id="pa-raggio" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--gx-accento)" stopOpacity="0" /><stop offset=".85" stopColor="var(--gx-accento)" stopOpacity=".22" /><stop offset="1" stopColor="var(--gx-accento)" stopOpacity=".9" /></linearGradient>
          <clipPath id="pa-terra">{lastra.map((l, i) => <path key={i} d={l.cima} />)}</clipPath>
        </defs>

        <path className="pa-griglia" d={griglia} mask="url(#pa-maschera-griglia)" />

        {/* l'ombra sul pavimento: la luce viene da sinistra in alto */}
        <g className="pa-ombra" filter="url(#pa-ombra)" transform="translate(16 20)">{lastra.map((l, i) => <path key={i} d={l.cima} />)}</g>

        {/* i cerchi della distanza attorno alla sede (100, 250, 500 km: cerchi veri sulla sfera) */}
        {cerchi.map(c => <path key={c.km} className="pa-raggio-km" d={c.d} />)}

        {/* la lastra: pareti e cima */}
        <g className="pa-lastra">
          {lastra.map((l, i) => <g key={i}><path className="pa-parete pa-parete--luce" d={l.luce} /><path className="pa-parete" d={l.ombra} /></g>)}
          {lastra.map((l, i) => <path key={'c' + i} className="pa-cima" d={l.cima} />)}
        </g>

        {/* le province a terra: si accendono quando passa la luce, dall'alto in basso */}
        <g className="pa-province">
          {province.map((f: any, i: number) => {
            const n = vol.m.get(f.sigla) || 0
            const ritardo = Math.max(0, Math.min(1, (f.p[1] - alto) / Math.max(1, basso - alto))) * 1.5
            return <path key={i} d={f.d} style={{ fill: acceso ? tinta(n, vol.max, tema) : zero, transitionDelay: fermo ? '0s' : ritardo.toFixed(2) + 's' }}><title>{`${NOMI_ALIAS[f.sigla] || f.nome}: ${n ? fmtN.format(n) + ' spedizioni' : 'nessuna spedizione'}`}</title></path>
          })}
        </g>
        <rect className="pa-lucido" x="0" y="0" width={W} height={H} fill="url(#pa-lucido)" clipPath="url(#pa-terra)" />
      </svg>

      {/* GLI STRATI: la carta ferma sta in un disegno suo; quello che si muove sempre (anelli, comete) sta in disegni
          a parte, su livelli loro: così ogni fotogramma ridisegna pochi cerchi e non 110 province con l'ombra sfocata */}
      <svg className="pa-mappa__svg pa-mappa__svg--vivo" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>

        {/* la passata di luce che accende la carta */}
        {acceso && !fermo && !calmo() && <g className="pa-passata" style={{ ['--da' as any]: (alto - 30) + 'px', ['--a' as any]: (basso + 10) + 'px' }}>
          <rect x={box.x - 60} y={-40} width={box.w + 120} height={40} fill="url(#pa-raggio)" />
          <rect x={box.x - 60} y={-1.5} width={box.w + 120} height={1.5} className="pa-passata__filo" />
        </g>}

        {/* gli anelli che pulsano attorno alle più servite */}
        {cresci > 0.02 && prismi.filter(p => p.i < 5).map(p => {
          const rx = Math.max(10, p.largo * .9), ry = rx * Math.cos(INCLINA)
          return <g key={'a' + p.sigla} className="pa-onde">{[0, 1, 2].map(k => <ellipse key={k} cx={p.base[0].toFixed(1)} cy={p.base[1].toFixed(1)} rx={rx.toFixed(1)} ry={ry.toFixed(1)} style={{ animationDelay: (k * 1.1 + p.i * 0.3).toFixed(2) + 's' }} />)}</g>
        })}

      </svg>

      <svg className="pa-mappa__svg" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* i prismi */}
        <g className={'pa-prismi' + (tema === 'notte' ? ' pa-prismi--notte' : '')}>
          {prismi.map(p => (
            <g key={p.sigla}>
              {p.forme.map((f: any, k: number) => <g key={k}><path d={f.luce} style={{ fill: scurisci(p.colore, tema === 'notte' ? .45 : .08) }} /><path d={f.ombra} style={{ fill: scurisci(p.colore, tema === 'notte' ? .62 : .2) }} /></g>)}
              {p.forme.map((f: any, k: number) => <path key={'t' + k} d={f.cima} style={{ fill: p.colore }} className="pa-prisma__cima" filter={tema === 'notte' && p.i < 3 ? 'url(#pa-brace)' : undefined} />)}
            </g>
          ))}
        </g>

      </svg>

      <svg className="pa-mappa__svg pa-mappa__svg--vivo" width={W} height={H} viewBox={`0 0 ${W} ${H}`}>
        {/* gli archi dalla sede alle destinazioni principali */}
        {archiSede.map((a, i) => (
          <g key={a.k} className="pa-arco pa-arco--sede" style={{ ['--r' as any]: (2.2 + i * 0.18).toFixed(2) + 's' }}>
            <path d={a.d} className="pa-arco__scia" pathLength={1} />
            <path d={a.d} className="pa-arco__luce" pathLength={1} />
            <circle cx={a.fine[0]} cy={a.fine[1]} r="2.6" className="pa-arco__arrivo" />
          </g>
        ))}
        {/* gli archi delle ultime spedizioni: dal mittente al destinatario, la più nuova accesa */}
        {archiVoli.map(a => (
          <g key={a.id} className={'pa-arco' + (a.nuovo ? ' pa-arco--nuovo' : '')}>
            <path d={a.d} className="pa-arco__scia" pathLength={1} />
            {a.nuovo && <path d={a.d} className="pa-arco__luce" pathLength={1} />}
            <circle cx={a.inizio[0]} cy={a.inizio[1]} r="2" className="pa-arco__partenza" />
            <circle cx={a.fine[0]} cy={a.fine[1]} r="2.6" className="pa-arco__arrivo" />
          </g>
        ))}

        {sedeC && (() => { const s = pr(sedeC); return (
          <g className="pa-sede"><circle cx={s[0]} cy={s[1]} r="5" /><path d={`M${s[0]} ${s[1] - 9}L${s[0] + 9} ${s[1]}L${s[0]} ${s[1] + 9}L${s[0] - 9} ${s[1]}Z`} /></g>
        ) })()}

        <g className="pa-bussola" transform={`translate(${bx} ${by})`}>
          <circle r="17" /><circle r="12.5" className="pa-bussola__dentro" />
          <g transform={`rotate(${nord.toFixed(1)})`}><path d="M0 -15L3.2 0L0 2.5L-3.2 0Z" className="pa-bussola__ago" /><path d="M0 15L3.2 0L0 -2.5L-3.2 0Z" /></g>
          <text y="-22" textAnchor="middle">N</text>
        </g>

        {/* il filo che lega ogni etichetta alla cima del suo prisma */}
        {cresci > 0.6 && etichette.map(e => e.filo > 4 ? <line key={'f' + e.sigla} className="pa-filo" x1={e.cima[0]} y1={e.cima[1]} x2={e.x} y2={e.y} /> : null)}
      </svg>

      {/* le etichette in HTML, nitide sopra la carta: la sigla, il volume e la quota */}
      <div className="pa-etichette">
        {archiVoli.filter(a => a.nuovo).map(a => <span key={'v' + a.id} className="pa-volo"><i style={{ left: a.inizio[0], top: a.inizio[1] }}>{a.da}</i><i style={{ left: a.fine[0], top: a.fine[1] }}>{a.a}</i></span>)}
        {cresci > 0.6 && etichette.map(e => (
          <span key={e.sigla} className="pa-etichetta" style={{ left: e.x, top: e.y }}>
            <b>{e.sigla}</b><i>{fmtN.format(e.n)}</i><small>{e.nome}</small>
          </span>
        ))}
        {sedeC && (() => { const s = pr(sedeC); return (
          <span className="pa-etichetta pa-etichetta--sede" style={{ left: s[0], top: s[1] + 44 }}><b>Sede</b><small>{gradi(sedeC[1], 'N', 'S')} {gradi(sedeC[0], 'E', 'O')}</small></span>
        ) })()}
        {cerchi.map(c => <span key={'k' + c.km} className="pa-km" style={{ left: c.p[0], top: c.p[1] }}>{c.km} km</span>)}
      </div>
    </div>
  )
})
