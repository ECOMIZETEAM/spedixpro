'use client'
// I SOLDI COME FLUSSO (proposta B): da dove entrano (le voci del Report Guadagno), quanto si incassa, quanto se ne va
// in costi e quanto resta di margine. Un periodo solo (Oggi, Questa settimana, Questo mese, Mese scorso) per tutti i
// riquadri della sezione; i saldi aperti sotto non cambiano col periodo (sono «adesso»).
// Le voci sono le stesse rotte del Report Guadagno di oggi; il totale è /api/reports/guadagno-totale. Quello che il
// totale ha in più delle voci (commissioni, accessori) diventa «Altre voci»; se le voci sommano un filo più del totale
// (rimborsi, arrotondamenti) i nastri si proporzionano sul totale, i numeri scritti restano quelli veri.
// Costi di gestione e utile netto compaiono solo se la rotta li restituisce (li vedono il master e i suoi admin).
import { useEffect, useMemo, useRef, useState } from 'react'
import { Icona } from '../../icone'
import { Conta } from '../../movimento'
import { Euro, euroPiano, fmtN, iso, MESI, usaJson } from '../../PlanciaNuova'
import { corsia, nastro, useLarghezza, useParticelle, usePartenza, type Stazione, type Tinte } from './particelle'
import { Testa, virgola } from './comuni'

type Periodo = { nome: string; da: Date; a: Date; titolo: string }
const giornoPiu = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function periodo(nome: string): Periodo {
  const oggi = new Date(), lun = giornoPiu(oggi, -((oggi.getDay() + 6) % 7))
  if (nome === 'oggi') return { nome, da: oggi, a: oggi, titolo: 'oggi' }
  if (nome === 'settimana') return { nome, da: lun, a: oggi, titolo: 'questa settimana' }
  if (nome === 'scorso') { const d = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); return { nome, da: d, a: new Date(oggi.getFullYear(), oggi.getMonth(), 0), titolo: MESI[d.getMonth()] } }
  return { nome: 'mese', da: new Date(oggi.getFullYear(), oggi.getMonth(), 1), a: oggi, titolo: MESI[oggi.getMonth()] + ', fino a oggi' }
}
const SCELTE: [string, string][] = [['oggi', 'Oggi'], ['settimana', 'Questa settimana'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso']]
const VOCI = [
  { k: 'rettifiche', nome: 'Rettifiche', url: '/api/reports/guadagno-rettifiche', href: '/dashboard/reports/rettifiche' },
  { k: 'resi', nome: 'Resi', url: '/api/reports/guadagno-resi', href: '/dashboard/reports/resi' },
  { k: 'giacenze', nome: 'Giacenze', url: '/api/reports/guadagno-giacenze', href: '/dashboard/reports/giacenze' },
  { k: 'logistica', nome: 'Logistica', url: '/api/reports/guadagno-logistica', href: '/dashboard/logistica/addebiti' },
  { k: 'consumabili', nome: 'Consumabili', url: '/api/reports/guadagno-consumabili', href: '/dashboard/reports/consumabili' },
]

export default function Soldi({ data, tinte }: { data: any; tinte: Tinte | null }) {
  // il periodo si calcola dopo l'apertura: «oggi» del server (UTC) e del browser possono essere giorni diversi
  const [p, setP] = useState<Periodo | null>(null)
  useEffect(() => { setP(periodo('mese')) }, [])
  const q = p ? `?dal=${iso(p.da)}&al=${iso(p.a)}` : null
  const su = (u: string) => (q ? u + q : null)
  const tot = usaJson<any>(su('/api/reports/guadagno-totale'))
  const sped = usaJson<any>(su('/api/reports/guadagno'))
  const v0 = usaJson<any>(su(VOCI[0].url)), v1 = usaJson<any>(su(VOCI[1].url)), v2 = usaJson<any>(su(VOCI[2].url)), v3 = usaJson<any>(su(VOCI[3].url)), v4 = usaJson<any>(su(VOCI[4].url))
  const gest = usaJson<any>(tot?.costiGestione !== undefined ? su('/api/costi-gestione') : null)
  const voci = [v0, v1, v2, v3, v4]
  const margine = tot?.ricavi ? Number(tot.guadagno) / Number(tot.ricavi) * 100 : 0

  return (
    <section className="pb-sez" aria-labelledby="pb-t-soldi">
      <Testa id="pb-t-soldi" occhiello="I soldi" titolo={<>Quello che entra, quello che esce, <b>quello che resta</b></>}
        frase={tot ? <>Incassato {euroPiano(Number(tot.ricavi || 0))}, costi {euroPiano(Number(tot.costi || 0))}: il margine è del {virgola(margine)}%{p ? ` · ${p.titolo}` : ''}.</> : '…'} />
      <div className="pb-periodo gx-vetro gx-pillola" role="group" aria-label="Periodo di tutti i riquadri dei soldi">
        {SCELTE.map(([n, t]) => <button key={n} type="button" aria-pressed={p?.nome === n} onClick={() => setP(periodo(n))}>{t}</button>)}
      </div>

      <div className="pb-lastra gx-vetro pb-soldi">
        <Cascata tot={tot} sped={sped} voci={voci} gest={gest} tinte={tinte} chiave={q || ''} />
      </div>

      <div className="pb-soldi-sotto">
        <div className="pb-scheda gx-vetro pb-serie">
          <div className="pb-scheda__testa"><h3>Guadagno spedizioni</h3><a href="/dashboard/statistiche/profitto">Report guadagno<Icona id="i-chevron" /></a></div>
          <div className="pb-serie__numeri">
            <div><span>Margine</span><b className={Number(sped?.guadagno) < 0 ? 'pb-meno' : undefined}>{sped ? <Conta v={Number(sped.guadagno || 0)}>{n => <Euro v={n} />}</Conta> : '…'}</b></div>
            <div><span>Fatturato</span><b>{sped ? euroPiano(Number(sped.ricavi || 0)) : '…'}</b></div>
            <div><span>Costi</span><b>{sped ? euroPiano(Number(sped.costi || 0)) : '…'}</b></div>
            <div><span>A spedizione</span><b>{sped ? euroPiano(Number(sped.mediaSped || 0)) : '…'}</b><em>{sped ? fmtN.format(Number(sped.numSpedizioni || 0)) + ' spedizioni' : ''}</em></div>
          </div>
          {sped ? <Serie serie={Array.isArray(sped.serie) ? sped.serie : []} /> : <div className="pb-vuoto">…</div>}
        </div>
        <div className="pb-scheda gx-vetro pb-saldi">
          <div className="pb-scheda__testa"><h3>I saldi aperti</h3><span>adesso, non cambiano col periodo</span></div>
          <ul>
            <li><span>Da recuperare a scalare<em>{fmtN.format(Number(data?.creditiDaRecuperare?.scalare?.clienti || 0))} clienti bloccati finché non ricaricano</em></span><b className={Number(data?.creditiDaRecuperare?.scalare?.totale) > 0 ? 'pb-meno' : undefined}>{data ? <Euro v={Number(data?.creditiDaRecuperare?.scalare?.totale || 0)} /> : '…'}</b></li>
            <li><span>Da recuperare a fattura<em>{fmtN.format(Number(data?.creditiDaRecuperare?.fattura?.clienti || 0))} clienti, spediscono normalmente</em></span><b>{data ? <Euro v={Number(data?.creditiDaRecuperare?.fattura?.totale || 0)} /> : '…'}</b></li>
            <li><span>Contrassegni da rimettere<em>ai tuoi clienti · <a href="/dashboard/contrassegni">Contrassegni</a></em></span><b>{data ? <Euro v={Number(data?.codDaRimettere || 0)} /> : '…'}</b></li>
            <li><span>Conto proprio<em>i tuoi contratti · <a href="/dashboard/movimenti">Movimenti</a></em></span><b className={Number(data?.creditoMaster?.proprio) < 0 ? 'pb-meno' : undefined}>{data ? <Euro v={Number(data?.creditoMaster?.proprio || 0)} /> : '…'}</b></li>
          </ul>
        </div>
      </div>
    </section>
  )
}

// ── la cascata a nastri: le voci → l'incassato → i costi e il guadagno ──
type Fonte = { k: string; nome: string; href: string; r: number; g: number; c: number }
function Cascata({ tot, sped, voci, gest, tinte, chiave }: { tot: any; sped: any; voci: any[]; gest: any; tinte: Tinte | null; chiave: string }) {
  const box = useRef<HTMLDivElement>(null), tela = useRef<HTMLCanvasElement>(null)
  const misura = useLarghezza(box), W = misura ? Math.max(misura, 760) : 0
  const pronto = !!tot && !!sped && voci.every(Boolean)
  const fonti: Fonte[] = useMemo(() => {
    if (!pronto) return []
    const f: Fonte[] = [
      { k: 'spedizioni', nome: 'Spedizioni', href: '/dashboard/statistiche/profitto', r: Number(sped.ricavi || 0), g: Number(sped.guadagno || 0), c: Number(sped.costi || 0), },
      ...VOCI.map((v, i) => ({ k: v.k, nome: v.nome, href: v.href, r: Number(voci[i]?.ricavi || 0), g: Number(voci[i]?.guadagno || 0), c: Number(voci[i]?.costi || 0) })),
    ]
    const R = Number(tot.ricavi || 0), resto = R - f.reduce((a, x) => a + x.r, 0)
    if (resto > Math.max(0.5, R * 0.002)) f.push({ k: 'altre', nome: 'Altre voci', href: '/dashboard/statistiche/profitto', r: resto, g: Number(tot.guadagno || 0) - f.reduce((a, x) => a + x.g, 0), c: Number(tot.costi || 0) - f.reduce((a, x) => a + x.c, 0) })
    return f
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pronto, chiave, tot, sped, ...voci])

  const G = useMemo(() => {
    if (!pronto || W < 500) return null
    const R = Math.max(0, Number(tot.ricavi || 0)), Gd = Number(tot.guadagno || 0), Cs = Math.max(0, Number(tot.costi || 0))
    if (R <= 0) return { vuoto: true as const }
    const H = 460, sopra = 34, sotto = 16, gap = 10, MIN = 52
    const LW = Math.min(300, Math.max(240, W * 0.25)), RW = Math.min(300, Math.max(240, W * 0.25))
    const xL = LW, xM = LW + (W - LW - RW) * 0.5, xR = W - RW
    const somma = fonti.reduce((a, x) => a + Math.max(0, x.r), 0) || 1
    // la scala: le voci grandi prendono lo spazio che resta dopo le righe minime di quelle piccole
    const libero = H - sopra - sotto - gap * (fonti.length - 1)
    let s = libero / R
    for (let i = 0; i < 4; i++) {
      const piccole = fonti.filter(f => Math.max(0, f.r) / somma * R * s < MIN)
      const grandi = fonti.filter(f => !piccole.includes(f)).reduce((a, f) => a + Math.max(0, f.r) / somma * R, 0)
      s = grandi > 0 ? Math.max(0.0001, (libero - piccole.length * MIN) / grandi) : libero / R
    }
    const altNodo = R * s
    let y = sopra
    const nodi = fonti.map(f => {
      const h = Math.max(0, f.r) / somma * R * s, slot = Math.max(h, MIN)
      const n = { ...f, h, y0: y + (slot - h) / 2, slot0: y, slot }
      y += slot + gap
      return n
    })
    const yM0 = sopra + (H - sopra - sotto - altNodo) / 2
    // dentro il nodo dell'incassato le voci si impilano nello stesso ordine: nessun incrocio
    let acc = yM0
    const nastri = nodi.filter(n => n.h > 0.01).map(n => {
      const a: Stazione = { x: xL + 3, a: n.y0, b: n.y0 + n.h }, b: Stazione = { x: xM, a: acc, b: acc + n.h }
      acc += n.h
      return { k: n.k, d: nastro([a, b]), st: [a, b] }
    })
    const gPx = Gd > 0 ? Math.min(altNodo, Gd * s) : 0, cPx = altNodo - gPx
    // guadagno in alto e costi in basso: in mezzo c'è posto per costi di gestione e utile netto
    const yG = Math.max(sopra + 8, yM0 - 70), yC = Math.max(yM0 + gPx + 40, H - sotto - cPx)
    const uscite = [] as { k: string; d: string; st: Stazione[] }[]
    if (gPx > 0) { const st = [{ x: xM, a: yM0, b: yM0 + gPx }, { x: xR, a: yG, b: yG + gPx }]; uscite.push({ k: 'guadagno', d: nastro(st), st }) }
    if (cPx > 0) { const st = [{ x: xM, a: yM0 + gPx, b: yM0 + altNodo }, { x: xR, a: yC, b: yC + cPx }]; uscite.push({ k: 'costi', d: nastro(st), st }) }
    const corsie = [
      ...nastri.map(n => corsia(n.st)),
      ...uscite.map(u => corsia(u.st, { neutro: u.k === 'costi' })),
    ]
    return { vuoto: false as const, W, H, xL, xM, xR, nodi, nastri, uscite, yM0, altNodo, gPx, cPx, yG, yC, corsie, R, Gd, Cs }
  }, [pronto, W, fonti, tot])

  const partenza = usePartenza(!!G && !G.vuoto, 900)
  const g = G && !G.vuoto ? G : null
  useParticelle(tela, g?.corsie ?? null, { W: g?.W || 0, H: g?.H || 0, densita: 520, velocita: 40, partenza, tinte, x0: g?.xL || 0, x1: g?.xR || 1, toni: 'soldi', lato: 2.4, massimo: 320 })

  const vediGestione = tot?.costiGestione !== undefined
  return (
    <div className="pb-cascata" ref={box}>
      {!pronto ? <div className="pb-vuoto pb-vuoto--alto">…</div> : G?.vuoto ? <div className="pb-vuoto pb-vuoto--alto">Nessun incasso in questo periodo.</div> : g && (
        <div className="pb-cascata__tela" style={{ height: g.H }} key={chiave}>
          <svg width={g.W} height={g.H} viewBox={`0 0 ${g.W} ${g.H}`} role="img" aria-label={`Incassato ${euroPiano(g.R)}: ${euroPiano(g.Cs)} di costi e ${euroPiano(g.Gd)} di guadagno. Per voce: ` + g.nodi.map(n => `${n.nome} ${euroPiano(n.r)}`).join(', ')}>
            <defs>
              <linearGradient id="pb-g-entra" gradientUnits="userSpaceOnUse" x1={g.xL} x2={g.xM} y1="0" y2="0"><stop offset="0" className="pb-st pb-st--entra0" /><stop offset="1" className="pb-st pb-st--entra1" /></linearGradient>
              <linearGradient id="pb-g-guadagno" gradientUnits="userSpaceOnUse" x1={g.xM} x2={g.xR} y1="0" y2="0"><stop offset="0" className="pb-st pb-st--g0" /><stop offset="1" className="pb-st pb-st--g1" /></linearGradient>
              <pattern id="pb-p-costi" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" className="pb-costi-fondo" /><rect width="1.4" height="6" className="pb-costi-riga" /></pattern>
            </defs>
            {g.nastri.map(n => <path key={n.k} d={n.d} fill="url(#pb-g-entra)" className="pb-cascata__nastro" />)}
            {g.uscite.map(u => <path key={u.k} d={u.d} fill={u.k === 'costi' ? 'url(#pb-p-costi)' : 'url(#pb-g-guadagno)'} className={'pb-cascata__nastro pb-cascata__nastro--' + u.k} />)}
            {/* i nodi: le voci a sinistra, l'incassato in mezzo, guadagno e costi a destra */}
            {g.nodi.map(n => n.h > 0.01 ? <rect key={n.k} className="pb-nodo" x={g.xL} y={n.y0} width="3" height={Math.max(1.5, n.h)} rx="1.5" /> : <circle key={n.k} className="pb-nodo pb-nodo--vuoto" cx={g.xL + 1.5} cy={n.slot0 + n.slot / 2} r="2.5" />)}
            <rect className="pb-nodo pb-nodo--incassato" x={g.xM - 2} y={g.yM0} width="4" height={g.altNodo} rx="2" />
            {g.gPx > 0 && <rect className="pb-nodo pb-nodo--guadagno" x={g.xR - 1} y={g.yG} width="4" height={Math.max(2, g.gPx)} rx="2" />}
            {g.cPx > 0 && <rect className="pb-nodo" x={g.xR - 1} y={g.yC} width="4" height={g.cPx} rx="2" />}
          </svg>
          <canvas ref={tela} className="pb-cascata__colli" style={{ width: g.W, height: g.H }} aria-hidden="true" />

          {g.nodi.map(n => (
            <a key={n.k} className={'pb-fonte' + (n.r <= 0 && n.g === 0 ? ' pb-fonte--ferma' : '')} href={n.href} style={{ top: n.slot0 + n.slot / 2, width: g.xL - 18 }}>
              <span className="pb-fonte__riga"><span className="pb-fonte__nome">{n.nome}</span><b className={n.g < 0 ? 'pb-meno' : undefined}><Conta v={Math.round(n.g * 100) / 100}>{x => <Euro v={x} />}</Conta></b></span>
              <span className="pb-fonte__dett">{n.r > 0 || n.c > 0 ? <>incassato {euroPiano(n.r)} · costo {euroPiano(n.c)}</> : 'nessun movimento nel periodo'}</span>
            </a>
          ))}
          <div className="pb-nodo-et pb-nodo-et--incassato" style={{ left: g.xM, top: g.yM0 - 12 }}>
            <span>Incassato</span><b><Conta v={Math.round(g.R * 100) / 100}>{x => <Euro v={x} />}</Conta></b>
          </div>
          <div className="pb-nodo-et pb-nodo-et--guadagno" style={{ left: g.xR + 18, top: (g.gPx > 0 ? g.yG : g.yM0) - 22, width: g.W - g.xR - 24 }}>
            <span>Guadagno totale</span>
            <b className={g.Gd < 0 ? 'pb-meno' : undefined}><Conta v={Math.round(g.Gd * 100) / 100}>{x => <Euro v={x} />}</Conta></b>
            <em>{g.Gd >= 0 ? `il ${virgola(g.Gd / g.R * 100)}% di quello che hai incassato` : 'nel periodo i costi superano gli incassi'}</em>
            {vediGestione && (
              <div className="pb-netto">
                <div><span>Costi di gestione</span><b><Euro v={Number(tot.costiGestione || 0)} segno={Number(tot.costiGestione) > 0} /></b></div>
                <div className="pb-netto__utile"><span>Utile netto</span><b className={Number(tot.utileNetto) < 0 ? 'pb-meno' : undefined}><Euro v={Number(tot.utileNetto || 0)} /></b></div>
                {gest?.perCategoria?.length ? <p>{gest.perCategoria.slice(0, 3).map((c: any) => `${c.categoria} ${euroPiano(Number(c.importo || 0))}`).join(' · ')}</p> : null}
                <p className="pb-netto__lucchetto"><Icona id="i-lucchetto" />Solo tu e i tuoi admin · <a href="/dashboard/costi-gestione">Gestisci</a></p>
              </div>
            )}
          </div>
          {g.cPx > 0 && (
            <div className="pb-nodo-et pb-nodo-et--costi" style={{ left: g.xR + 18, top: g.yC + g.cPx / 2 }}>
              <span>Costi</span><b><Conta v={Math.round(g.Cs * 100) / 100}>{x => <Euro v={x} />}</Conta></b>
              <em>quello che costano le stesse voci</em>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── la serie del margine delle spedizioni: un'area morbida (curva monotona: non inventa picchi fra due giorni) ──
function monotona(P: [number, number][]) {
  const n = P.length
  if (n < 2) return ''
  const dx = P.slice(1).map((p, i) => p[0] - P[i][0]), m = P.slice(1).map((p, i) => (p[1] - P[i][1]) / (dx[i] || 1))
  const t = P.map((_, i) => i === 0 ? m[0] : i === n - 1 ? m[n - 2] : (m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2))
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = 0; t[i + 1] = 0; continue }
    const a = t[i] / m[i], b = t[i + 1] / m[i], h = a * a + b * b
    if (h > 9) { const k = 3 / Math.sqrt(h); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i] }
  }
  let d = `M${P[0][0].toFixed(1)} ${P[0][1].toFixed(1)}`
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3
    d += ` C${(P[i][0] + h).toFixed(1)} ${(P[i][1] + t[i] * h).toFixed(1)} ${(P[i + 1][0] - h).toFixed(1)} ${(P[i + 1][1] - t[i + 1] * h).toFixed(1)} ${P[i + 1][0].toFixed(1)} ${P[i + 1][1].toFixed(1)}`
  }
  return d
}
function Serie({ serie }: { serie: any[] }) {
  if (serie.length < 2) return <div className="pb-vuoto">{serie.length ? 'Un giorno solo: il margine è nel numero qui sopra.' : 'Nessuna spedizione nel periodo.'}</div>
  const W = 720, H = 200, l = 56, r = 14, top = 14, b = 28
  const vals = serie.map(s => Number(s.margine || 0)), max = Math.max(1, ...vals), min = Math.min(0, ...vals)
  const passi = [5, 10, 20, 25, 50, 100, 150, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 25000], tacca = passi.find(x => (max - min) / x <= 3) || 50000
  const cima = Math.ceil(max / tacca) * tacca, base = Math.floor(min / tacca) * tacca
  const X = (i: number) => l + i * (W - l - r) / (serie.length - 1), Y = (v: number) => top + (1 - (v - base) / (cima - base || 1)) * (H - top - b)
  const P = serie.map((s, i) => [X(i), Y(Number(s.margine || 0))] as [number, number])
  const linea = monotona(P), area = `${linea} L${P[P.length - 1][0].toFixed(1)} ${Y(Math.max(0, base)).toFixed(1)} L${P[0][0].toFixed(1)} ${Y(Math.max(0, base)).toFixed(1)} Z`
  const et = (g: string) => g.length === 7 ? MESI[+g.slice(5, 7) - 1].slice(0, 3) : `${+g.slice(8, 10)} ${MESI[+g.slice(5, 7) - 1].slice(0, 3)}`
  const festa = (g: string) => { if (g.length !== 10) return false; const d = new Date(g + 'T12:00:00'); return d.getDay() === 0 || d.getDay() === 6 }
  const ogni = Math.max(1, Math.ceil(serie.length / 7)), u = P[P.length - 1]
  return (
    <svg className="pb-serie__svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Margine delle spedizioni: ' + serie.map(s => `${et(s.giorno)} ${euroPiano(Number(s.margine || 0))}`).join('; ')}>
      <defs><linearGradient id="pb-g-serie" x1="0" x2="0" y1="0" y2="1"><stop offset="0" className="pb-st pb-st--serie0" /><stop offset="1" className="pb-st pb-st--serie1" /></linearGradient></defs>
      {serie.map((s, i) => festa(s.giorno) ? <rect key={'f' + i} className="pb-serie__festa" x={X(i) - (W - l - r) / (serie.length - 1) / 2} y={top} width={(W - l - r) / (serie.length - 1)} height={H - top - b} /> : null)}
      {Array.from({ length: Math.round((cima - base) / tacca) + 1 }, (_, i) => base + i * tacca).map(v => (
        <g key={v}><line x1={l} x2={W - r} y1={Y(v)} y2={Y(v)} className={v === 0 ? 'pb-serie__zero' : 'pb-serie__riga'} /><text x={l - 10} y={Y(v) + 4} textAnchor="end" className="pb-serie__et">€ {fmtN.format(v)}</text></g>
      ))}
      <path d={area} fill="url(#pb-g-serie)" className="pb-serie__area" />
      <path d={linea} className="pb-serie__linea" pathLength={1} />
      {P.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="2.2" className="pb-serie__punto"><title>{et(serie[i].giorno)}: {euroPiano(vals[i])}</title></circle>)}
      <circle cx={u[0]} cy={u[1]} r="4.5" className="pb-serie__ultimo" />
      {serie.map((s, i) => (i % ogni === 0 || i === serie.length - 1) && (i === serie.length - 1 || serie.length - 1 - i >= ogni / 2) ? <text key={'t' + i} x={X(i)} y={H - 8} textAnchor="middle" className="pb-serie__et">{et(s.giorno)}</text> : null)}
    </svg>
  )
}
