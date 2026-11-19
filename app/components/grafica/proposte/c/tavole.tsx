'use client'
// LE TAVOLE della Proposta C «Rivista» (27/10): i grafici che prendono il posto della foto nel pannello appiccicoso,
// come le tavole illustrate di una rivista. Inchiostro su carta, un solo accento (il mese in corso, l'ora di adesso,
// la provincia accesa); le texture a puntini e a righe vengono dal metodo di sogaso che Lorenzo ha scelto.
// Ogni numero arriva già dalle rotte: qui si disegna e basta. Dove il dato non c'è, la tavola lo dice.
import { useEffect, useMemo, useRef, useState } from 'react'
import { geoGraticule, geoMercator, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { fmtN, MESI } from '../../PlanciaNuova'

const n = (x: number) => fmtN.format(Math.round(x))
const euro = (v: number) => (v < -0.004 ? '−€ ' : '€ ') + fmtN.format(Math.round(Math.abs(v)))

function Testa({ occhiello, titolo, destra }: { occhiello: string; titolo: React.ReactNode; destra?: React.ReactNode }) {
  return (
    <header className="rv-tav__testa">
      <div><span className="rv-tav__occhiello">{occhiello}</span><b className="rv-tav__titolo">{titolo}</b></div>
      {destra && <div className="rv-tav__destra">{destra}</div>}
    </header>
  )
}

// ── La giornata: un orario, un'ora per riga (la tavola è verticale: le ore scendono come in un orario dei treni).
// Puntini = già in distinta, righe arancio = ancora fuori. L'ora di adesso è accesa, quelle che verranno sono vuote ──
export function Orario({ g, ora }: { g: any; ora: number | null }) {
  if (!g?.ore) return <div className="rv-tav"><Testa occhiello="Ora per ora" titolo="Le spedizioni create oggi" /><p className="rv-tav__vuoto">{g === null ? '…' : 'Il dato della giornata non è arrivato.'}</p></div>
  const tutte = g.ore as { ora: number; create: number; fuoriDistinta: number }[]
  const piene = tutte.filter(o => o.create > 0).map(o => o.ora)
  // dalle 7 alle 20, allargato se qualcuno ha creato spedizioni prima o dopo
  const da = Math.min(7, ...piene), a = Math.max(20, ...piene, ora ?? 0)
  const ore = tutte.filter(o => o.ora >= da && o.ora <= a)
  const max = Math.max(1, ...ore.map(o => o.create))
  return (
    <div className="rv-tav">
      <Testa occhiello="Ora per ora" titolo="Le spedizioni create oggi" destra={<><b>{n(g.create)}</b><span>in tutto</span></>} />
      <ol className="rv-orario" role="img" aria-label={'Create oggi ora per ora: ' + ore.filter(o => o.create).map(o => `alle ${o.ora} ${o.create}`).join(', ')}>
        {ore.map((o, k) => {
          const dentro = Math.max(0, o.create - o.fuoriDistinta), futura = ora !== null && o.ora > ora, adesso = ora === o.ora
          return (
            <li key={o.ora} className={((futura ? 'rv-orario--dopo' : '') + (adesso ? ' rv-orario--ora' : '')).trim() || undefined} style={{ ['--k' as any]: k }}>
              <span className="rv-orario__h">{String(o.ora).padStart(2, '0')}</span>
              <span className="rv-orario__binario">
                <span className="rv-orario__barra" style={{ width: (o.create / max * 100) + '%' }}>
                  {dentro > 0 && <i className="rv-trama-punti" style={{ flex: dentro }} />}
                  {o.fuoriDistinta > 0 && <i className="rv-trama-righe" style={{ flex: o.fuoriDistinta }} />}
                </span>
              </span>
              <b className="rv-orario__n">{o.create ? n(o.create) : ''}</b>
              {adesso && <em className="rv-orario__adesso">adesso</em>}
            </li>
          )
        })}
      </ol>
      <footer className="rv-tav__piede">
        <span><i className="rv-trama-punti" />già in distinta</span>
        <span><i className="rv-trama-righe" />ancora fuori distinta · {n(g.fuoriDistinta)}</span>
      </footer>
    </div>
  )
}

// statsMensili porta il mese all'inglese («Jul 26», dalla funzione del database)
const INGLESE: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
export const meseDi = (m: any) => { const i = INGLESE[String(m || '').trim().slice(0, 3).toLowerCase()]; return i === undefined ? String(m || '') : MESI[i] }

// ── Il mese: le colonne degli ultimi mesi, alte come le spedizioni. Il mese in corso è l'unica arancio ──
export function Mesi({ mesi }: { mesi: any[] | null }) {
  const ultimi = (mesi || []).slice(-6)
  if (!ultimi.length) return <div className="rv-tav"><Testa occhiello="I mesi" titolo="Spedizioni per mese" /><p className="rv-tav__vuoto">{mesi === null ? '…' : 'Ancora nessun mese da mostrare.'}</p></div>
  const max = Math.max(1, ...ultimi.map(m => Number(m.totale || 0)))
  return (
    <div className="rv-tav">
      <Testa occhiello="I mesi" titolo="Spedizioni per mese" destra={<><b>{ultimi.length}</b><span>{ultimi.length === 1 ? 'mese' : 'mesi'}</span></>} />
      <div className="rv-mesi" role="img" aria-label={'Spedizioni per mese: ' + ultimi.map(m => `${meseDi(m.mese)} ${m.totale}`).join(', ')}>
        {ultimi.map((m, i) => {
          const ora = i === ultimi.length - 1, v = Number(m.totale || 0)
          return (
            <div key={i} className={'rv-mesi__col' + (ora ? ' rv-mesi__col--ora' : '')} style={{ ['--h' as any]: (v / max).toFixed(4), ['--k' as any]: i }}>
              <b className="rv-mesi__n">{n(v)}</b>
              <span className="rv-mesi__barra"><i className={ora ? 'rv-trama-piena' : 'rv-trama-punti'} /></span>
              <span className="rv-mesi__nome">{meseDi(m.mese).slice(0, 3)}</span>
              <em className="rv-mesi__euro">{euro(Number(m.importo || 0))}</em>
            </div>
          )
        })}
      </div>
      <footer className="rv-tav__piede"><span><i className="rv-trama-punti" />mesi chiusi</span><span><i className="rv-trama-piena" />il mese in corso, fino a oggi</span><span>sotto: il fatturato del mese</span></footer>
    </div>
  )
}

// ── I soldi: il guadagno delle spedizioni nel periodo scelto, giorno per giorno ──
export function Margine({ sped, periodo }: { sped: any; periodo: string }) {
  const serie: any[] = sped?.serie || []
  const testa = (
    <Testa occhiello="Guadagno spedizioni" titolo={sped ? <span className={Number(sped.guadagno) < 0 ? 'rv-meno' : undefined}>{euro(Number(sped.guadagno || 0))}</span> : '…'}
      destra={sped ? <><b>{n(sped.numSpedizioni || 0)}</b><span>spedizioni · € {String((Math.round(Number(sped.mediaSped || 0) * 100) / 100).toFixed(2)).replace('.', ',')} l&apos;una</span></> : undefined} />
  )
  if (!sped) return <div className="rv-tav">{testa}<p className="rv-tav__vuoto">…</p></div>
  const righe = <p className="rv-tav__sotto">Fatturato <b>{euro(Number(sped.ricavi || 0))}</b> · costi <b>{euro(Number(sped.costi || 0))}</b> · {periodo}</p>
  if (serie.length < 2) return <div className="rv-tav">{testa}{righe}<p className="rv-tav__vuoto">{serie.length ? 'Un giorno solo: il disegno giorno per giorno si vede scegliendo la settimana o il mese.' : 'Nessuna spedizione nel periodo.'}</p></div>
  return (
    <div className="rv-tav">
      {testa}{righe}
      <Barre serie={serie} />
      <footer className="rv-tav__piede"><span><i className="rv-trama-punti" />un giorno</span><span><i className="rv-trama-piena" />l&apos;ultimo giorno</span><span>più chiari: sabati e domeniche</span></footer>
    </div>
  )
}

// le barre si disegnano sulla misura vera della tavola (alta e stretta di giorno sul portatile, più larga sul
// monitor): con una misura fissa restava un vuoto sopra il grafico
function Barre({ serie }: { serie: any[] }) {
  const area = useRef<HTMLDivElement>(null)
  const [m, setM] = useState<{ w: number; h: number } | null>(null)
  useEffect(() => {
    const el = area.current; if (!el) return
    const ro = new ResizeObserver(() => setM({ w: el.clientWidth, h: el.clientHeight })); ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const et = (g: string) => g.length === 7 ? MESI[+g.slice(5, 7) - 1].slice(0, 3) : `${+g.slice(8, 10)} ${MESI[+g.slice(5, 7) - 1].slice(0, 3)}`
  const festa = (g: string) => { if (g.length !== 10) return false; const d = new Date(g + 'T12:00:00'); return d.getDay() === 0 || d.getDay() === 6 }
  const disegno = (() => {
    if (!m || m.w < 40 || m.h < 40) return null
    const W = m.w, H = m.h, l = 52, top = 14, b = 24
    const vals = serie.map(s => Number(s.margine || 0)), max = Math.max(1, ...vals), min = Math.min(0, ...vals)
    const passi = [5, 10, 20, 25, 50, 100, 150, 200, 250, 500, 1000, 2000, 2500, 5000, 10000], tacca = passi.find(x => (max - min) / x <= 4) || 20000
    const cima = Math.ceil(max / tacca) * tacca, fondo = Math.floor(min / tacca) * tacca
    const Y = (y: number) => top + (1 - (y - fondo) / (cima - fondo)) * (H - top - b)
    const w = (W - l) / serie.length, ogni = Math.max(1, Math.ceil(serie.length / Math.max(3, Math.floor((W - l) / 70))))
    const tacche: number[] = []; for (let y = fondo; y <= cima + 0.001; y += tacca) tacche.push(y)
    return { W, H, l, Y, w, ogni, tacche }
  })()
  return (
    <div className="rv-tav__area" ref={area}>
      {disegno && (
        <svg viewBox={`0 0 ${disegno.W} ${disegno.H}`} role="img" aria-label={'Guadagno delle spedizioni giorno per giorno: ' + serie.map(s => `${et(s.giorno)} ${euro(Number(s.margine || 0))}`).join('; ')}>
          <defs>
            <pattern id="rv-mp" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.2" fill="var(--gx-inchiostro)" /></pattern>
          </defs>
          {disegno.tacche.map(y => <g key={y}><line x1={disegno.l} x2={disegno.W} y1={disegno.Y(y)} y2={disegno.Y(y)} className={y === 0 ? 'rv-asse' : 'rv-filo'} /><text x={disegno.l - 10} y={disegno.Y(y) + 4} textAnchor="end" className="rv-tav__et">{euro(y)}</text></g>)}
          {serie.map((s, i) => {
            const v = Number(s.margine || 0), bw = Math.max(2, Math.min(disegno.w * .64, 34)), x = disegno.l + i * disegno.w + (disegno.w - bw) / 2, ultimo = i === serie.length - 1
            const y0 = disegno.Y(Math.max(0, v)), y1 = disegno.Y(Math.min(0, v))
            return <rect key={s.giorno} className="rv-cresce" style={{ ['--k' as any]: i }} x={x} y={y0} width={bw} height={Math.max(1, y1 - y0)} rx="2.5"
              fill={v < 0 ? 'var(--gx-problema)' : ultimo ? 'var(--gx-accento)' : 'url(#rv-mp)'} opacity={festa(s.giorno) ? .4 : 1}><title>{et(s.giorno)}: {euro(v)}</title></rect>
          })}
          {serie.map((s, i) => serie.length <= 8 || (i % disegno.ogni === 0 && serie.length - 1 - i >= Math.max(2, disegno.ogni * .8)) || i === serie.length - 1
            ? <text key={'t' + s.giorno} x={disegno.l + i * disegno.w + disegno.w / 2} y={disegno.H - 4} textAnchor="middle" className="rv-tav__et">{et(s.giorno)}</text> : null)}
        </svg>
      )}
    </div>
  )
}

// ── Dove: l'atlante. Le province in scala d'inchiostro (più scure dove arrivano più spedizioni; di notte più chiare,
// come una carta illuminata), la prima e quella indicata nell'indice in arancio. Reticolo, gradi, scala e nord: la
// pagina di un atlante, non un widget ──
const W_A = 460, H_A = 560
function tinta(t: number, notte: boolean) {
  // da carta a inchiostro (giorno) o da ardesia a luce (notte), con la radice: le province piccole non spariscono
  const a = notte ? [44, 55, 76] : [221, 226, 234], b = notte ? [226, 232, 242] : [22, 28, 38]
  const k = Math.pow(t, 0.8)
  return `rgb(${a.map((x, i) => Math.round(x + (b[i] - x) * k)).join(',')})`
}
export function Atlante({ topo, dest, sopra, notte, nomi }: { topo: any; dest: any; sopra: string | null; notte: boolean; nomi: Map<string, string> }) {
  const disegno = useMemo(() => {
    if (!topo?.objects) return null
    try {
      const fc: any = feature(topo, topo.objects[Object.keys(topo.objects)[0]])
      const pr = geoMercator().fitExtent([[26, 18], [W_A - 18, H_A - 30]], fc), path = geoPath(pr)
      const reticolo = path(geoGraticule().step([2, 2]).extent([[4, 34], [22, 50]])()) || ''
      const meridiani = [8, 10, 12, 14, 16, 18].map(lon => ({ lon, p: pr([lon, 36.4]) })).filter(x => x.p && x.p[0] > 30 && x.p[0] < W_A - 10)
      const paralleli = [38, 40, 42, 44, 46].map(lat => ({ lat, p: pr([6.9, lat]) })).filter(x => x.p && x.p[1] > 20 && x.p[1] < H_A - 30)
      // 100 km a 42° di latitudine, nella stessa proiezione
      const a = pr([9, 37.2]), b = pr([9 + 100 / (111.32 * Math.cos(37.2 * Math.PI / 180)), 37.2])
      return {
        forme: fc.features.map((f: any) => ({ d: path(f) || '', sigla: String(f.properties?.prov_acr || '').toUpperCase(), c: path.centroid(f) })),
        reticolo, meridiani, paralleli, km: a && b ? b[0] - a[0] : 0, scala: a,
      }
    } catch { return null }
  }, [topo])
  const per = useMemo(() => { const m = new Map<string, number>(); for (const p of (dest?.province || [])) m.set(String(p.sigla).toUpperCase(), Number(p.n || 0)); return m }, [dest])
  const max = Math.max(1, ...per.values())
  const prima = (dest?.province || []).slice().sort((x: any, y: any) => y.n - x.n)[0]?.sigla
  const acceso = sopra || prima
  const fAcceso = acceso && disegno?.forme.find((f: any) => f.sigla === acceso)
  if (!disegno) return <div className="rv-tav"><Testa occhiello="Atlante" titolo="Dove arrivano le spedizioni" /><p className="rv-tav__vuoto">{topo === null ? '…' : 'La carta non si è caricata.'}</p></div>
  return (
    <div className="rv-tav rv-tav--atlante">
      <Testa occhiello={`Atlante · ultimi ${dest?.giorni || 30} giorni`} titolo="Dove arrivano le spedizioni" destra={dest ? <><b>{n(dest.totale || 0)}</b><span>in Italia</span></> : undefined} />
      <svg className="rv-tav__grafico rv-atlante" viewBox={`0 0 ${W_A} ${H_A}`} preserveAspectRatio="xMidYMid meet" role="img"
        aria-label={'Spedizioni per provincia: ' + (dest?.province || []).slice(0, 10).map((p: any) => `${nomi.get(p.sigla) || p.sigla} ${p.n}`).join(', ')}>
        <path d={disegno.reticolo} className="rv-atlante__reticolo" />
        {disegno.meridiani.map(m => <text key={'m' + m.lon} x={m.p![0]} y={H_A - 8} textAnchor="middle" className="rv-atlante__grado">{m.lon}°E</text>)}
        {disegno.paralleli.map(p => <text key={'p' + p.lat} x={6} y={p.p![1] + 3} className="rv-atlante__grado">{p.lat}°N</text>)}
        <g className="rv-atlante__province">
          {disegno.forme.map((f: any, i: number) => {
            const v = per.get(f.sigla) || 0, su = f.sigla === acceso
            return <path key={i} d={f.d} fill={su ? 'var(--gx-accento)' : v ? tinta(Math.sqrt(v) / Math.sqrt(max), notte) : 'var(--rv-mappa-vuota)'}
              style={{ ['--y' as any]: (f.c[1] / H_A).toFixed(3) }}><title>{(nomi.get(f.sigla) || f.sigla) + ': ' + (v ? n(v) + ' spedizioni' : 'nessuna spedizione')}</title></path>
          })}
        </g>
        {fAcceso && (() => {
          const [x, y] = fAcceso.c, v = per.get(acceso!) || 0, sx = x > W_A * .58 ? -1 : 1
          return (
            <g className="rv-atlante__nota" key={acceso!}>
              <circle cx={x} cy={y} r="3.2" />
              <line x1={x} y1={y} x2={x + sx * 46} y2={y - 34} />
              <text x={x + sx * 50} y={y - 44} textAnchor={sx > 0 ? 'start' : 'end'} className="rv-atlante__nome">{nomi.get(acceso!) || acceso}</text>
              <text x={x + sx * 50} y={y - 30} textAnchor={sx > 0 ? 'start' : 'end'} className="rv-atlante__val">{v ? n(v) + ' spedizioni' : 'nessuna spedizione'}</text>
            </g>
          )
        })()}
        {disegno.scala && disegno.km > 0 && (
          <g className="rv-atlante__scala" transform={`translate(${W_A - 74 - disegno.km} ${H_A - 58})`}>
            <rect width={disegno.km / 2} height="4" /><rect x={disegno.km / 2} width={disegno.km / 2} height="4" className="rv-vuoto" />
            <text x={disegno.km + 8} y="5">100 km</text>
          </g>
        )}
        <g className="rv-atlante__nord" transform={`translate(${W_A - 34} 74)`}><path d="M0 -16 L6 6 L0 2 L-6 6 Z" /><text y="22" textAnchor="middle">N</text></g>
      </svg>
      <footer className="rv-tav__piede rv-tav__piede--scala">
        <span>poche</span><i className="rv-atlante__sfumatura" style={{ background: `linear-gradient(90deg, ${[0.05, 0.3, 0.6, 1].map(t => tinta(t, notte)).join(',')})` }} /><span>molte spedizioni</span>
        <span className="rv-atlante__acceso"><i />in arancio: {sopra ? 'la provincia indicata' : 'la prima'}</span>
      </footer>
    </div>
  )
}
