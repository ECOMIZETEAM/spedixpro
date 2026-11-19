'use client'
// LA PLANCIA NUOVA (v11, approvata da Lorenzo il 27/10): il disegno della prova (esempi-v6/v11/plancia.html) coi
// numeri veri del master. Ogni numero viene da una rotta che il portale ha già (/api/dashboard, /api/network/badge, le
// rotte dei soldi con ?dal&al, /api/dashboard/destinazioni, /api/resi/analisi) più /api/dashboard/giornata (le create
// di oggi ora per ora). Niente numeri scritti a mano: dove un dato non c'è, il riquadro lo dice.
// Il 3D è immagine (il magazzino delle quattro luci, le vedute, gli oggetti), tranne le colonne dei mesi, che seguono i
// numeri di ogni master e sono fatte coi fogli di stile (niente WebGL in più sulla pagina).
import { useContext, useEffect, useMemo, useRef, useState } from 'react'
import { geoMercator, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import { Icona } from './icone'
import { SCENA } from './scena'
import { GraficaNuova } from './contesto'
import { Conta, useRivela, useScorrimentoMorbido } from './movimento'
import './movimento.css'
import './plancia.css'

export const fmtN = new Intl.NumberFormat('it-IT', { useGrouping: 'always' as any })
const fmtE = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' as any })
export const MESI = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre']
export const GIORNI = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato']
export const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
const giorno = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x }

// € 5.366,00 con simbolo e centesimi piccoli, come nella prova
export function Euro({ v, segno }: { v: number; segno?: boolean }) {
  const neg = v < -0.004, s = fmtE.format(Math.abs(v)).split(',')
  return <span className="pn-euro"><small>{neg || segno ? '−€ ' : '€ '}</small>{s[0]}<small>,{s[1]}</small></span>
}
export const euroPiano = (v: number) => (v < -0.004 ? '−€ ' : '€ ') + fmtE.format(Math.abs(v))

export function usaJson<T = any>(url: string | null, dipende: any[] = []): T | null {
  const [d, setD] = useState<T | null>(null)
  useEffect(() => {
    if (!url) return
    let vivo = true
    fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(x => { if (vivo) setD(x && !x.error ? x : null) }).catch(() => {})
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, ...dipende])
  return d
}

// la trasformazione che porta un rettangolo L × A sui quattro punti (in senso orario dall'alto a sinistra) della foto:
// l'insegna è un piano in prospettiva, e il nome ci va sopra con la stessa prospettiva
export function suQuattroPunti(L: number, A: number, p: [number, number][]) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3, dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3
  const den = dx1 * dy2 - dx2 * dy1
  const g = (dx3 * dy2 - dx2 * dy3) / den, h = (dx1 * dy3 - dx3 * dy1) / den
  const a = x1 - x0 + g * x1, b = x3 - x0 + h * x3, c = x0, d = y1 - y0 + g * y1, e = y3 - y0 + h * y3, f = y0
  return `matrix3d(${a / L},${d / L},0,${g / L},${b / A},${e / A},0,${h / A},0,0,1,0,${c},${f},0,1)`
}

export default function PlanciaNuova() {
  // ── i dati di oggi: la stessa /api/dashboard della plancia di oggi ──
  // L'istantanea di sessione (per non partire vuoti) si legge DOPO l'apertura: letta subito, il server (che non ce
  // l'ha) e il browser disegnavano due pagine diverse. Ed è per utente: con la chiave comune di prima, chi cambiava
  // account nella stessa scheda vedeva per un attimo il nome e i numeri dell'altro («MoovExpress» su Ecomize LL).
  const g = useContext(GraficaNuova)
  const chiave = 'plancia_nuova_v1|' + g.chi
  const [data, setData] = useState<any>(null)
  const [giornata, setGiornata] = useState<any>(null)
  const [badge, setBadge] = useState<any>(null)
  const [quando, setQuando] = useState<Date | null>(null)
  useEffect(() => {
    try { const c = sessionStorage.getItem(chiave); if (c) setData(JSON.parse(c)) } catch {}
    setQuando(new Date())
    let vivo = true, ultimo = 0
    const carica = () => {
      const t = Date.now(); if (t - ultimo < 1000) return; ultimo = t
      fetch('/api/dashboard', { cache: 'no-store' }).then(r => r.json()).then(d => { if (vivo && d && !d.error) { setData(d); setQuando(new Date()); try { sessionStorage.setItem(chiave, JSON.stringify(d)) } catch {} } }).catch(() => {})
      fetch('/api/dashboard/giornata', { cache: 'no-store' }).then(r => r.json()).then(d => { if (vivo && d && !d.error) setGiornata(d) }).catch(() => {})
      fetch('/api/network/badge', { cache: 'no-store' }).then(r => r.json()).then(d => { if (vivo && d && !d.error) setBadge(d) }).catch(() => {})
    }
    carica()
    const t = setInterval(() => { if (document.visibilityState === 'visible') carica() }, 120000)
    const torna = () => { if (document.visibilityState === 'visible') carica() }
    document.addEventListener('visibilitychange', torna); window.addEventListener('focus', torna)
    return () => { vivo = false; clearInterval(t); document.removeEventListener('visibilitychange', torna); window.removeEventListener('focus', torna) }
  }, [chiave])

  // l'entrata si vede una volta per sessione (il server lo sa dal biscotto mx_entrata e disegna già la pagina pronta a
  // entrare: niente lampo della pagina ferma prima dell'animazione)
  // ?entrata=si la rifà (per farla vedere di nuovo: di solito è una volta per sessione)
  const [entra, setEntra] = useState(g.entrata)
  useEffect(() => {
    document.cookie = 'mx_entrata=1; path=/; samesite=lax'
    if (new URLSearchParams(location.search).get('entrata') === 'si') { setEntra(false); requestAnimationFrame(() => requestAnimationFrame(() => setEntra(true))) }
  }, [])

  // ── la base: posata perché il magazzino stia nello spazio libero (stessi conti della prova) ──
  const radice = useRef<HTMLDivElement>(null)
  const [posa, setPosa] = useState<{ x: number; y: number; w: number; h: number; W: number; H: number } | null>(null)
  const luce = g.luce
  useEffect(() => {
    const metti = () => {
      const W = innerWidth, H = innerHeight, iw = SCENA.w, ih = SCENA.h
      const s = Math.max(W / iw, H / ih) * 1.2, w = iw * s, h = ih * s
      const tx = 248 + (W - 248 - 340) * 0.74, ty = 82 + (H - 82 - 160) * 0.62
      let x = tx - 0.61 * w, y = ty - 0.40 * h
      x = Math.min(0, Math.max(W - w, x)); y = Math.min(0, Math.max(H - h, y))
      setPosa({ x, y, w, h, W, H })
    }
    metti(); addEventListener('resize', metti)
    return () => removeEventListener('resize', metti)
  }, [])
  // in coordinate dell'immagine (la telecamera le sposta e le ingrandisce insieme alla foto)
  const locale = (k: string) => { const p = (SCENA.punti as any)[k]; return posa && p ? [p.x / 100 * posa.w, p.y / 100 * posa.h] as [number, number] : null }

  // ── LA TELECAMERA: scorrendo, il magazzino si avvicina al pezzo di cui parla la sezione (le banchine per le
  // spedizioni, la strada per l'andamento, la palazzina per i soldi), si allontana per l'Italia. Fuoco in percentuale
  // dell'immagine, ingrandimento, dove cade il fuoco sullo schermo; sfoca = quanto la foto si sfoca sotto le schede ──
  const lenis = useScorrimentoMorbido(radice)
  const camera = useRef<HTMLDivElement>(null), base = useRef<HTMLDivElement>(null), prima = useRef<HTMLElement>(null)
  useEffect(() => {
    const pagina = radice.current?.closest('.gx-pagina') as HTMLElement | null
    if (!pagina || !posa || !camera.current) return
    const { w, h, W, H } = posa
    const tx0 = 248 + (W - 248 - 340) * 0.74, ty0 = 82 + (H - 82 - 160) * 0.62
    type K = { fx: number; fy: number; z: number; sx: number; sy: number; velo: number }
    const P = SCENA.punti as any
    const fermo = { fx: 0.61, fy: 0.40, z: 1, sx: tx0, sy: ty0, velo: 0 }
    const FOTO: K[] = [
      fermo,
      // il soggetto cade a destra dei titoli (i titoli stanno a sinistra, sopra un velo morbido)
      { fx: P.partite.x / 100, fy: P.partite.y / 100 + 0.02, z: 1.85, sx: W * 0.72, sy: H * 0.34, velo: 0.1 },     // 01 le banchine
      { fx: P.transito.x / 100, fy: P.transito.y / 100, z: 1.6, sx: W * 0.74, sy: H * 0.36, velo: 0.15 },          // 02 la strada
      { fx: P.contrassegni.x / 100, fy: P.contrassegni.y / 100 + 0.02, z: 2.0, sx: W * 0.74, sy: H * 0.34, velo: 0.15 }, // 03 la palazzina
      { fx: 0.6, fy: 0.42, z: 0.86, sx: W * 0.6, sy: H * 0.5, velo: 0.55 },                                         // 04 lontano: l'Italia
      { fx: P.pedana.x / 100, fy: P.pedana.y / 100, z: 1.5, sx: W * 0.74, sy: H * 0.36, velo: 0.2 },              // 05 la pedana
    ]
    const ancore = () => {
      const top = pagina.getBoundingClientRect().top
      const sez = [...(radice.current?.querySelectorAll('.pn-dati > section') || [])].slice(0, FOTO.length - 1)
      return [0, ...sez.map(s => s.getBoundingClientRect().top - top + pagina.scrollTop - H * 0.2)]
    }
    let A = ancore()
    const liscio = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t) }
    const mix = (a: number, b: number, k: number) => a + (b - a) * k
    const disegna = () => {
      const s = pagina.scrollTop
      let i = 0; while (i < A.length - 1 && s >= A[i + 1]) i++
      const a = A[i], b = A[i + 1] ?? (A[i] + H), t = Math.min(1, Math.max(0, (s - a) / Math.max(1, b - a)))
      const k0 = FOTO[i], k1 = FOTO[Math.min(i + 1, FOTO.length - 1)]
      // la telecamera resta sulla sezione mentre la si legge e si sposta quando arriva la prossima (dalla prima
      // schermata invece parte subito: è l'invito a scendere)
      const m = i === 0 ? liscio(0, 0.9, t) : liscio(0.5, 1, t)
      const z = Math.exp(mix(Math.log(k0.z), Math.log(k1.z), m))
      const fx = mix(k0.fx, k1.fx, m), fy = mix(k0.fy, k1.fy, m), sx = mix(k0.sx, k1.sx, m), sy = mix(k0.sy, k1.sy, m)
      const wz = w * z, hz = h * z
      let X = sx - fx * wz, Y = sy - fy * hz
      X = wz >= W ? Math.min(0, Math.max(W - wz, X)) : (W - wz) / 2
      Y = hz >= H ? Math.min(0, Math.max(H - hz, Y)) : (H - hz) / 2
      camera.current!.style.transform = `translate3d(${X.toFixed(1)}px, ${Y.toFixed(1)}px, 0) scale(${z.toFixed(4)})`
      // sotto le schede la foto si sfoca e si vela; sui titoli delle sezioni torna nitida
      const sotto = i === 0 ? liscio(0.35, 0.8, t) * (1 - liscio(0.85, 1, t)) : liscio(0.08, 0.3, t) * (1 - liscio(0.7, 0.95, t))
      const velo = Math.max(mix(k0.velo, k1.velo, m), sotto * 0.75)
      base.current?.style.setProperty('--s', Math.max(sotto, velo * 0.6).toFixed(3))
      base.current?.style.setProperty('--velo', velo.toFixed(3))
      // sui titoli delle sezioni (non nella prima schermata) un velo dal lato sinistro: il titolo si legge, il
      // plastico si vede a destra
      base.current?.style.setProperty('--titoli', (i === 0 ? liscio(0.6, 1, t) : 1).toFixed(3))
      // la prima schermata: i cartellini se ne vanno subito, il saluto sale e sfuma
      const u = Math.min(1, s / (H * 0.7))
      radice.current?.style.setProperty('--u', u.toFixed(3))
    }
    disegna()
    const su = () => requestAnimationFrame(disegna)
    pagina.addEventListener('scroll', su, { passive: true })
    const ro = new ResizeObserver(() => { A = ancore(); disegna() }); if (radice.current) ro.observe(radice.current)
    return () => { pagina.removeEventListener('scroll', su); ro.disconnect() }
  }, [posa, lenis])
  useRivela(radice, data)

  const nome = String(data?.masterNome || '').trim()
  const ora = quando ? quando.getHours() : 12
  const saluto = ora < 13 ? 'Buongiorno' : ora < 18 ? 'Buon pomeriggio' : 'Buonasera'
  const fuori = Number(data?.daMettereInDistinta || 0), giacenze = Number(data?.inGiacenza || 0)
  const pedana = locale('pedana'), recinto = locale('giacenze')

  // l'insegna: lettera nel quadrato arancio e nome nella fascia, nella prospettiva della facciata
  const insegna = useMemo(() => {
    if (!posa || !nome) return null
    const q = (k: string) => [1, 2, 3, 4].map(i => { const p = (SCENA.punti as any)[k + '_' + i]; return [p.x / 100 * posa.w, p.y / 100 * posa.h] as [number, number] })
    const testo = nome.toUpperCase(), L = 1000, A = 100
    const corpo = Math.min(70, L / Math.max(1, testo.length * 0.66))
    return { lettera: suQuattroPunti(100, 100, q('quadrato')), nome: suQuattroPunti(L, A, q('nome')), testo, L, A, corpo }
  }, [posa, nome])

  // i percorsi a terra (come i sentieri di RoutaX), punti a terra proiettati dallo studio: A dalla pedana all'uscita,
  // B dal parcheggio dei furgoni alla pedana. Curve morbide fra i punti (Catmull-Rom), non spezzate
  const percorsi = useMemo(() => {
    if (!posa) return []
    const curva = (pt: [number, number][]) => {
      let d = `M${pt[0][0].toFixed(1)} ${pt[0][1].toFixed(1)}`
      for (let i = 0; i < pt.length - 1; i++) {
        const p0 = pt[i - 1] || pt[i], p1 = pt[i], p2 = pt[i + 1], p3 = pt[i + 2] || p2
        const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6], c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6]
        d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
      }
      return d
    }
    return ['a', 'b'].map(v => [0, 1, 2, 3, 4].map(i => locale(`via_${v}_${i}`)).filter(Boolean) as [number, number][]).filter(p => p.length > 1).map(curva)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [posa])

  const fare = [
    { n: Number(data?.inGiacenza || 0), testo: 'giacenze aspettano te', azione: 'Rispondi', href: '/dashboard/spedizioni/giacenze' },
    { n: Number(badge?.daAccettare || 0), testo: 'richieste della rete', azione: 'Rivedi', href: '/dashboard/network' },
    { n: Number(badge?.daConfermare || 0), testo: 'rettifiche da confermare', azione: 'Conferma', href: '/dashboard/spedizioni/rettifica' },
  ]
  const quante = (fuori > 0 ? 1 : 0) + fare.filter(f => f.n > 0).length
  const limite = Number(data?.limiteMese || 0), mese = Number(data?.spedizioniMese || 0)
  const intero = (n: number) => fmtN.format(n)

  return (
    <div className={'pn' + (entra ? ' pn-entra' : '')} ref={radice}>
      {/* la base 3D: la telecamera porta la foto, la sua copia sfocata, l'insegna, i percorsi e i cartellini */}
      <div className="pn-base" ref={base} aria-hidden="true">
        <i className="pn-velo-titoli" />
        {posa && (
          <div className="pn-camera" ref={camera} style={{ width: posa.w, height: posa.h }}>
            <div className="pn-camera-in">
              <img src={`/grafica/luce-${luce}.webp`} alt="" />
              <img className="pn-sfocata" src={`/grafica/luce-${luce}.webp`} alt="" />
              {insegna && <>
                <span className="pn-insegna pn-insegna--lettera" style={{ width: 100, height: 100, fontSize: 70, transform: insegna.lettera }}>{insegna.testo[0]}</span>
                <span className="pn-insegna pn-insegna--nome" style={{ width: insegna.L, height: insegna.A, lineHeight: insegna.A + 'px', fontSize: insegna.corpo, transform: insegna.nome }}>{insegna.testo}</span>
              </>}
              <svg className="pn-percorsi" width={posa.w} height={posa.h}>
                {percorsi.map((d, i) => <g key={i}><path d={d} className="pn-percorso-fondo" /><path d={d} className="pn-percorso" style={{ animationDelay: (i * -0.6) + 's' }} /></g>)}
                {pedana && fuori > 0 && (() => { const [x, y] = pedana, a = 46, b = 26, c = 10; return (
                  <g className="pn-selezione">
                    {[[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy], k) => <path key={k} d={`M${x + sx * a} ${y + sy * b - sy * c} L${x + sx * a} ${y + sy * b} L${x + sx * a - sx * c * 1.6} ${y + sy * b}`} />)}
                  </g>) })()}
              </svg>
              <div className="pn-cartellini">
                {pedana && fuori > 0 && <>
                  <i className="pn-punto" style={{ left: pedana[0], top: pedana[1] }} />
                  <a className="pn-cartellino gx-vetro gx-pillola" href="/dashboard/distinte/crea" style={{ left: Math.min(pedana[0] - 120, posa.W - 380 - 300 - posa.x), top: pedana[1] - 120 }}><i>{intero(fuori)}</i>da chiudere in distinta</a>
                </>}
                {recinto && giacenze > 0 && <>
                  <i className="pn-punto pn-punto--rosso" style={{ left: recinto[0], top: recinto[1] }} />
                  <a className="pn-cartellino pn-cartellino--rosso gx-vetro gx-pillola" href="/dashboard/spedizioni/giacenze" style={{ left: recinto[0] - 230, top: recinto[1] + 56 }}><i>{intero(giacenze)}</i>in giacenza nel recinto</a>
                </>}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── la prima schermata ── */}
      <section className="pn-prima" aria-label="Oggi" ref={prima}>
        <div className="pn-titolo">
          <small><i />{quando ? <>{GIORNI[quando.getDay()]} {quando.getDate()} {MESI[quando.getMonth()]} · aggiornato alle {String(quando.getHours()).padStart(2, '0')}:{String(quando.getMinutes()).padStart(2, '0')}</> : ' '}</small>
          <h1><span className="pn-maschera"><span>{quando ? saluto : 'Ciao'},</span></span><span className="pn-maschera"><span><b>{nome || '…'}</b></span></span></h1>
          <div className="pn-eroe">
            <b>{data ? <Conta v={Number(data.spediteOggi || 0)}>{intero}</Conta> : '…'}</b>
            <div>
              <span>spedizioni partite oggi</span>
              <em>{giornata ? `${intero(giornata.create)} create oggi` : ''}{data ? `${giornata ? ' · ' : ''}${intero(Number(data.inLavorazione || 0))} in lavorazione` : ''}</em>
            </div>
          </div>
        </div>

        <div className="pn-colonna">
          <section className="pn-lastra gx-vetro pn-luccica" aria-labelledby="pn-fare">
            <div className="pn-testa"><h2 id="pn-fare">Da fare adesso</h2><span>{quante === 1 ? '1 cosa' : `${quante} cose`}</span></div>
            <div className="pn-fare">
              <div className="pn-fare__primo">
                <b>{data ? <Conta v={fuori}>{intero}</Conta> : '…'}</b>
                <span>spedizioni da chiudere in distinta<em>tutta la tua rete</em></span>
                <a className="pn-btn pn-btn--pieno" href="/dashboard/distinte/crea">Crea distinta</a>
              </div>
              {fare.map(f => (
                <div key={f.href} className={'pn-fare__riga' + (f.n ? '' : ' pn-fare__riga--zero')}>
                  <b><Conta v={f.n}>{intero}</Conta></b><span>{f.testo}</span><a className="pn-btn" href={f.href}>{f.azione}</a>
                </div>
              ))}
            </div>
          </section>
          <section className="pn-lastra gx-vetro pn-luccica" aria-labelledby="pn-giornata">
            <div className="pn-testa"><h2 id="pn-giornata">La giornata</h2><span>{giornata ? `${intero(giornata.create)} create · ${intero(giornata.fuoriDistinta)} da chiudere` : '…'}</span></div>
            <Giornata g={giornata} />
          </section>
        </div>

        <div className="pn-fila">
          <a className="pn-numero gx-vetro pn-luccica" href="/dashboard/spedizioni?stato=in_transito">
            <img className="pn-veduta" src={`/grafica/vedute/furgoni-${luce}.webp`} alt="" />
            <span><i />In transito</span><b><Conta v={Number(data?.inTransito || 0)}>{intero}</Conta></b><em>{intero(Number(data?.consegnateMese || 0))} consegnate questo mese</em>
          </a>
          <a className={'pn-numero gx-vetro pn-luccica' + (giacenze ? ' pn-numero--problema' : '')} href="/dashboard/spedizioni/giacenze">
            <img className="pn-veduta" src={`/grafica/vedute/recinto-${luce}.webp`} alt="" />
            <span><i />In giacenza</span><b><Conta v={giacenze}>{intero}</Conta></b><em>{giacenze ? 'aspettano una risposta' : 'nessuna da risolvere'}</em>
          </a>
          <a className="pn-numero gx-vetro pn-luccica" href="/dashboard/contrassegni">
            <img className="pn-veduta" src={`/grafica/vedute/ufficio-${luce}.webp`} alt="" />
            <span><i />Contrassegni</span><b><Conta v={Number(data?.codDaRimettere || 0)}>{n => <Euro v={n} />}</Conta></b><em>da rimettere ai clienti</em>
          </a>
          <a className="pn-numero gx-vetro pn-luccica" href="/dashboard/abbonamento">
            <img className="pn-veduta" src={`/grafica/vedute/banchina-${luce}.webp`} alt="" />
            <span><i />{quando ? MESI[quando.getMonth()][0].toUpperCase() + MESI[quando.getMonth()].slice(1) : 'Questo mese'}</span>
            <b><Conta v={mese}>{intero}</Conta></b>
            {!data?.illimitato && limite > 0
              ? <><em>su {intero(limite)} del tuo piano</em><span className="pn-puntini" role="img" aria-label={`${Math.round(mese / limite * 1000) / 10}% del piano`}><i style={{ width: Math.min(100, mese / limite * 100) + '%' }} /></span></>
              : <em>spedizioni del mese, senza limite</em>}
          </a>
        </div>
      </section>

      <Sezioni data={data} giornata={giornata} />
    </div>
  )
}

export function Sezioni({ data, giornata }: { data: any; giornata: any }) {
  return (
    <div className="pn-dati">
      <Spedizioni data={data} giornata={giornata} />
      <Andamento data={data} />
      <Soldi data={data} />
      <Dove />
      <Rete data={data} />
    </div>
  )
}

// ── La giornata: le create di oggi ora per ora, a puntini; la parte ancora fuori distinta a righe arancio ──
function Giornata({ g }: { g: any }) {
  if (!g) return <div className="pn-vuoto">…</div>
  const ore = (g.ore as any[]).filter((o: any) => o.ora >= 7 && o.ora <= 20)
  const max = Math.max(4, ...ore.map((o: any) => o.create))
  const W = 284, H = 112, y0 = 92, passo = W / ore.length
  const Y = (v: number) => y0 - v / max * 80
  return (
    <svg className="pn-grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Create oggi ora per ora: ${ore.filter((o: any) => o.create).map((o: any) => `${o.ora}: ${o.create}`).join(', ')}`}>
      <defs>
        <pattern id="pn-pp" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="var(--gx-inchiostro)" opacity=".85" /></pattern>
        <pattern id="pn-rr" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="2.2" height="5" fill="var(--gx-accento)" /></pattern>
      </defs>
      {ore.map((o: any, i: number) => {
        const x = i * passo + passo * .2, w = passo * .6, dentro = o.create - o.fuoriDistinta
        return (
          <g key={o.ora}>
            {dentro > 0 && <rect className="pn-cresce" x={x} y={Y(dentro)} width={w} height={y0 - Y(dentro)} rx="3" fill="url(#pn-pp)" />}
            {o.fuoriDistinta > 0 && <rect className="pn-cresce" x={x} y={Y(o.create)} width={w} height={Math.max(2, Y(dentro) - Y(o.create) - (dentro > 0 ? 2 : 0))} rx="3" fill="url(#pn-rr)" stroke="var(--gx-accento)" />}
          </g>
        )
      })}
      {ore.filter((o: any) => o.ora % 2 === 0).map((o: any) => {
        const i = ore.indexOf(o)
        return <text key={o.ora} x={i * passo + passo / 2} y={H - 4} textAnchor="middle" fontSize="10" fill="var(--gx-attenuato)">{o.ora}</text>
      })}
    </svg>
  )
}

function Testa({ segno, occhiello, titolo, frase, numeri }: { segno: string; occhiello: string; titolo: React.ReactNode; frase?: React.ReactNode; numeri?: { v: React.ReactNode; l: string }[] }) {
  const luce = useContext(GraficaNuova).tema
  return (
    <div className="pn-sez__testa">
      <div>
        <img className="pn-segno" src={`/grafica/segni/${segno}-${luce}.webp`} alt="" />
        <small>{occhiello}</small><h2><span className="pn-maschera"><span>{titolo}</span></span></h2>{frase && <p>{frase}</p>}
      </div>
      {numeri && <div className="pn-sez__numeri">{numeri.map(n => <div key={n.l}><b>{n.v}</b><span>{n.l}</span></div>)}</div>}
    </div>
  )
}

const STATO: Record<string, [string, string]> = {
  in_lavorazione: ['In lavorazione', ''], spedita: ['Spedita', ''], in_transito: ['In transito', ''], in_consegna: ['In consegna', ''],
  consegnata: ['Consegnata', 'bene'], in_giacenza: ['In giacenza', 'problema'], non_consegnato: ['Non consegnata', 'problema'],
  reso_mittente: ['Reso al mittente', 'problema'], annullata: ['Annullata', 'fermo'], storno_richiesto: ['Storno richiesto', 'fermo'],
  annullamento_pending: ['In annullamento', 'fermo'],
}

// ── 01 · Le spedizioni ──
function Spedizioni({ data, giornata }: { data: any; giornata: any }) {
  const giac = usaJson<any>('/api/spedizioni/lista?page=1&perPage=5&stato=in_giacenza')
  const ultime: any[] = data?.ultimeSpedizioni || []
  const hm = (s: string) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
  const gg = (s: string) => { const d = new Date(s); return `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}` }
  return (
    <section aria-labelledby="pn-t-sped">
      <Testa segno="furgone" occhiello="01 · Le spedizioni" titolo={<span id="pn-t-sped">Chi parte, chi arriva, <b>chi aspetta te</b></span>}
        numeri={[{ v: <Conta v={giornata?.create || 0}>{n => fmtN.format(n)}</Conta>, l: 'create oggi' }, { v: <Conta v={Number(data?.spediteOggi || 0)}>{n => fmtN.format(n)}</Conta>, l: 'partite oggi' }]} />
      <div className="pn-griglia pn-g2">
        <div className="pn-scheda gx-vetro">
          <div className="pn-testa"><h3>Le ultime spedizioni</h3><a href="/dashboard/spedizioni">Elenco spedizioni</a></div>
          {ultime.length ? (
            <table className="pn-tab"><tbody>
              {ultime.slice(0, 8).map(s => {
                const st = STATO[s.stato] || [s.stato, '']
                return (
                  <tr key={s.id}>
                    <td className="pn-ora">{hm(s.created_at)}</td>
                    <td className="pn-citta">{String(s.dest_citta || '').toUpperCase()}</td>
                    <td className="pn-chi">{s.dest_nome}</td>
                    <td className="pn-cod"><a href={`/dashboard/spedizioni?numero=${encodeURIComponent(s.tracking_number || s.numero || '')}`}>{s.tracking_number || s.numero}</a></td>
                    <td><span className={'pn-stato' + (st[1] ? ' pn-stato--' + st[1] : '')}>{st[0]}</span></td>
                  </tr>
                )
              })}
            </tbody></table>
          ) : <div className="pn-vuoto">Ancora nessuna spedizione.</div>}
        </div>
        <div className="pn-scheda gx-vetro">
          <div className="pn-testa"><h3>Giacenze da risolvere</h3><a href="/dashboard/spedizioni/giacenze">Tutte le {fmtN.format(Number(data?.inGiacenza || 0))}</a></div>
          {giac?.rows?.length ? (
            <ul className="pn-giac">
              {giac.rows.map((s: any) => (
                <li key={s.id}>
                  <div><b>{s.dest_nome} · {s.dest_citta}</b><span><i>dal {gg(s.giacenza_data || s.created_at)}</i>{s.giacenza_motivo ? ' · ' + String(s.giacenza_motivo).toLowerCase() : ''}</span></div>
                  <a className="pn-btn" href="/dashboard/spedizioni/giacenze">Istruzioni</a>
                </li>
              ))}
            </ul>
          ) : <div className="pn-vuoto">{giac ? 'Nessuna giacenza da risolvere.' : '…'}</div>}
        </div>
      </div>
    </section>
  )
}

// ── 02 · Come sta andando ──
function Andamento({ data }: { data: any }) {
  const analisi = usaJson<any>('/api/resi/analisi?giorni=90&riepilogo=1')
  const s: Record<string, number> = data?.statiUltimi30 || {}
  const somma = (k: string[]) => k.reduce((a, x) => a + Number(s[x] || 0), 0)
  const inCorso = somma(['in_lavorazione', 'spedita', 'in_transito', 'in_consegna']), bene = somma(['consegnata'])
  const problemi = somma(['in_giacenza', 'non_consegnato', 'reso_mittente']), altro = somma(['annullata', 'storno_richiesto', 'annullamento_pending'])
  const tot = inCorso + bene + problemi + altro
  const pct = (n: number) => tot ? Math.round(n / tot * 100) : 0
  return (
    <section aria-labelledby="pn-t-stato">
      <Testa segno="consegna" occhiello="02 · Come sta andando" titolo={<span id="pn-t-stato">Gli ultimi <b>30 giorni</b> e gli ultimi <b>mesi</b></span>}
        numeri={[{ v: <>{String(data?.tassoConsegna ?? 0).replace('.', ',')}<small>%</small></>, l: 'consegnate da sempre' }, ...(analisi ? [{ v: <>{String(analisi.totale?.pct ?? 0).replace('.', ',')}<small>%</small></>, l: 'resi a 90 giorni' }] : [])]} />
      <div className="pn-griglia pn-g2b">
        <div className="pn-scheda gx-vetro">
          <div className="pn-testa"><h3>Stato delle spedizioni</h3><span>ultimi 30 giorni</span></div>
          <div className="pn-grande"><b><Conta v={tot}>{n => fmtN.format(n)}</Conta></b><span>spedizioni</span></div>
          <div className="pn-barra-stati" role="img" aria-label={`In corso ${inCorso}, consegnate ${bene}, problemi ${problemi}, altro ${altro}`}>
            {inCorso > 0 && <i className="pn-trama-piena" style={{ flex: inCorso }} />}{bene > 0 && <i className="pn-trama-bene" style={{ flex: bene }} />}
            {problemi > 0 && <i className="pn-trama-problema" style={{ flex: problemi }} />}{altro > 0 && <i className="pn-trama-altro" style={{ flex: altro }} />}
          </div>
          <ul className="pn-legenda">
            <li><i className="pn-trama-piena" />In corso<b>{fmtN.format(inCorso)}</b><em>in lavorazione {fmtN.format(s.in_lavorazione || 0)} · spedite {fmtN.format(s.spedita || 0)} · in transito {fmtN.format(s.in_transito || 0)} · in consegna {fmtN.format(s.in_consegna || 0)}</em></li>
            <li><i className="pn-trama-bene" />Consegnate<b>{fmtN.format(bene)}</b><em>{pct(bene)}% del totale</em></li>
            <li><i className="pn-trama-problema" />Problemi<b>{fmtN.format(problemi)}</b><em>resi {fmtN.format(s.reso_mittente || 0)} · giacenza {fmtN.format(s.in_giacenza || 0)} · non consegnate {fmtN.format(s.non_consegnato || 0)}</em></li>
            <li><i className="pn-trama-altro" />Altro<b>{fmtN.format(altro)}</b><em>annullate {fmtN.format(s.annullata || 0)} · in annullamento {fmtN.format((s.annullamento_pending || 0) + (s.storno_richiesto || 0))}</em></li>
          </ul>
        </div>
        <div className="pn-scheda gx-vetro">
          <div className="pn-testa"><h3>Spedizioni per mese</h3><span>il mese in corso fino a oggi</span></div>
          <Colonne3D mesi={data?.statsMensili || []} />
        </div>
      </div>
    </section>
  )
}

// statsMensili porta il mese all'inglese («Jul 26», dalla funzione del database): qui in italiano, «luglio»
const INGLESE: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 }
function meseItaliano(m: any) {
  const s = String(m || '').trim(), i = INGLESE[s.slice(0, 3).toLowerCase()]
  return i === undefined ? s.toLowerCase() : MESI[i]
}

// Le colonne dei mesi in 3D coi fogli di stile: una scatola per mese (fronte, cima, fianchi) su una lastra, la
// prospettiva la fa il browser. Il mese in corso è arancio, gli altri gesso di giorno e ardesia di notte.
function Colonne3D({ mesi }: { mesi: any[] }) {
  const ultimi = mesi.slice(-6)
  if (!ultimi.length) return <div className="pn-vuoto">Ancora nessun mese da mostrare.</div>
  const max = Math.max(1, ...ultimi.map(m => Number(m.totale || 0)))
  const passi = [10, 20, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000, 10000, 20000, 25000, 50000], tacca = passi.find(p => max / p <= 3) || 100000
  const cima = Math.ceil(max / tacca) * tacca
  const n = ultimi.length, L = 100 / n
  return (
    <div className="pn-col3d" role="img" aria-label={'Spedizioni per mese: ' + ultimi.map(m => `${m.mese} ${m.totale}`).join(', ')}>
      <div className="pn-col3d__palco">
        {Array.from({ length: Math.round(cima / tacca) + 1 }, (_, i) => i * tacca).map(v => (
          <div key={v} className="pn-col3d__riga" style={{ bottom: (v / cima * 100) + '%' }}><span>{fmtN.format(v)}</span></div>
        ))}
        <div className="pn-col3d__lastra"><i className="pn-f-sopra" /><i className="pn-f-fronte" /></div>
        {ultimi.map((m, i) => {
          const h = Number(m.totale || 0) / cima * 100, ora = i === n - 1
          return (
            <div key={i} className={'pn-col3d__colonna' + (ora ? ' pn-col3d__colonna--ora' : '')} title={`${m.mese}: ${fmtN.format(m.totale)} spedizioni · ${euroPiano(Number(m.importo || 0))}`}
              style={{ left: `calc(${i * L + L * .29}%)`, width: `${L * .42}%`, height: h + '%', ['--prof' as any]: '34px', ['--mezzo' as any]: '17px', transitionDelay: (0.15 + i * 0.11) + 's' }}>
              <i className="pn-f-sopra" /><i className="pn-f-sx" /><i className="pn-f-dx" /><i className="pn-f-fronte" />
              <span className="pn-col3d__valore">{fmtN.format(Number(m.totale || 0))}</span>
              <span className="pn-col3d__mese">{meseItaliano(m.mese)}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 03 · I soldi: i riquadri del Report Guadagno di oggi, con UN periodo per tutti ──
type Periodo = { nome: string; da: Date; a: Date; titolo: string; breve: string }
function periodo(nome: string, da?: Date, a?: Date): Periodo {
  const oggi = new Date(), lun = giorno(oggi, -((oggi.getDay() + 6) % 7))
  const dalAl = (d: Date, b: Date) => iso(d) === iso(b) ? `il ${d.getDate()} ${MESI[d.getMonth()]}` : d.getMonth() === b.getMonth() ? `dal ${d.getDate()} al ${b.getDate()} ${MESI[b.getMonth()]}` : `dal ${d.getDate()} ${MESI[d.getMonth()]} al ${b.getDate()} ${MESI[b.getMonth()]}`
  if (nome === 'oggi') return { nome, da: oggi, a: oggi, titolo: 'oggi', breve: 'Oggi' }
  if (nome === 'settimana') return { nome, da: lun, a: oggi, titolo: 'questa settimana', breve: 'Questa settimana' }
  if (nome === 'scorso') { const d = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); return { nome, da: d, a: new Date(oggi.getFullYear(), oggi.getMonth(), 0), titolo: MESI[d.getMonth()], breve: 'Mese scorso' } }
  if (nome === 'date' && da && a) return { nome, da, a, titolo: dalAl(da, a), breve: `${da.getDate()}–${a.getDate()} ${MESI[a.getMonth()].slice(0, 3)}` }
  return { nome: 'mese', da: new Date(oggi.getFullYear(), oggi.getMonth(), 1), a: oggi, titolo: MESI[oggi.getMonth()] + ', fino a oggi', breve: 'Questo mese' }
}
const VOCI: { k: string; nome: string; url: string; segno: string; href: string }[] = [
  { k: 'rettifiche', nome: 'Rettifiche', url: '/api/reports/guadagno-rettifiche', segno: 'bilancia', href: '/dashboard/reports/rettifiche' },
  { k: 'resi', nome: 'Resi', url: '/api/reports/guadagno-resi', segno: 'resi', href: '/dashboard/reports/resi' },
  { k: 'giacenze', nome: 'Giacenze', url: '/api/reports/guadagno-giacenze', segno: 'gabbia', href: '/dashboard/reports/giacenze' },
  { k: 'logistica', nome: 'Logistica', url: '/api/reports/guadagno-logistica', segno: 'piano', href: '/dashboard/logistica/addebiti' },
  { k: 'consumabili', nome: 'Consumabili', url: '/api/reports/guadagno-consumabili', segno: 'pacco', href: '/dashboard/reports/consumabili' },
]

function Soldi({ data }: { data: any }) {
  // il periodo si calcola dopo l'apertura: «oggi» del server (UTC su Vercel) e del browser possono essere giorni diversi
  const [p, setP] = useState<Periodo | null>(null)
  useEffect(() => { setP(periodo('mese')) }, [])
  const [cal, setCal] = useState(false)
  const [voce, setVoce] = useState<string | null>(null)
  const tema = useContext(GraficaNuova).tema
  const q = p ? `?dal=${iso(p.da)}&al=${iso(p.a)}` : null
  const su = (u: string) => q ? u + q : null
  const tot = usaJson<any>(su('/api/reports/guadagno-totale'))
  const sped = usaJson<any>(su('/api/reports/guadagno'))
  const voci = [usaJson<any>(su(VOCI[0].url)), usaJson<any>(su(VOCI[1].url)), usaJson<any>(su(VOCI[2].url)), usaJson<any>(su(VOCI[3].url)), usaJson<any>(su(VOCI[4].url))]
  const gest = usaJson<any>(su('/api/costi-gestione'))
  const vediGestione = tot?.costiGestione !== undefined
  // di cosa è fatto il Guadagno totale: le voci in positivo; il resto (commissioni, accessori, rimborsi) è «altre voci»
  const parti = [{ k: 'spedizioni', nome: 'Spedizioni', g: Number(sped?.guadagno || 0) }, ...VOCI.map((v, i) => ({ k: v.k, nome: v.nome, g: Number(voci[i]?.guadagno || 0) }))]
  const altre = Number(tot?.guadagno || 0) - parti.reduce((a, x) => a + x.g, 0)
  if (altre > 0.005) parti.push({ k: 'altre', nome: 'Altre voci', g: altre })
  const pos = parti.filter(x => x.g > 0.005), somma = pos.reduce((a, x) => a + x.g, 0) || 1
  const margine = tot?.ricavi ? (tot.guadagno / tot.ricavi * 100) : 0
  return (
    <section aria-labelledby="pn-t-soldi" onPointerLeave={() => setVoce(null)}>
      <Testa segno="monete" occhiello="03 · I soldi" titolo={<span id="pn-t-soldi">Il guadagno di <b>{p ? p.titolo : '…'}</b></span>}
        frase={tot ? `Incassato ${euroPiano(tot.ricavi || 0)}, costi ${euroPiano(tot.costi || 0)}: il margine è del ${margine.toFixed(1).replace('.', ',')}%.` : '…'} />
      <div className="pn-periodo">
        <div className="pn-periodo__scelte gx-vetro gx-pillola" role="group" aria-label="Periodo di tutti i riquadri dei soldi">
          {[['oggi', 'Oggi'], ['settimana', 'Questa settimana'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso']].map(([n, t]) => <button key={n} type="button" aria-pressed={p?.nome === n} onClick={() => { setCal(false); setP(periodo(n)) }}>{t}</button>)}
          <button type="button" className="pn-periodo__date" aria-pressed={p?.nome === 'date'} aria-expanded={cal} onClick={() => setCal(c => !c)}><Icona id="i-calendario" />{p?.nome === 'date' ? p.breve : 'Scegli le date'}</button>
        </div>
        <span className="pn-periodo__nota">Vale per tutti i riquadri qui sotto</span>
        {cal && p && <Calendario attuale={p} chiudi={() => setCal(false)} scegli={(x) => { setP(x); setCal(false) }} />}
      </div>

      <div className={'pn-griglia pn-soldi-alto' + (voce ? ' pn-una-voce' : '')}>
        <div className="pn-scheda gx-vetro">
          <div className="pn-testa"><h3>Guadagno totale</h3><a href="/dashboard/statistiche/profitto">Report guadagno</a></div>
          <b className={'pn-gt__n' + (Number(tot?.guadagno) < 0 ? ' pn-meno' : '')}>{tot ? <Conta v={Number(tot.guadagno)}>{n => <Euro v={n} />}</Conta> : '…'}</b>
          <div className="pn-righe-ic"><span>Incassato <b>{tot ? euroPiano(tot.ricavi) : '…'}</b></span><span>Costo <b>{tot ? euroPiano(tot.costi) : '…'}</b></span></div>
          <div className="pn-comp" role="img" aria-label={'Il guadagno totale per voce: ' + pos.map(x => `${x.nome} ${euroPiano(x.g)}`).join(', ')}>
            <div className="pn-comp__barra">{pos.map(x => <i key={x.k} data-voce={x.k} className={voce === x.k ? 'pn-acceso' : undefined} style={{ flex: x.g }} title={`${x.nome} ${euroPiano(x.g)}`} onPointerEnter={() => setVoce(x.k)} />)}</div>
            <ul className="pn-comp__legenda">{pos.map(x => <li key={x.k} data-voce={x.k}><i />{x.nome}<b>{Math.round(x.g / somma * 100)}%</b></li>)}</ul>
          </div>
          {vediGestione && (
            <div className="pn-gt__netto">
              <div><span>Costi di gestione</span><b><Euro v={Number(tot.costiGestione || 0)} segno={Number(tot.costiGestione) > 0} /></b></div>
              <div className="pn-gt__utile"><span>Utile netto</span><b className={Number(tot.utileNetto) < 0 ? 'pn-meno' : undefined}><Euro v={Number(tot.utileNetto || 0)} /></b></div>
              <p><Icona id="i-lucchetto" />Queste due righe le vedete solo tu e i tuoi admin</p>
            </div>
          )}
        </div>
        <div className={'pn-scheda gx-vetro pn-gs' + (voce === 'spedizioni' ? ' pn-acceso' : '')} onPointerEnter={() => setVoce('spedizioni')}>
          <div className="pn-testa"><h3>Guadagno spedizioni</h3><span>le rettifiche hanno il loro riquadro</span></div>
          <div className="pn-gs__fila">
            <div><span>Margine</span><b className={'pn-gs__n' + (Number(sped?.guadagno) < 0 ? ' pn-meno' : '')}>{sped ? <Conta v={Number(sped.guadagno)}>{n => <Euro v={n} />}</Conta> : '…'}</b></div>
            <div><span>Fatturato</span><b>{sped ? euroPiano(sped.ricavi) : '…'}</b></div>
            <div><span>Costi</span><b>{sped ? euroPiano(sped.costi) : '…'}</b></div>
            <div><span>Media a spedizione</span><b>{sped ? euroPiano(sped.mediaSped || 0) : '…'}</b><em>{sped ? fmtN.format(sped.numSpedizioni || 0) + ' spedizioni' : ''}</em></div>
          </div>
          <GraficoMargine serie={sped?.serie || []} chiave={q || ''} tema={tema} />
        </div>
      </div>

      <div className={'pn-griglia pn-soldi-voci' + (voce ? ' pn-una-voce' : '')}>
        {VOCI.map((v, i) => {
          const d = voci[i]
          return (
            <a key={v.k} className={'pn-voce gx-vetro' + (voce === v.k ? ' pn-acceso' : '')} href={v.href} onPointerEnter={() => setVoce(v.k)}>
              <img className="pn-segno-s" src={`/grafica/segni/${v.segno}-${tema}.webp`} alt="" />
              <h3>{v.nome}</h3>
              <b className={Number(d?.guadagno) < 0 ? 'pn-meno' : undefined}>{d ? <Conta v={Number(d.guadagno || 0)}>{n => <Euro v={n} />}</Conta> : '…'}</b>
              <p>Incassato <span>{d ? euroPiano(Number(d.ricavi || 0)) : '…'}</span> · costo <span>{d ? euroPiano(Number(d.costi || 0)) : '…'}</span></p>
            </a>
          )
        })}
        {vediGestione && (
          <a className="pn-voce pn-voce--gestione gx-vetro" href="/dashboard/costi-gestione">
            <img className="pn-segno-s" src={`/grafica/segni/cassa-${tema}.webp`} alt="" />
            <h3>Costi di gestione</h3>
            <b>{gest ? <Euro v={Number(gest.totale || 0)} segno={Number(gest.totale) > 0} /> : '…'}</b>
            {gest?.perCategoria?.length
              ? <ul>{gest.perCategoria.slice(0, 4).map((c: any) => <li key={c.categoria}><span>{c.categoria}</span><b>{euroPiano(Number(c.importo || 0))}</b></li>)}</ul>
              : <p>{gest ? 'Nessun costo segnato nel periodo · Aggiungili' : '…'}</p>}
          </a>
        )}
      </div>

      <p className="pn-adesso"><span>Adesso</span>I saldi aperti di oggi: non cambiano col periodo.</p>
      <div className="pn-recupero gx-vetro">
        <div><span>Da recuperare a scalare</span><b className="pn-meno"><Euro v={Number(data?.creditiDaRecuperare?.scalare?.totale || 0)} /></b><em>{fmtN.format(data?.creditiDaRecuperare?.scalare?.clienti || 0)} clienti bloccati finché non ricaricano</em></div>
        <div><span>Da recuperare a fattura</span><b><Euro v={Number(data?.creditiDaRecuperare?.fattura?.totale || 0)} /></b><em>{fmtN.format(data?.creditiDaRecuperare?.fattura?.clienti || 0)} clienti, spediscono normalmente</em></div>
        <div><span>Contrassegni da rimettere</span><b><Euro v={Number(data?.codDaRimettere || 0)} /></b><em>ai tuoi clienti</em></div>
        <div><span>Conto proprio</span><b className={Number(data?.creditoMaster?.proprio) < 0 ? 'pn-meno' : undefined}><Euro v={Number(data?.creditoMaster?.proprio || 0)} /></b><em>i tuoi contratti · <a href="/dashboard/movimenti">Movimenti</a></em></div>
      </div>
    </section>
  )
}

function GraficoMargine({ serie, chiave, tema }: { serie: any[]; chiave: string; tema: string }) {
  if (!serie.length) return <div className="pn-vuoto">Nessuna spedizione nel periodo.</div>
  const W = 680, H = 210, l = 52, top = 12, b = 26
  const max = Math.max(1, ...serie.map(s => Number(s.margine || 0)))
  const passi = [5, 10, 20, 25, 50, 100, 150, 200, 250, 500, 1000, 1500, 2000, 2500, 5000, 10000], tacca = passi.find(x => max / x <= 3) || 20000
  const cima = Math.ceil(max / tacca) * tacca, Y = (y: number) => top + (1 - y / cima) * (H - top - b)
  const w = (W - l) / serie.length, ogni = Math.max(1, Math.ceil(serie.length / 8))
  const et = (g: string) => g.length === 7 ? MESI[+g.slice(5, 7) - 1].slice(0, 3) : `${g.slice(8, 10)}/${g.slice(5, 7)}`
  const festa = (g: string) => { if (g.length !== 10) return false; const d = new Date(g + 'T12:00:00'); return d.getDay() === 0 || d.getDay() === 6 }
  return (
    <svg key={chiave + tema} className="pn-grafico" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Margine delle spedizioni: ' + serie.map(s => `${et(s.giorno)} ${euroPiano(Number(s.margine || 0))}`).join('; ')}>
      <defs>
        <pattern id="pn-mp" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="var(--gx-inchiostro)" opacity=".85" /></pattern>
        <pattern id="pn-ma" width="4" height="4" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="var(--gx-accento)" /></pattern>
      </defs>
      {Array.from({ length: Math.round(cima / tacca) + 1 }, (_, i) => i * tacca).map(y => (
        <g key={y}><line x1={l} x2={W} y1={Y(y)} y2={Y(y)} stroke="var(--gx-filo)" /><text x={l - 10} y={Y(y) + 4} textAnchor="end" fontSize="11" fill="var(--gx-attenuato)">€ {fmtN.format(y)}</text></g>
      ))}
      {serie.map((s, i) => {
        const v = Math.max(0, Number(s.margine || 0)), bw = Math.min(w * .6, 34), x = l + i * w + (w - bw) / 2, ultimo = i === serie.length - 1
        return <rect key={s.giorno} className="pn-cresce" style={{ animationDelay: i * 18 + 'ms' }} x={x} y={Y(v)} width={bw} height={Math.max(1, Y(0) - Y(v))} rx="3"
          fill={`url(#${ultimo ? 'pn-ma' : 'pn-mp'})`} opacity={festa(s.giorno) ? .45 : 1}><title>{et(s.giorno)}: {euroPiano(Number(s.margine || 0))}</title></rect>
      })}
      {serie.map((s, i) => (i % ogni === 0 ? <text key={'t' + s.giorno} x={l + i * w + w / 2} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--gx-attenuato)">{et(s.giorno)}</text> : null))}
    </svg>
  )
}

// il calendario: lo stesso di oggi (due mesi affiancati e le scorciatoie a destra), con «Questa settimana» in più
function Calendario({ attuale, chiudi, scegli }: { attuale: Periodo; chiudi: () => void; scegli: (p: Periodo) => void }) {
  const oggi = new Date()
  const [vista, setVista] = useState(new Date(attuale.a.getFullYear(), attuale.a.getMonth(), 1))
  const [sel, setSel] = useState<{ da: Date; a: Date | null }>({ da: attuale.da, a: attuale.a })
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const fuori = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node) && !(e.target as HTMLElement).closest('.pn-periodo__date')) chiudi() }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') chiudi() }
    document.addEventListener('mousedown', fuori); document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', fuori); document.removeEventListener('keydown', esc) }
  }, [chiudi])
  const k = (d: Date) => +iso(d).replace(/-/g, '')
  const mesi = [new Date(vista.getFullYear(), vista.getMonth() - 1, 1), vista]
  const clic = (d: Date) => setSel(s => s.a === null ? (k(d) < k(s.da) ? { da: d, a: s.da } : { da: s.da, a: d }) : { da: d, a: null })
  return (
    <div className="pn-cal gx-vetro" ref={box} role="dialog" aria-label="Scegli le date">
      <div className="pn-cal__mesi">
        {mesi.map((m0, j) => {
          const primo = (m0.getDay() + 6) % 7, nGiorni = new Date(m0.getFullYear(), m0.getMonth() + 1, 0).getDate()
          const ultimoMese = m0.getFullYear() === oggi.getFullYear() && m0.getMonth() === oggi.getMonth()
          return (
            <div className="pn-cal__mese" key={j}>
              <div className="pn-cal__testa">
                {j === 0 ? <button type="button" className="pn-cal__frecce" aria-label="Mese prima" onClick={() => setVista(new Date(vista.getFullYear(), vista.getMonth() - 1, 1))}>‹</button> : <span />}
                <b>{MESI[m0.getMonth()]} {m0.getFullYear()}</b>
                {j === 1 ? <button type="button" className="pn-cal__frecce" aria-label="Mese dopo" disabled={ultimoMese} onClick={() => setVista(new Date(vista.getFullYear(), vista.getMonth() + 1, 1))}>›</button> : <span />}
              </div>
              <div className="pn-cal__giorni">
                {['lu', 'ma', 'me', 'gi', 've', 'sa', 'do'].map(x => <i key={x}>{x}</i>)}
                {Array.from({ length: primo }, (_, i) => <span key={'v' + i} />)}
                {Array.from({ length: nGiorni }, (_, i) => {
                  const d = new Date(m0.getFullYear(), m0.getMonth(), i + 1), kd = k(d)
                  const dentro = sel.a && kd >= k(sel.da) && kd <= k(sel.a), capo = kd === k(sel.da) || (sel.a && kd === k(sel.a))
                  return <button key={i} type="button" disabled={kd > k(oggi)} onClick={() => clic(d)} className={[dentro ? 'pn-dentro' : '', capo ? 'pn-capo' : '', kd === k(oggi) ? 'pn-oggi' : ''].join(' ').trim() || undefined}>{i + 1}</button>
                })}
              </div>
            </div>
          )
        })}
      </div>
      <div className="pn-cal__lato">
        <ul>
          {[['oggi', 'Oggi'], ['ieri', 'Ieri'], ['settimana', 'Questa settimana'], ['7g', 'Ultimi 7 giorni'], ['30g', 'Ultimi 30 giorni'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso']].map(([n, t]) => (
            <li key={n}><button type="button" onClick={() => scegli(
              n === 'ieri' ? periodo('date', giorno(oggi, -1), giorno(oggi, -1)) : n === '7g' ? periodo('date', giorno(oggi, -6), oggi) : n === '30g' ? periodo('date', giorno(oggi, -29), oggi) : periodo(n)
            )}>{t}</button></li>
          ))}
        </ul>
        <p className="pn-cal__scelta">{sel.a ? periodo('date', sel.da, sel.a).titolo : `dal ${sel.da.getDate()} ${MESI[sel.da.getMonth()]} al…`}</p>
        <div className="pn-cal__bottoni">
          <button type="button" className="pn-btn" onClick={chiudi}>Annulla</button>
          <button type="button" className="pn-btn pn-btn--pieno" disabled={!sel.a} onClick={() => sel.a && scegli(periodo('date', sel.da, sel.a))}>Applica</button>
        </div>
      </div>
    </div>
  )
}

// ── 04 · Dove vanno: le province colorate per volume (ultimi 30 giorni), passando sopra si accende la provincia ──
const SCALA: Record<string, string[]> = { giorno: ['#FBE3CC', '#F9B27A', '#F0742A', '#C9460C'], notte: ['#3A4462', '#9A5A3A', '#E8702A', '#FF8A3D'] }
function colore(n: number, max: number, tema: string) {
  if (!n) return tema === 'notte' ? '#2B3651' : '#EEF0F4'
  const u = Math.pow(Math.sqrt(n) / Math.sqrt(max), 0.85) * 3, i = Math.min(2, Math.floor(u)), t = u - i
  const a = SCALA[tema][i], b = SCALA[tema][i + 1]
  const mix = (x: string, y: string) => [1, 3, 5].map(j => Math.round(parseInt(x.slice(j, j + 2), 16) * (1 - t) + parseInt(y.slice(j, j + 2), 16) * t))
  const [r, g, bl] = mix(a, b); return `rgb(${r},${g},${bl})`
}
// «all'estero» = la somma dei paesi diversi dall'Italia. Prima era totalePaesi − totale, che contava anche le
// spedizioni italiane senza provincia (284 invece di 13 su Ecomize LL, 27/10)
function Dove() {
  const dati = usaJson<any>('/api/dashboard/destinazioni')
  const topo = usaJson<any>('/geo/italia-province.json')
  const g = useContext(GraficaNuova)
  const tema = g.tema
  const [sopra, setSopra] = useState<string | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)
  const W = 520, H = 600
  const forme = useMemo(() => {
    if (!topo) return null
    try {
      const fc: any = feature(topo, topo.objects[Object.keys(topo.objects)[0]])
      const proiezione = geoMercator().fitSize([W, H], fc), path = geoPath(proiezione)
      return fc.features.map((f: any) => ({ d: path(f) || '', sigla: String(f.properties?.prov_acr || '').toUpperCase(), nome: String(f.properties?.prov_name || ''), c: path.centroid(f) }))
    } catch { return null }
  }, [topo])
  const perSigla = useMemo(() => { const m = new Map<string, any>(); for (const p of (dati?.province || [])) m.set(p.sigla, p); return m }, [dati])
  const max = Math.max(1, ...(dati?.province || []).map((p: any) => p.n))
  const top = (dati?.province || []).slice().sort((a: any, b: any) => b.n - a.n).slice(0, 8)
  const nomeDi = (s: string) => forme?.find((f: any) => f.sigla === s)?.nome || s
  const fSopra = sopra && forme?.find((f: any) => f.sigla === sopra)
  return (
    <section aria-labelledby="pn-t-dove">
      <Testa segno="dove" occhiello="04 · Dove vanno" titolo={<span id="pn-t-dove">L&apos;Italia della <b>tua rete</b></span>} frase="Ogni provincia è più arancio quante più spedizioni riceve, negli ultimi 30 giorni."
        numeri={dati ? [{ v: fmtN.format(dati.totale || 0), l: 'in Italia' }, { v: fmtN.format(dati.nProvince || 0), l: 'province' }, { v: fmtN.format((dati.paesi || []).filter((x: any) => String(x.code).toUpperCase() !== 'IT').reduce((t: number, x: any) => t + Number(x.n || 0), 0)), l: "all'estero" }] : undefined} />
      <div className="pn-dove">
        <div className="pn-mappa gx-vetro" onPointerLeave={() => { setSopra(null); setPos(null) }}>
          {forme ? (
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={'Spedizioni per provincia: ' + top.map((p: any) => `${nomeDi(p.sigla)} ${p.n}`).join(', ')}>
              {forme.map((f: any, i: number) => {
                const p = perSigla.get(f.sigla)
                return <path key={i} d={f.d} fill={colore(p?.n || 0, max, tema)} style={{ transition: `fill .7s ease ${(f.c[1] / H * 0.9).toFixed(2)}s, opacity .15s` }} stroke={tema === 'notte' ? '#171E2B' : '#FFFFFF'} strokeWidth={sopra === f.sigla ? 1.6 : 0.5}
                  opacity={sopra && sopra !== f.sigla ? .55 : 1}
                  onPointerEnter={() => { setSopra(f.sigla); setPos({ x: f.c[0] / W * 100, y: f.c[1] / H * 100 }) }} />
              })}
            </svg>
          ) : <div className="pn-vuoto">…</div>}
          {fSopra && pos && (() => { const p = perSigla.get(sopra!); return (
            <span className="pn-mappa__volante gx-vetro gx-pillola" style={{ left: `calc(18px + (100% - 36px) * ${pos.x / 100})`, top: `calc(18px + (100% - 60px) * ${pos.y / 100})` }}>
              <b>{fSopra.nome}</b>{p ? <>{fmtN.format(p.n)} spedizioni · {String(p.perc).replace('.', ',')}%</> : 'nessuna spedizione'}
            </span>) })()}
          <div className="pn-mappa__scala"><span>poche</span><i style={{ background: `linear-gradient(90deg, ${SCALA[tema].join(',')})` }} /><span>molte spedizioni</span></div>
        </div>
        <div className="pn-scheda gx-vetro">
          <div className="pn-testa"><h3>Destinazioni principali</h3><span>ultimi 30 giorni</span></div>
          {top.length ? (
            <ul className="pn-province">
              {top.map((p: any, i: number) => (
                <li key={p.sigla} data-acceso={sopra === p.sigla ? '' : undefined} onPointerEnter={() => setSopra(p.sigla)} onPointerLeave={() => setSopra(null)}>
                  <span>{String(i + 1).padStart(2, '0')}</span><span>{nomeDi(p.sigla)}<small>{p.sigla}</small></span><b>{fmtN.format(p.n)}</b>
                  <span className="pn-barra-p"><i style={{ width: (p.n / max * 100) + '%' }} /></span><em>{String(p.perc).replace('.', ',')}%</em>
                </li>
              ))}
            </ul>
          ) : <div className="pn-vuoto">{dati ? 'Nessuna spedizione negli ultimi 30 giorni.' : '…'}</div>}
        </div>
      </div>
    </section>
  )
}

// ── 05 · La rete ──
function Rete({ data }: { data: any }) {
  const analisi = usaJson<any>('/api/resi/analisi?giorni=90&riepilogo=1')
  const peggiori: any[] = analisi?.peggiori || []
  return (
    <section aria-labelledby="pn-t-rete">
      <Testa segno="rete" occhiello="05 · La rete" titolo={<span id="pn-t-rete">Te e <b>chi sta sotto di te</b></span>} frase="Da sempre, e i clienti con più resi negli ultimi 90 giorni." />
      <div className="pn-griglia pn-g4">
        <div className="pn-rete-n gx-vetro"><b><Conta v={Number(data?.spedizioniTotali || 0)}>{n => fmtN.format(n)}</Conta></b><span>spedizioni da sempre</span></div>
        <div className="pn-rete-n gx-vetro"><b><Conta v={Number(data?.clientiTotali || 0)}>{n => fmtN.format(n)}</Conta></b><span>clienti</span></div>
        <div className="pn-rete-n gx-vetro"><b><Conta v={Number(data?.sottomaster || 0)}>{n => fmtN.format(n)}</Conta></b><span>sotto-master</span></div>
        <div className="pn-rete-n gx-vetro"><b><Conta v={Number(data?.topCorriere?.n || 0)}>{n => fmtN.format(n)}</Conta></b><span>{data?.topCorriere?.nome ? `con ${data.topCorriere.nome}, il corriere più usato` : 'il corriere più usato'}</span></div>
      </div>
      <div className="pn-scheda gx-vetro" style={{ marginTop: 12 }}>
        <div className="pn-testa"><h3>Resi per cliente</h3><a href="/dashboard/resi/analisi">Analisi resi</a></div>
        {peggiori.length ? (
          <ul className="pn-resi">
            {peggiori.map((c: any) => (
              <li key={c.id}>
                <div>{c.nome}<span>{fmtN.format(c.resi)} resi su {fmtN.format(c.partite)}</span></div>
                <span className="pn-barra-p"><i style={{ width: Math.min(100, c.pct / Math.max(1, peggiori[0].pct) * 100) + '%', ...(c.livello === 'rosso' ? { filter: 'hue-rotate(-25deg)' } : {}) }} /></span>
                <b className={c.livello === 'rosso' ? 'pn-meno' : undefined}>{String(c.pct).replace('.', ',')}%</b>
              </li>
            ))}
          </ul>
        ) : <div className="pn-vuoto">{analisi ? 'Nessun cliente con resi da segnalare.' : '…'}</div>}
      </div>
    </section>
  )
}
