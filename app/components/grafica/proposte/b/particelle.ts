'use client'
// IL MOTORE DEL FLUSSO (proposta B, 27/10): i nastri (alla Sankey) e i colli luminosi che ci scorrono sopra.
// Un nastro è una fila di «stazioni» (x, bordo alto, bordo basso); fra due stazioni i bordi si raccordano con una
// curva a tangenti orizzontali, così il nastro non fa mai spigoli. Le particelle vanno a velocità costante in pixel:
// quante ne nascono su un nastro dipende dalla sua area, quindi sono più fitte dove il nastro è più largo e il loro
// flusso resta proporzionale al numero vero che il nastro rappresenta.
// Il disegno è su canvas e si ferma quando non si vede (fuori schermo o scheda nascosta); con prefers-reduced-motion
// le particelle restano ferme al loro posto.
import { useEffect, useState, type RefObject } from 'react'
import { calmo } from '../../movimento'

export type Stazione = { x: number; a: number; b: number }
export type Corsia = { su: Float32Array; giu: Float32Array; lun: Float32Array; tot: number; px: number; ferma: boolean; neutro: boolean }

const f1 = (n: number) => (Math.round(n * 10) / 10).toString()

// il tracciato SVG del nastro: il bordo alto in avanti, il bordo basso all'indietro
export function nastro(st: Stazione[]) {
  let d = `M${f1(st[0].x)} ${f1(st[0].a)}`
  for (let i = 0; i < st.length - 1; i++) {
    const p = st[i], q = st[i + 1], m = (p.x + q.x) / 2
    d += Math.abs(p.a - q.a) < 0.01 ? ` L${f1(q.x)} ${f1(q.a)}` : ` C${f1(m)} ${f1(p.a)} ${f1(m)} ${f1(q.a)} ${f1(q.x)} ${f1(q.a)}`
  }
  const u = st[st.length - 1]
  d += ` L${f1(u.x)} ${f1(u.b)}`
  for (let i = st.length - 1; i > 0; i--) {
    const p = st[i], q = st[i - 1], m = (p.x + q.x) / 2
    d += Math.abs(p.b - q.b) < 0.01 ? ` L${f1(q.x)} ${f1(q.b)}` : ` C${f1(m)} ${f1(p.b)} ${f1(m)} ${f1(q.b)} ${f1(q.x)} ${f1(q.b)}`
  }
  return d + ' Z'
}

// la corsia delle particelle: i due bordi campionati con lo stesso parametro (la x della curva è la stessa sopra e
// sotto), così un collo che sta al 30% della larghezza ci resta anche in curva
export function corsia(st: Stazione[], o: { ferma?: boolean; neutro?: boolean } = {}): Corsia {
  const su: number[] = [st[0].x, st[0].a], giu: number[] = [st[0].x, st[0].b]
  for (let i = 0; i < st.length - 1; i++) {
    const p = st[i], q = st[i + 1], m = (p.x + q.x) / 2
    const dritto = Math.abs(p.a - q.a) < 0.01 && Math.abs(p.b - q.b) < 0.01
    const n = dritto ? Math.max(1, Math.ceil((q.x - p.x) / 40)) : 24
    for (let j = 1; j <= n; j++) {
      const t = j / n, u = 1 - t
      const x = dritto ? p.x + (q.x - p.x) * t : u * u * u * p.x + 3 * u * u * t * m + 3 * u * t * t * m + t * t * t * q.x
      const y = (y0: number, y1: number) => dritto ? y0 : u * u * u * y0 + 3 * u * u * t * y0 + 3 * u * t * t * y1 + t * t * t * y1
      su.push(x, y(p.a, q.a)); giu.push(x, y(p.b, q.b))
    }
  }
  const n = su.length / 2, lun = new Float32Array(n)
  let area = 0
  for (let i = 1; i < n; i++) {
    const cx0 = (su[2 * i - 2] + giu[2 * i - 2]) / 2, cy0 = (su[2 * i - 1] + giu[2 * i - 1]) / 2
    const cx1 = (su[2 * i] + giu[2 * i]) / 2, cy1 = (su[2 * i + 1] + giu[2 * i + 1]) / 2
    const l = Math.hypot(cx1 - cx0, cy1 - cy0)
    lun[i] = lun[i - 1] + l
    area += l * Math.abs(giu[2 * i + 1] - su[2 * i + 1])
  }
  const tot = lun[n - 1] || 1
  return { su: new Float32Array(su), giu: new Float32Array(giu), lun, tot, px: area / tot, ferma: !!o.ferma, neutro: !!o.neutro }
}

function punto(c: Corsia, d: number, corsiaY: number): [number, number] {
  const L = c.lun
  let lo = 0, hi = L.length - 1
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (L[m] <= d) lo = m; else hi = m }
  const t = L[hi] > L[lo] ? (d - L[lo]) / (L[hi] - L[lo]) : 0
  const ax = c.su[2 * lo] + (c.su[2 * hi] - c.su[2 * lo]) * t, ay = c.su[2 * lo + 1] + (c.su[2 * hi + 1] - c.su[2 * lo + 1]) * t
  const bx = c.giu[2 * lo] + (c.giu[2 * hi] - c.giu[2 * lo]) * t, by = c.giu[2 * lo + 1] + (c.giu[2 * hi + 1] - c.giu[2 * lo + 1]) * t
  return [ax + (bx - ax) * corsiaY, ay + (by - ay) * corsiaY]
}

// ── i colori: si leggono dai gettoni della cornice (cambiano col cerchio giorno/notte) ──
type RGB = [number, number, number]
export function rgb(s: string): RGB {
  const t = s.trim()
  if (t.startsWith('#')) {
    const h = t.length === 4 ? t.slice(1).split('').map(c => c + c).join('') : t.slice(1, 7)
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const m = t.match(/[\d.]+/g)
  return m && m.length >= 3 ? [+m[0], +m[1], +m[2]] : [242, 107, 29]
}
export type Tinte = { notte: boolean; accento: RGB; accentoTesto: RGB; inchiostro: RGB }

// i gettoni stanno sull'antenato .gx: si rileggono a ogni cambio di tema (e un attimo dopo, quando il cerchio della
// transizione ha finito di posare la luce nuova)
export function useTinte(rif: RefObject<HTMLElement | null>, tema: string) {
  const [t, setT] = useState<Tinte | null>(null)
  useEffect(() => {
    const leggi = () => {
      const el = rif.current; if (!el) return
      const cs = getComputedStyle(el), v = (k: string) => cs.getPropertyValue(k)
      setT({ notte: tema === 'notte', accento: rgb(v('--gx-accento') || '#F26B1D'), accentoTesto: rgb(v('--gx-accento-testo') || '#C2470C'), inchiostro: rgb(v('--gx-inchiostro') || '#0F141B') })
    }
    const r = requestAnimationFrame(leggi), t2 = setTimeout(leggi, 500)
    return () => { cancelAnimationFrame(r); clearTimeout(t2) }
  }, [rif, tema])
  return t
}

const mescola = (a: RGB, b: RGB, k: number): RGB => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k]
const css = (c: RGB, a = 1) => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`

// i colli: un quadratino con un alone. Di giorno arancio scuro sul tratto chiaro e bianco sul tratto arancio; di notte
// bianco caldo che si somma alla luce del nastro (così il fiume brilla). Otto toni lungo il fiume, disegnati una volta.
function sprite(colore: RGB, notte: boolean, dpr: number, lato: number) {
  const S = Math.ceil(16 * dpr), c = document.createElement('canvas'); c.width = c.height = S
  const g = c.getContext('2d')!
  const r = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2)
  r.addColorStop(0, css(colore, notte ? 0.55 : 0.16)); r.addColorStop(0.45, css(colore, notte ? 0.18 : 0.05)); r.addColorStop(1, css(colore, 0))
  g.fillStyle = r; g.fillRect(0, 0, S, S)
  const q = lato * dpr
  g.fillStyle = css(colore, notte ? 0.95 : 0.92)
  g.beginPath(); (g as any).roundRect ? (g as any).roundRect(S / 2 - q / 2, S / 2 - q / 2, q, q, q * 0.28) : g.rect(S / 2 - q / 2, S / 2 - q / 2, q, q); g.fill()
  return c
}

export type Toni = 'fiume' | 'soldi' | 'neutro'
function tavolozza(t: Tinte, toni: Toni): [RGB, RGB] {
  const bianco: RGB = [255, 255, 255], caldo: RGB = [255, 228, 204]
  if (toni === 'neutro') return t.notte ? [[150, 166, 194], [186, 198, 218]] : [mescola(t.inchiostro, bianco, 0.25), mescola(t.inchiostro, bianco, 0.45)]
  if (toni === 'soldi') return t.notte ? [bianco, caldo] : [t.accento, bianco]
  return t.notte ? [bianco, caldo] : [t.accento, bianco]
}

type Collo = { c: number; d: number; y: number; v: number; s: number }

// densita: quanti px² di nastro per ogni collo; velocita: px al secondo; partenza: l'istante (performance.now) in cui
// partono, 0 = non ancora (il nastro intanto si riempie; agli aggiornamenti dei dati è già passato e ripartono subito);
// x0..x1: dove il colore passa dal primo tono al secondo
export function useParticelle(tela: RefObject<HTMLCanvasElement | null>, corsie: Corsia[] | null, o: {
  W: number; H: number; densita: number; velocita: number; partenza: number; tinte: Tinte | null; x0: number; x1: number; toni?: Toni; lato?: number; massimo?: number
}) {
  const { W, H, densita, velocita, partenza, tinte, x0, x1 } = o
  const toni = o.toni || 'fiume', lato = o.lato || 2.6, massimo = o.massimo || 900
  useEffect(() => {
    const cv = tela.current
    if (!cv || !corsie || !corsie.length || !tinte || !partenza || W < 10 || H < 10) return
    const dpr = Math.min(2, window.devicePixelRatio || 1)
    cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr)
    const ctx = cv.getContext('2d'); if (!ctx) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    const [c0, c1] = tavolozza(tinte, toni), [n0, n1] = tavolozza(tinte, 'neutro')
    const SPR = Array.from({ length: 8 }, (_, i) => sprite(mescola(c0, c1, i / 7), tinte.notte, dpr, lato))
    // le corsie neutre (i costi, le uscite) hanno i colli grigi: l'arancio resta a chi scorre nel verso giusto
    const SPRN = corsie.some(c => c.neutro) ? Array.from({ length: 8 }, (_, i) => sprite(mescola(n0, n1, i / 7), tinte.notte, dpr, lato)) : SPR
    // quante particelle per corsia: area / densità (almeno una sui fili sottili, così si vede che lì scorre qualcosa)
    let quante = corsie.map(c => Math.max(1, Math.round(c.px * c.tot / densita)))
    const somma = quante.reduce((a, b) => a + b, 0)
    if (somma > massimo) quante = quante.map(q => Math.max(1, Math.round(q * massimo / somma)))
    const colli: Collo[] = []
    corsie.forEach((c, i) => { for (let k = 0; k < quante[i]; k++) colli.push({ c: i, d: Math.random() * c.tot, y: 0.1 + Math.random() * 0.8, v: velocita * (0.86 + Math.random() * 0.28), s: 0.75 + Math.random() * 0.55 }) })
    const S = 16, fermo = calmo()
    const disegna = (svanisce: number) => {
      ctx.clearRect(0, 0, W, H)
      ctx.globalCompositeOperation = tinte.notte ? 'lighter' : 'source-over'
      for (const p of colli) {
        const c = corsie[p.c], k = p.d / c.tot
        // entra piano all'inizio; in fondo svanisce (se si ferma lì, svanisce mentre rallenta)
        let a = Math.min(1, p.d / 22)
        a *= c.ferma ? 1 - Math.max(0, (k - 0.62) / 0.38) : Math.min(1, (c.tot - p.d) / 26)
        if (a <= 0.01) continue
        const [x, y] = punto(c, p.d, p.y)
        const u = Math.min(1, Math.max(0, (x - x0) / Math.max(1, x1 - x0)))
        ctx.globalAlpha = a * svanisce
        const l = S * p.s
        ctx.drawImage((c.neutro ? SPRN : SPR)[Math.round(u * 7)], x - l / 2, y - l / 2, l, l)
      }
      ctx.globalAlpha = 1
    }
    if (fermo) { disegna(1); return }
    let raf = 0, vivo = true, visibile = true, ultimo = 0
    const passo = (t: number) => {
      if (!vivo) return
      const dt = ultimo ? Math.min(0.05, (t - ultimo) / 1000) : 0
      ultimo = t
      const fade = Math.min(1, Math.max(0, (t - partenza) / 800))
      if (fade > 0) for (const p of colli) {
        const c = corsie[p.c], k = p.d / c.tot
        // chi si ferma (le spedizioni ancora in quello stato) rallenta in fondo alla sua lingua
        const v = c.ferma && k > 0.5 ? p.v * Math.max(0.12, 1 - (k - 0.5) / 0.5) : p.v
        p.d += v * dt
        if (p.d >= c.tot * (c.ferma ? 0.985 : 1)) { p.d = 0; p.y = 0.1 + Math.random() * 0.8 }
      }
      disegna(fade)
      raf = requestAnimationFrame(passo)
    }
    const via = () => { if (!raf && visibile && document.visibilityState === 'visible') { ultimo = 0; raf = requestAnimationFrame(passo) } }
    const ferma = () => { cancelAnimationFrame(raf); raf = 0 }
    const oss = new IntersectionObserver(e => { visibile = e[0].isIntersecting; if (visibile) via(); else ferma() }, { rootMargin: '80px' })
    oss.observe(cv)
    const scheda = () => { if (document.visibilityState === 'visible') via(); else ferma() }
    document.addEventListener('visibilitychange', scheda)
    via()
    return () => { vivo = false; ferma(); oss.disconnect(); document.removeEventListener('visibilitychange', scheda) }
  }, [tela, corsie, W, H, densita, velocita, partenza, tinte, x0, x1, toni, lato, massimo])
}

// quando far partire i colli: la prima volta che il disegno c'è, dopo `ms` (il tempo che il nastro si riempia)
export function usePartenza(pronto: boolean, ms: number) {
  const [p, setP] = useState(0)
  useEffect(() => { if (pronto && !p) setP(performance.now() + (calmo() ? 0 : ms)) }, [pronto, p, ms])
  return p
}

// la misura del riquadro (dopo l'apertura: il server non sa quanto è largo lo schermo)
export function useLarghezza(rif: RefObject<HTMLElement | null>) {
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = rif.current; if (!el) return
    const m = () => setW(Math.round(el.clientWidth))
    m()
    const ro = new ResizeObserver(m); ro.observe(el)
    return () => ro.disconnect()
  }, [rif])
  return w
}
