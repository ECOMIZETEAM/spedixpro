'use client'
// LA PLANCIA «RIVISTA» (Proposta C, 27/10). La home come una rivista di design scritta ogni mattina dai numeri del
// master: sette capitoli, uno per schermata, ognuno con UN numero protagonista e una frase. Accanto, un pannello che
// resta fermo mentre si legge e cambia tavola a ogni capitolo (le foto del magazzino rese dallo studio, o un grafico).
// Numeri: le stesse rotte della Plancia v11 (useDatiPlancia + le rotte dei soldi, delle destinazioni, dei resi, delle
// giacenze), solo letture. Niente segue il mouse; con prefers-reduced-motion tutto è fermo e subito visibile.
import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Archivo } from 'next/font/google'
import { useDatiPlancia } from '../dati'
import { Conta, useScorrimentoMorbido } from '../../movimento'
import { fmtN, MESI, GIORNI, iso, suQuattroPunti } from '../../PlanciaNuova'
import { Icona } from '../../icone'
import { Atlante, Margine, Mesi, Orario, meseDi } from './tavole'
import './rivista.css'

// Archivo: un grottesco con l'asse della larghezza (62–125). Una sola famiglia fa la testata e i numeri larghi e
// sottili (larghezza 125, peso 100–200, il tono dei cataloghi di design industriale), i titoli a larghezza normale e
// gli occhielli stretti. Niente graziato: è il segno delle riviste d'architettura, non quello delle chat.
const archivo = Archivo({ subsets: ['latin'], axes: ['wdth'], variable: '--font-rivista', display: 'swap' })

const CAPITOLI = [
  { k: 'copertina', n: '01', nome: 'Copertina' },
  { k: 'fare', n: '02', nome: 'Da fare adesso' },
  { k: 'giornata', n: '03', nome: 'La giornata' },
  { k: 'mese', n: '04', nome: 'Il mese' },
  { k: 'soldi', n: '05', nome: 'I soldi' },
  { k: 'dove', n: '06', nome: 'Dove' },
  { k: 'rete', n: '07', nome: 'La rete e i resi' },
]
const FOTO_CAP = [0, 1, 6]

const n = (x: number) => fmtN.format(Math.round(Number(x) || 0))
const fmtE = new Intl.NumberFormat('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' as any })
const euroPiano = (v: number) => (v < -0.004 ? '−€ ' : '€ ') + fmtE.format(Math.abs(v))
const euroTondo = (v: number) => (v < -0.004 ? '−€ ' : '€ ') + fmtN.format(Math.round(Math.abs(v)))
const maiu = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s)
const pl = (k: number, uno: string, tanti: string) => (Math.round(Number(k) || 0) === 1 ? uno : tanti)
const virgola = (x: any) => String(x ?? 0).replace('.', ',')
const PAROLE_N = ['Nessuna', 'Una', 'Due', 'Tre', 'Quattro']
// i nomi dei fornitori tecnici non si mostrano mai: se il corriere più usato ne avesse uno, resta senza nome
const TECNICI = /spediamo\s*pro|spedisci\.?\s*online|easy\s*parcel|\bdva\b/i

// Le foto della copertina e dei capitoli sono rese dallo studio (esempi-v6/v11/luce/scena/studio.html, insegna vuota)
// e i quattro spigoli dell'insegna li ha scritti lo studio stesso (rendi-scena --punti), in % dell'immagine 1200 × 1560:
// il nome del master che guarda ci va sopra nella prospettiva della facciata.
const FOTO = { w: 1200, h: 1560 }
const INSEGNA = {
  quadrato: [[25.99, 34.58], [28.22, 35.55], [28.36, 38.36], [26.14, 37.38]],
  nome: [[28.92, 36.34], [45.26, 43.47], [45.29, 45.73], [29.02, 38.48]],
}

// lettura GET che sa anche se è finita male (il capitolo lo dice) e tiene il dato di prima mentre arriva il nuovo
// (cambiando periodo i numeri scorrono dal vecchio al nuovo invece di sparire)
function useLettura<T = any>(url: string | null): { d: T | null; fatto: boolean } {
  const [s, setS] = useState<{ u: string | null; d: T | null; fatto: boolean }>({ u: null, d: null, fatto: false })
  useEffect(() => {
    if (!url) return
    let vivo = true
    fetch(url, { cache: 'no-store' }).then(r => (r.ok ? r.json() : null))
      .then(x => { if (vivo) setS({ u: url, d: x && !x.error ? x : null, fatto: true }) })
      .catch(() => { if (vivo) setS(p => ({ u: url, d: p.d, fatto: true })) })
    return () => { vivo = false }
  }, [url])
  return { d: s.d, fatto: s.fatto && s.u === url }
}

// ── il periodo dei soldi: uno solo per tutto il capitolo (e per la riga della copertina che ne parla) ──
type Periodo = { nome: string; da: Date; a: Date; titolo: string; inFrase: string }
const aMese = (m: string) => (/^[aeiou]/.test(m) ? 'ad ' : 'a ') + m
function periodoDi(nome: string): Periodo {
  const oggi = new Date()
  if (nome === 'oggi') return { nome, da: oggi, a: oggi, titolo: 'Oggi', inFrase: 'oggi' }
  if (nome === 'settimana') { const lun = new Date(oggi); lun.setDate(oggi.getDate() - ((oggi.getDay() + 6) % 7)); return { nome, da: lun, a: oggi, titolo: 'Questa settimana', inFrase: 'questa settimana' } }
  if (nome === 'scorso') { const d = new Date(oggi.getFullYear(), oggi.getMonth() - 1, 1); return { nome, da: d, a: new Date(oggi.getFullYear(), oggi.getMonth(), 0), titolo: maiu(MESI[d.getMonth()]), inFrase: aMese(MESI[d.getMonth()]) } }
  return { nome: 'mese', da: new Date(oggi.getFullYear(), oggi.getMonth(), 1), a: oggi, titolo: maiu(MESI[oggi.getMonth()]) + ', fino a oggi', inFrase: aMese(MESI[oggi.getMonth()]) }
}
const VOCI = [
  { k: 'rettifiche', nome: 'Rettifiche', url: '/api/reports/guadagno-rettifiche', href: '/dashboard/reports/rettifiche' },
  { k: 'resi', nome: 'Resi', url: '/api/reports/guadagno-resi', href: '/dashboard/reports/resi' },
  { k: 'giacenze', nome: 'Giacenze', url: '/api/reports/guadagno-giacenze', href: '/dashboard/reports/giacenze' },
  { k: 'logistica', nome: 'Logistica', url: '/api/reports/guadagno-logistica', href: '/dashboard/logistica/addebiti' },
  { k: 'consumabili', nome: 'Consumabili', url: '/api/reports/guadagno-consumabili', href: '/dashboard/reports/consumabili' },
]

// ── i pezzi della tipografia ──
// le parole salgono da una maschera, una dopo l'altra (--i è il loro posto nella frase)
function Parole({ t, da = 0 }: { t: string; da?: number }) {
  const p = t.split(/\s+/).filter(Boolean)
  return <>{p.map((x, i) => <Fragment key={i}><span className="rv-m"><span style={{ ['--i' as any]: da + i }}>{x}</span></span>{i < p.length - 1 ? ' ' : ''}</Fragment>)}</>
}
function EuroGrande({ v }: { v: number }) {
  const [i, c] = fmtE.format(Math.abs(v)).split(',')
  return <span className="rv-euro"><small className="rv-euro__s">€</small>{i}<small className="rv-euro__c">,{c}</small></span>
}
// il numero protagonista: largo e sottile, misurato sulla colonna (--c = quanti caratteri occupa)
function Eroe({ v, euro, i = 0 }: { v: number | null | undefined; euro?: boolean; i?: number }) {
  const ok = v !== null && v !== undefined && isFinite(Number(v))
  const x = ok ? Math.abs(Number(v)) : 0
  const c = ok ? (euro ? fmtN.format(Math.round(x)).length + 2.2 : fmtN.format(Number(v)).length) : 2
  return (
    <div className="rv-eroe" style={{ ['--c' as any]: Math.max(3.4, c) }}>
      <span className="rv-m"><span style={{ ['--i' as any]: i }}>{ok ? <Conta v={euro ? x : Number(v)}>{k => (euro ? <EuroGrande v={k} /> : fmtN.format(k))}</Conta> : '—'}</span></span>
    </div>
  )
}
function Occhiello({ c }: { c: number }) {
  return <p className="rv-occhiello rv-sale"><b>{CAPITOLI[c].n}</b><i />{CAPITOLI[c].nome}</p>
}
function Cifra({ v, euro, etichetta, nota, href, meno, d = 0 }: { v: number | null | undefined; euro?: boolean; etichetta: string; nota?: React.ReactNode; href?: string; meno?: boolean; d?: number }) {
  const ok = v !== null && v !== undefined && isFinite(Number(v))
  const corpo = <>
    <b className={'rv-cifra__n' + (meno ? ' rv-meno' : '')}>{ok ? <Conta v={euro ? Math.abs(Number(v)) : Number(v)}>{k => (euro ? <>{Number(v) < -0.004 ? '−' : ''}<EuroGrande v={k} /></> : fmtN.format(k))}</Conta> : '—'}</b>
    <span className="rv-cifra__l">{etichetta}</span>
    {nota && <em className="rv-cifra__nota">{nota}</em>}
  </>
  return href ? <a className="rv-cifra rv-sale" style={{ ['--d' as any]: d }} href={href}>{corpo}</a> : <div className="rv-cifra rv-sale" style={{ ['--d' as any]: d }}>{corpo}</div>
}

export default function PlanciaC() {
  const { data, giornata, badge, quando, luce } = useDatiPlancia()
  const notte = luce === 'notte'
  const radice = useRef<HTMLDivElement>(null), lato = useRef<HTMLElement>(null)
  const lenis = useScorrimentoMorbido(radice)
  const [attivo, setAttivo] = useState(0)
  const [stretto, setStretto] = useState(false)
  const [sopra, setSopra] = useState<string | null>(null)
  // la copertina entra quando ha il nome e i numeri (prima saliva «LA PLANCIA» e poi saltava al nome del master);
  // se la rotta tarda, entra lo stesso dopo 3,5 secondi
  const [pronta, setPronta] = useState(false)
  useEffect(() => {
    if (data) { setPronta(true); return }
    const t = setTimeout(() => setPronta(true), 3500)
    return () => clearTimeout(t)
  }, [data])

  // ── il periodo dei soldi si decide dopo l'apertura: «oggi» del server e del browser possono essere giorni diversi ──
  const [periodo, setPeriodo] = useState<Periodo | null>(null)
  useEffect(() => { setPeriodo(periodoDi('mese')) }, [])
  const q = periodo ? `?dal=${iso(periodo.da)}&al=${iso(periodo.a)}` : null
  const su = (u: string) => (q ? u + q : null)
  const tot = useLettura(su('/api/reports/guadagno-totale'))
  const sped = useLettura(su('/api/reports/guadagno'))
  const v0 = useLettura(su(VOCI[0].url)), v1 = useLettura(su(VOCI[1].url)), v2 = useLettura(su(VOCI[2].url)), v3 = useLettura(su(VOCI[3].url)), v4 = useLettura(su(VOCI[4].url))
  const voci = [v0, v1, v2, v3, v4]
  // costi di gestione e utile netto: solo se la rotta del totale li restituisce (li vedono il master e i suoi admin)
  const vediGestione = tot.d?.costiGestione !== undefined && tot.d?.costiGestione !== null
  const gest = useLettura(vediGestione ? su('/api/costi-gestione') : null)

  const dest = useLettura('/api/dashboard/destinazioni')
  const topo = useLettura('/geo/italia-province.json')
  const analisi = useLettura('/api/resi/analisi?giorni=90&riepilogo=1')
  const giac = useLettura('/api/spedizioni/lista?page=1&perPage=5&stato=in_giacenza')
  const nomi = useMemo(() => {
    const m = new Map<string, string>()
    const o = topo.d?.objects && (topo.d.objects as any)[Object.keys(topo.d.objects)[0]]
    for (const g of (o?.geometries || [])) if (g.properties?.prov_acr) m.set(String(g.properties.prov_acr).toUpperCase(), String(g.properties.prov_name || g.properties.prov_acr))
    return m
  }, [topo.d])

  // ── il telefono: una colonna sola, la tavola di ogni capitolo dentro il capitolo ──
  useEffect(() => {
    const mq = matchMedia('(max-width: 899px)'), metti = () => setStretto(mq.matches)
    metti(); mq.addEventListener('change', metti)
    return () => mq.removeEventListener('change', metti)
  }, [])

  // le foto dell'altra luce pronte in memoria: al cambio giorno/notte la tavola non resta vuota
  useEffect(() => {
    for (const k of ['copertina', 'banchina', 'recinto']) for (const t of ['argilla', 'notte']) { const im = new Image(); im.src = `/grafica/proposte/c/${k}-${t}.webp` }
  }, [])

  // ── la lettura: quale capitolo è sotto la riga dei due quinti dello schermo, e quanto ne resta (--p) ──
  useEffect(() => {
    const r = radice.current, pagina = r?.closest('.gx-pagina') as HTMLElement | null
    if (!r || !pagina) return
    const sez = CAPITOLI.map(c => r.querySelector<HTMLElement>('#rv-' + c.k))
    let ultimo = -1, raf = 0
    const misura = () => {
      raf = 0
      const t0 = pagina.getBoundingClientRect().top, h = pagina.clientHeight, riga = h * 0.42
      let i = 0
      sez.forEach((s, k) => { if (s && s.getBoundingClientRect().top - t0 <= riga) i = k })
      // in fondo alla pagina l'ultimo capitolo è acceso anche se è corto
      if (pagina.scrollTop > 0 && pagina.scrollTop + h >= pagina.scrollHeight - 4) i = sez.length - 1
      const s = sez[i]
      let p = 0
      if (s) { const b = s.getBoundingClientRect(); p = Math.min(1, Math.max(0, (riga - (b.top - t0)) / Math.max(1, b.height))) }
      lato.current?.style.setProperty('--p', p.toFixed(3))
      if (i !== ultimo) { ultimo = i; setAttivo(i) }
    }
    const scorre = () => { if (!raf) raf = requestAnimationFrame(misura) }
    misura()
    pagina.addEventListener('scroll', scorre, { passive: true }); addEventListener('resize', scorre)
    const ro = new ResizeObserver(scorre); ro.observe(r)
    return () => { pagina.removeEventListener('scroll', scorre); removeEventListener('resize', scorre); ro.disconnect(); cancelAnimationFrame(raf) }
  }, [])

  // ── i capitoli entrano quando arrivano: rv-visto la prima volta che se ne vede un quinto ──
  useEffect(() => {
    const r = radice.current, pagina = r?.closest('.gx-pagina') as HTMLElement | null
    if (!r) return
    const tutti = r.querySelectorAll('.rv-sez:not(.rv-sez--copertina)')
    if (!('IntersectionObserver' in window)) { tutti.forEach(s => s.classList.add('rv-visto')); return }
    const oss = new IntersectionObserver((v) => { for (const x of v) if (x.isIntersecting) { x.target.classList.add('rv-visto'); oss.unobserve(x.target) } },
      { root: pagina, threshold: 0.12 })
    tutti.forEach(s => oss.observe(s))
    return () => oss.disconnect()
  }, [])

  const vai = (i: number) => {
    const el = radice.current?.querySelector<HTMLElement>('#rv-' + CAPITOLI[i].k), pagina = radice.current?.closest('.gx-pagina') as HTMLElement | null
    if (!el || !pagina) return
    if (lenis) { lenis.scrollTo(el, { offset: -8, duration: 1.4 }); return }
    pagina.scrollTo({ top: el.getBoundingClientRect().top - pagina.getBoundingClientRect().top + pagina.scrollTop - 8 })
  }

  // ── i numeri che servono a più capitoli ──
  const nome = String(data?.masterNome || '').trim()
  const ora = quando ? quando.getHours() : null
  const mese = quando ? MESI[quando.getMonth()] : ''
  const provinceOrdinate: any[] = useMemo(() => (dest.d?.province || []).slice().sort((a: any, b: any) => b.n - a.n), [dest.d])
  const tema = notte ? 'notte' : 'argilla'

  // la tavola di ogni capitolo (nel pannello fermo a destra; sul telefono dentro il capitolo)
  const figura = (i: number, conInsegna: boolean) => {
    switch (i) {
      case 0: return <Foto src={`/grafica/proposte/c/copertina-${tema}.webp`} numero="01" testo={nome ? `In copertina: il magazzino di ${nome}, ${notte ? 'di sera' : 'di giorno'}.` : 'In copertina: il magazzino.'} nome={conInsegna ? nome : ''} notte={notte} posa="46% 50%" />
      case 1: return <Foto src={`/grafica/proposte/c/banchina-${tema}.webp`} numero="02" testo="La banchina: da qui partono le spedizioni chiuse in distinta." posa="50% 50%" />
      case 2: return <Orario g={giornata} ora={ora} />
      case 3: return <Mesi mesi={data ? (data.statsMensili || []) : null} />
      case 4: return <Margine sped={sped.d} periodo={periodo ? periodo.titolo.toLowerCase() : ''} />
      case 5: return <Atlante topo={topo.d || (topo.fatto ? false : null)} dest={dest.d} sopra={sopra} notte={notte} nomi={nomi} />
      default: return <Foto src={`/grafica/proposte/c/recinto-${tema}.webp`} numero="07" testo="Il recinto: le giacenze aspettano che tu dica al corriere cosa farne." posa="50% 46%" />
    }
  }
  const inLinea = (i: number) => (stretto ? <figure className={'rv-figura' + (FOTO_CAP.includes(i) ? ' rv-figura--foto' : '')}>{figura(i, false)}</figure> : null)

  return (
    <div className={'rv ' + archivo.variable} ref={radice}>
      <div className="rv-testo">
        <Copertina pronta={pronta} data={data} giornata={giornata} badge={badge} quando={quando} nome={nome} tot={tot.d} periodo={periodo} prima={provinceOrdinate[0]} nomi={nomi} analisi={analisi.d} vai={vai} figura={inLinea(0)} />
        <DaFare data={data} badge={badge} figura={inLinea(1)} />
        <Giornata data={data} giornata={giornata} figura={inLinea(2)} />
        <Mese data={data} mese={mese} figura={inLinea(3)} />
        <Soldi data={data} periodo={periodo} scegli={(k: string) => setPeriodo(periodoDi(k))} tot={tot} sped={sped} voci={voci} gest={gest} vediGestione={vediGestione} figura={inLinea(4)} />
        <Dove dest={dest} province={provinceOrdinate} nomi={nomi} sopra={sopra} setSopra={setSopra} figura={inLinea(5)} />
        <Rete data={data} analisi={analisi} giac={giac} figura={inLinea(6)} />
        <p className="rv-colophon">Fine dell&apos;edizione. I numeri si aggiornano da soli ogni due minuti{quando ? `; l'ultima volta alle ${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')}` : ''}.</p>
      </div>

      {!stretto && (
        <aside className="rv-lato" ref={lato} aria-label="Le tavole dei capitoli">
          <div className={'rv-lato__fermo' + (pronta ? ' rv-lato__fermo--pronto' : '')}>
            <div className="rv-tavola gx-vetro">
              {CAPITOLI.map((c, i) => (
                <figure key={c.k} className={'rv-strato' + (i === attivo ? ' rv-strato--su' : i < attivo ? ' rv-strato--prima' : '') + (FOTO_CAP.includes(i) ? ' rv-strato--foto' : '')} aria-hidden={i !== attivo}>
                  {figura(i, true)}
                </figure>
              ))}
            </div>
            <nav className="rv-indice" aria-label="Capitoli">
              {CAPITOLI.map((c, i) => (
                <button key={c.k} type="button" aria-current={i === attivo ? 'true' : undefined} onClick={() => vai(i)} title={c.nome}>
                  <b>{c.n}</b><span>{c.nome}</span><i />
                </button>
              ))}
            </nav>
          </div>
        </aside>
      )}
    </div>
  )
}

// ── una foto dello studio, con la didascalia. In copertina il nome del master sull'insegna della facciata ──
function Foto({ src, numero, testo, nome, notte, posa }: { src: string; numero: string; testo: string; nome?: string; notte?: boolean; posa: string }) {
  const box = useRef<HTMLDivElement>(null)
  const [mis, setMis] = useState<{ W: number; H: number } | null>(null)
  useEffect(() => {
    if (!nome || !box.current) return
    const el = box.current
    const ro = new ResizeObserver(() => setMis({ W: el.clientWidth, H: el.clientHeight })); ro.observe(el)
    return () => ro.disconnect()
  }, [nome])
  const insegna = useMemo(() => {
    if (!nome || !mis || !mis.W) return null
    // object-fit: cover con la stessa object-position dell'immagine, così l'insegna cade sulla facciata
    const s = Math.max(mis.W / FOTO.w, mis.H / FOTO.h), dw = FOTO.w * s, dh = FOTO.h * s
    const [px, py] = posa.split(' ').map(x => parseFloat(x) / 100)
    const ox = (mis.W - dw) * px, oy = (mis.H - dh) * py
    const pt = (p: number[]) => [ox + p[0] / 100 * dw, oy + p[1] / 100 * dh] as [number, number]
    const testo = nome.toUpperCase(), L = 1000, A = 100
    return { lettera: suQuattroPunti(100, 100, INSEGNA.quadrato.map(pt)), nome: suQuattroPunti(L, A, INSEGNA.nome.map(pt)), testo, L, A, corpo: Math.min(68, L / Math.max(1, testo.length * 0.7)) }
  }, [nome, mis, posa])
  return (
    <>
      <div className="rv-foto" ref={box}>
        <img src={src} alt="" decoding="async" style={{ objectPosition: posa }} />
        {insegna && <>
          <span className="rv-insegna rv-insegna--lettera" style={{ width: 100, height: 100, fontSize: 66, transform: insegna.lettera }}>{insegna.testo[0]}</span>
          <span className={'rv-insegna rv-insegna--nome' + (notte ? ' rv-insegna--notte' : '')} style={{ width: insegna.L, height: insegna.A, lineHeight: insegna.A + 'px', fontSize: insegna.corpo, transform: insegna.nome }}>{insegna.testo}</span>
        </>}
      </div>
      <figcaption className="rv-didascalia"><b>Tav. {numero}</b>{testo}</figcaption>
    </>
  )
}

// ═════════════════════════════════════════ 01 · COPERTINA ═════════════════════════════════════════
function Copertina({ pronta, data, giornata, badge, quando, nome, tot, periodo, prima, nomi, analisi, vai, figura }: any) {
  const h = quando ? quando.getHours() : null
  const edizione = h === null ? 'Edizione di oggi' : h < 13 ? 'Edizione del mattino' : h < 18 ? 'Edizione del pomeriggio' : 'Edizione serale'
  const saluto = h === null ? 'Ciao' : h < 13 ? 'Buongiorno' : h < 18 ? 'Buon pomeriggio' : 'Buonasera'
  const giorno = quando ? `${GIORNI[quando.getDay()]} ${quando.getDate()} ${MESI[quando.getMonth()]} ${quando.getFullYear()}` : ' '
  const alle = quando ? `${String(quando.getHours()).padStart(2, '0')}:${String(quando.getMinutes()).padStart(2, '0')}` : ''
  const partite = data ? Number(data.spediteOggi || 0) : null
  const testata = (nome || 'La Plancia').toUpperCase()
  const fuori = Number(data?.daMettereInDistinta || 0)
  const daFare = data ? [fuori, Number(data.inGiacenza || 0), Number(badge?.daConfermare || 0), Number(badge?.daAccettare || 0)].filter(x => x > 0).length : 0
  const punta = giornata?.ore?.length ? giornata.ore.reduce((a: any, o: any) => (o.create > a.create ? o : a), giornata.ore[0]) : null
  const mese = quando ? MESI[quando.getMonth()] : ''
  // il sommario: le righe di copertina che rimandano ai capitoli, scritte dai numeri (una riga senza dato non c'è)
  const strilli = [
    data && { c: 1, t: fuori > 0 ? `${n(fuori)} ${pl(fuori, 'aspetta', 'aspettano')} la distinta` : daFare ? `${PAROLE_N[Math.min(4, daFare)]} ${pl(daFare, 'cosa', 'cose')} da fare` : 'Niente da fare adesso' },
    giornata && { c: 2, t: punta && punta.create > 0 ? `L'ora più piena: le ${punta.ora}` : `${n(giornata.create)} create oggi` },
    data && mese && { c: 3, t: `${maiu(mese)}: ${n(data.spedizioniMese)} spedizioni` },
    tot && periodo && { c: 4, t: `${euroTondo(Math.abs(Number(tot.guadagno || 0)))} di ${Number(tot.guadagno) < 0 ? 'perdita' : 'guadagno'} ${periodo.inFrase}` },
    prima && { c: 5, t: `${nomi.get(String(prima.sigla).toUpperCase()) || prima.sigla}, la provincia più servita` },
    analisi?.totale && { c: 6, t: `Resi a 90 giorni: ${virgola(analisi.totale.pct)}%` },
  ].filter(Boolean) as { c: number; t: string }[]
  return (
    <section id="rv-copertina" className={'rv-sez rv-sez--copertina' + (pronta ? ' rv-visto' : '')} aria-labelledby="rv-t-copertina">
      <div className="rv-folio rv-sale"><span>{edizione}</span><span>{giorno}</span></div>
      <h1 id="rv-t-copertina" className="rv-testata" style={{ ['--n' as any]: Math.max(6, testata.length) }}><Parole t={testata} /></h1>
      <div className="rv-folio rv-folio--sotto rv-sale" style={{ ['--d' as any]: 200 }}><span>La Plancia, scritta dai tuoi numeri</span><span>{alle ? `aggiornata alle ${alle}` : ' '}</span></div>
      <div className="rv-apertura">
        <p className="rv-frase"><Parole t={`${saluto}. ${partite === 1 ? 'Oggi è partita' : partite === 0 ? 'Per ora oggi sono partite' : 'Oggi sono partite'}`} da={3} /></p>
        <Eroe v={partite} i={8} />
        <p className="rv-frase"><Parole t={partite === 1 ? 'spedizione.' : 'spedizioni.'} da={10} /></p>
        <p className="rv-nota rv-sale" style={{ ['--d' as any]: 500 }}>
          {giornata ? `${n(giornata.create)} ${pl(giornata.create, 'creata', 'create')} oggi` : '…'}
          {data ? ` · ${n(data.inLavorazione)} in lavorazione · ${n(data.inTransito)} in viaggio` : ''}
        </p>
      </div>
      {figura}
      {strilli.length > 0 && (
        <nav className="rv-sommario rv-sale" style={{ ['--d' as any]: 650 }} aria-label="In questo numero">
          <p className="rv-sommario__t">In questo numero</p>
          <ul>
            {strilli.map(s => <li key={s.c}><button type="button" onClick={() => vai(s.c)}><b>{CAPITOLI[s.c].n}</b><span>{s.t}</span></button></li>)}
          </ul>
        </nav>
      )}
    </section>
  )
}

// ═════════════════════════════════════════ 02 · DA FARE ADESSO ═════════════════════════════════════════
function DaFare({ data, badge, figura }: any) {
  const fuori = Number(data?.daMettereInDistinta || 0), giac = Number(data?.inGiacenza || 0)
  const conf = Number(badge?.daConfermare || 0), acc = Number(badge?.daAccettare || 0)
  const importo = Number(badge?.daConfermareImporto)
  // una riga per cosa da fare, ognuna col suo verbo; quelle a zero spariscono
  const righe = [
    data && { k: 'distinta', v: fuori, t: `${pl(fuori, 'spedizione aspetta', 'spedizioni aspettano')} la distinta`, nota: 'in tutta la tua rete, da sempre', verbo: 'Crea distinta', href: '/dashboard/distinte/crea' },
    data && { k: 'giacenze', v: giac, t: `${pl(giac, 'giacenza aspetta', 'giacenze aspettano')} una risposta`, nota: 'il corriere attende le tue istruzioni', verbo: 'Rispondi', href: '/dashboard/spedizioni/giacenze' },
    badge && { k: 'rettifiche', v: conf, t: `${pl(conf, 'rettifica', 'rettifiche')} da confermare`, nota: isFinite(importo) && importo > 0 ? `per ${euroPiano(importo)} in tutto` : 'pesi e misure rivisti dal corriere', verbo: 'Conferma', href: '/dashboard/spedizioni/rettifica' },
    badge && { k: 'rete', v: acc, t: `${pl(acc, 'richiesta', 'richieste')} della rete`, nota: 'da rivedere e accettare', verbo: 'Rivedi', href: '/dashboard/network' },
  ].filter((r: any) => r && r.v > 0) as any[]
  const pronti = !!data && !!badge
  const titolo = !data ? '…' : righe.length ? `${PAROLE_N[Math.min(4, righe.length)]} ${pl(righe.length, 'cosa ti aspetta.', 'cose ti aspettano.')}` : 'Niente da fare adesso.'
  return (
    <section id="rv-fare" className="rv-sez" aria-labelledby="rv-t-fare">
      <Occhiello c={1} />
      <h2 id="rv-t-fare" className="rv-titolo"><Parole key={titolo} t={titolo} /></h2>
      {righe.length > 0 ? (
        <ol className="rv-fare">
          {righe.map((r, i) => (
            <li key={r.k} className="rv-sale" style={{ ['--d' as any]: 250 + i * 110 }}>
              <b className="rv-fare__n"><Conta v={r.v}>{k => fmtN.format(k)}</Conta></b>
              <span className="rv-fare__t">{r.t}<em>{r.nota}</em></span>
              <a className={'rv-bottone' + (i === 0 ? ' rv-bottone--pieno' : '')} href={r.href}>{r.verbo}<Icona id="i-chevron" /></a>
            </li>
          ))}
        </ol>
      ) : pronti ? <p className="rv-nota rv-sale">Distinte chiuse, nessuna giacenza, nessuna rettifica da confermare, nessuna richiesta della rete.</p> : null}
      {figura}
    </section>
  )
}

// ═════════════════════════════════════════ 03 · LA GIORNATA ═════════════════════════════════════════
function Giornata({ data, giornata, figura }: any) {
  const c = giornata ? Number(giornata.create || 0) : null
  const punta = giornata?.ore?.length ? giornata.ore.reduce((a: any, o: any) => (o.create > a.create ? o : a), giornata.ore[0]) : null
  const fd = Number(giornata?.fuoriDistinta || 0)
  return (
    <section id="rv-giornata" className="rv-sez" aria-labelledby="rv-t-giornata">
      <Occhiello c={2} />
      <h2 id="rv-t-giornata" className="rv-frase rv-frase--titolo"><Parole t={c === 1 ? 'Oggi è nata' : c === 0 ? 'Per ora oggi sono nate' : 'Oggi sono nate'} /></h2>
      <Eroe v={c} i={3} />
      <p className="rv-frase"><Parole t={c === 1 ? 'spedizione.' : 'spedizioni.'} da={5} /></p>
      <p className="rv-nota rv-sale" style={{ ['--d' as any]: 450 }}>
        {!giornata ? '…' : c === 0 ? 'Nessuna spedizione creata oggi, finora: il grafico si riempie ora per ora.' : <>
          {punta && punta.create > 0 ? `L'ora più piena è stata quella delle ${punta.ora}, con ${n(punta.create)} ${pl(punta.create, 'spedizione', 'spedizioni')}. ` : ''}
          {fd > 0 ? `${n(fd)} di quelle di oggi ${pl(fd, 'è ancora', 'sono ancora')} fuori distinta.` : 'Sono già tutte in distinta.'}
        </>}
      </p>
      <div className="rv-cifre">
        <Cifra v={giornata ? fd : null} etichetta="di oggi, ancora fuori distinta" href="/dashboard/distinte/crea" d={550} />
        <Cifra v={data ? Number(data.inLavorazione || 0) : null} etichetta="in lavorazione" href="/dashboard/spedizioni?stato=in_lavorazione" d={650} />
      </div>
      {figura}
    </section>
  )
}

// ═════════════════════════════════════════ 04 · IL MESE ═════════════════════════════════════════
function Mese({ data, mese, figura }: any) {
  const v = data ? Number(data.spedizioniMese || 0) : null
  const limite = Number(data?.limiteMese || 0), libero = !!data?.illimitato || !(limite > 0)
  const pct = !libero && v !== null ? v / limite * 100 : 0
  const mesi: any[] = data?.statsMensili || []
  const prima = mesi.length > 1 ? mesi[mesi.length - 2] : null
  const confronto = prima ? ` ${maiu(meseDi(prima.mese))} si era chiuso a ${n(prima.totale)}.` : ''
  return (
    <section id="rv-mese" className="rv-sez" aria-labelledby="rv-t-mese">
      <Occhiello c={3} />
      <h2 id="rv-t-mese" className="rv-frase rv-frase--titolo"><Parole t={mese ? `${maiu(mese)}, finora:` : 'Questo mese:'} /></h2>
      <Eroe v={v} i={2} />
      <p className="rv-frase"><Parole t={v === 1 ? 'spedizione.' : 'spedizioni.'} da={4} /></p>
      {data && (
        <div className="rv-piano rv-sale" style={{ ['--d' as any]: 420 }}>
          {libero ? <p className="rv-nota">Il tuo piano non ha un limite di spedizioni al mese.{confronto}</p> : <>
            <span className="rv-piano__linea" role="img" aria-label={`${pct.toFixed(1)}% del piano`}><i style={{ width: Math.min(100, pct) + '%' }} /></span>
            <p className="rv-nota">Il {pct < 1 && pct > 0 ? virgola(pct.toFixed(1)) : Math.round(pct)}% delle {n(limite)} spedizioni del tuo piano.{confronto}</p>
          </>}
        </div>
      )}
      <div className="rv-cifre rv-cifre--tre">
        <Cifra v={data ? Number(data.inTransito || 0) : null} etichetta="in transito adesso" href="/dashboard/spedizioni?stato=in_transito" d={520} />
        <Cifra v={data ? Number(data.consegnateMese || 0) : null} etichetta="consegnate questo mese" href="/dashboard/spedizioni?stato=consegnata" d={600} />
        <Cifra v={data ? Number(data.codDaRimettere || 0) : null} euro etichetta="contrassegni da rimettere" href="/dashboard/contrassegni" d={680} />
      </div>
      {figura}
    </section>
  )
}

// ═════════════════════════════════════════ 05 · I SOLDI ═════════════════════════════════════════
function Soldi({ data, periodo, scegli, tot, sped, voci, gest, vediGestione, figura }: any) {
  const t = tot.d, g = Number(t?.guadagno || 0)
  const margine = t?.ricavi ? (g / t.ricavi * 100) : 0
  const carica = !!periodo && (!tot.fatto || !sped.fatto)
  // la tabella somma al totale: quello che le voci non spiegano (commissioni, accessori, rimborsi) è «altre voci»
  const righe = [
    { k: 'spedizioni', nome: 'Spedizioni', href: '/dashboard/statistiche/profitto', d: sped.d, sotto: sped.d ? `${n(sped.d.numSpedizioni || 0)} spedizioni · ${euroPiano(Number(sped.d.mediaSped || 0))} l'una` : '' },
    ...VOCI.map((v, i) => ({ k: v.k, nome: v.nome, href: v.href, d: voci[i].d, sotto: '' })),
  ]
  const tutte = righe.every(r => r.d)
  const altre = t && tutte ? g - righe.reduce((a, r) => a + Number(r.d?.guadagno || 0), 0) : 0
  const cr = data?.creditiDaRecuperare
  // il caricamento sta in un attributo, non nella classe: riscrivere la classe toglieva «rv-visto» messo
  // dall'osservatore e il capitolo spariva al primo cambio di periodo
  return (
    <section id="rv-soldi" className="rv-sez rv-sez--lunga" data-carica={carica ? '' : undefined} aria-labelledby="rv-t-soldi">
      <Occhiello c={4} />
      <div className="rv-periodo rv-sale" style={{ ['--d' as any]: 120 }}>
        <div className="rv-periodo__scelte gx-vetro gx-pillola" role="group" aria-label="Periodo di tutti i numeri dei soldi">
          {[['oggi', 'Oggi'], ['settimana', 'Questa settimana'], ['mese', 'Questo mese'], ['scorso', 'Mese scorso']].map(([k, l]) => (
            <button key={k} type="button" aria-pressed={periodo?.nome === k} onClick={() => scegli(k)}>{l}</button>
          ))}
        </div>
        <span className="rv-periodo__nota">Vale per tutti i numeri di questo capitolo</span>
      </div>
      <h2 id="rv-t-soldi" className="rv-frase rv-frase--titolo"><Parole key={periodo?.nome || ''} t={periodo ? `${periodo.titolo}:` : '…'} /></h2>
      <Eroe v={t ? g : null} euro i={2} />
      <p className="rv-frase"><Parole t={g < -0.004 ? 'di perdita.' : 'di guadagno.'} da={4} /></p>
      <p className="rv-nota rv-sale" style={{ ['--d' as any]: 420 }}>
        {t ? `Incassati ${euroPiano(Number(t.ricavi || 0))}, costati ${euroPiano(Number(t.costi || 0))}: il margine è del ${virgola(margine.toFixed(1))}%.` : tot.fatto ? 'Il guadagno del periodo non è arrivato.' : '…'}
      </p>

      <table className="rv-conti rv-sale" style={{ ['--d' as any]: 520 }}>
        <caption>Il conto del periodo, voce per voce</caption>
        <thead><tr><th scope="col">Voce</th><th scope="col">Incassato</th><th scope="col">Costo</th><th scope="col">Guadagno</th></tr></thead>
        <tbody>
          {righe.map(r => (
            <tr key={r.k}>
              <th scope="row"><a href={r.href}>{r.nome}</a>{r.sotto && <small>{r.sotto}</small>}</th>
              <td>{r.d ? euroPiano(Number(r.d.ricavi || 0)) : '…'}</td>
              <td>{r.d ? euroPiano(Number(r.d.costi || 0)) : '…'}</td>
              <td className={Number(r.d?.guadagno) < -0.004 ? 'rv-meno' : undefined}>{r.d ? euroPiano(Number(r.d.guadagno || 0)) : '…'}</td>
            </tr>
          ))}
          {Math.abs(altre) >= 0.01 && <tr><th scope="row">Altre voci<small>commissioni, accessori, rimborsi</small></th><td /><td /><td className={altre < 0 ? 'rv-meno' : undefined}>{euroPiano(altre)}</td></tr>}
        </tbody>
        <tfoot>
          <tr className="rv-conti__totale"><th scope="row">Guadagno totale</th><td>{t ? euroPiano(Number(t.ricavi || 0)) : '…'}</td><td>{t ? euroPiano(Number(t.costi || 0)) : '…'}</td><td className={g < -0.004 ? 'rv-meno' : undefined}>{t ? euroPiano(g) : '…'}</td></tr>
          {vediGestione && <>
            <tr><th scope="row"><a href="/dashboard/costi-gestione">Costi di gestione</a><small>{gest.d?.perCategoria?.length ? gest.d.perCategoria.slice(0, 3).map((c: any) => `${c.categoria} ${euroTondo(Number(c.importo || 0))}`).join(' · ') : gest.fatto ? 'nessun costo segnato nel periodo' : ''}</small></th><td /><td /><td>{euroPiano(-Math.abs(Number(t.costiGestione || 0)))}</td></tr>
            <tr className="rv-conti__utile"><th scope="row">Utile netto<small><Icona id="i-lucchetto" />queste due righe le vedete solo tu e i tuoi admin</small></th><td /><td /><td className={Number(t.utileNetto) < -0.004 ? 'rv-meno' : undefined}>{euroPiano(Number(t.utileNetto || 0))}</td></tr>
          </>}
        </tfoot>
      </table>

      <div className="rv-saldi">
        <p className="rv-sottotitolo rv-sale" style={{ ['--d' as any]: 200 }}><b>Saldi aperti</b>adesso: non cambiano col periodo</p>
        <div className="rv-cifre rv-cifre--quattro">
          <Cifra v={cr ? Math.abs(Number(cr.scalare?.totale || 0)) : null} euro meno={Math.abs(Number(cr?.scalare?.totale || 0)) > 0.004} etichetta="da recuperare a scalare" nota={cr ? `${n(cr.scalare?.clienti || 0)} ${pl(cr.scalare?.clienti || 0, 'cliente bloccato', 'clienti bloccati')} finché non ricaricano` : undefined} href="/dashboard/clienti" d={300} />
          <Cifra v={cr ? Math.abs(Number(cr.fattura?.totale || 0)) : null} euro etichetta="da recuperare a fattura" nota={cr ? `${n(cr.fattura?.clienti || 0)} ${pl(cr.fattura?.clienti || 0, 'cliente, spedisce', 'clienti, spediscono')} normalmente` : undefined} href="/dashboard/fatture" d={380} />
          <Cifra v={data ? Number(data.codDaRimettere || 0) : null} euro etichetta="contrassegni da rimettere" nota="ai tuoi clienti" href="/dashboard/contrassegni" d={460} />
          <Cifra v={data?.creditoMaster ? Number(data.creditoMaster.proprio || 0) : null} euro meno={Number(data?.creditoMaster?.proprio) < 0} etichetta="conto proprio" nota="i tuoi contratti · movimenti" href="/dashboard/movimenti" d={540} />
        </div>
      </div>
      {figura}
    </section>
  )
}

// ═════════════════════════════════════════ 06 · DOVE ═════════════════════════════════════════
function Dove({ dest, province, nomi, sopra, setSopra, figura }: any) {
  const d = dest.d
  const prima = province[0]
  // all'estero: i paesi diversi dall'Italia (totalePaesi − totale conterebbe anche le spedizioni italiane senza provincia)
  const estero = Array.isArray(d?.paesi) ? d.paesi.filter((p: any) => String(p.code).toUpperCase() !== 'IT').reduce((a: number, p: any) => a + Number(p.n || 0), 0) : null
  const nomeDi = (s: string) => nomi.get(String(s).toUpperCase()) || s
  const giorni = d?.giorni || 30
  return (
    <section id="rv-dove" className="rv-sez" aria-labelledby="rv-t-dove" onPointerLeave={() => setSopra(null)}>
      <Occhiello c={5} />
      <h2 id="rv-t-dove" className="rv-frase rv-frase--titolo"><Parole t={`In ${giorni} giorni hai raggiunto`} /></h2>
      <Eroe v={d ? Number(d.nProvince || 0) : null} i={5} />
      <p className="rv-frase"><Parole t={Number(d?.nProvince) === 1 ? 'provincia.' : 'province.'} da={7} /></p>
      <p className="rv-nota rv-sale" style={{ ['--d' as any]: 420 }}>
        {!d ? (dest.fatto ? 'Le destinazioni non sono arrivate.' : '…') : prima ? <>
          {nomeDi(prima.sigla)} è la prima, con {n(prima.n)} {pl(prima.n, 'spedizione', 'spedizioni')}: il {virgola(prima.perc)}% di quelle in Italia.
          {estero !== null ? (estero > 0 ? ` All'estero ne sono andate ${n(estero)}.` : ' Nessuna all\'estero.') : ''}
        </> : `Nessuna spedizione negli ultimi ${giorni} giorni.`}
      </p>
      {province.length > 0 && (
        <ol className="rv-indice-atlante rv-sale" style={{ ['--d' as any]: 520 }} aria-label="Le province con più spedizioni">
          {province.slice(0, 8).map((p: any, i: number) => (
            <li key={p.sigla} data-acceso={sopra === p.sigla ? '' : undefined} onPointerEnter={() => setSopra(p.sigla)} onFocus={() => setSopra(p.sigla)} tabIndex={0}>
              <span className="rv-indice-atlante__k">{String(i + 1).padStart(2, '0')}</span>
              <span className="rv-indice-atlante__nome">{nomeDi(p.sigla)}<small>{p.sigla}</small></span>
              <i className="rv-indice-atlante__punti" />
              <b>{n(p.n)}</b>
              <em>{virgola(p.perc)}%</em>
            </li>
          ))}
        </ol>
      )}
      {figura}
    </section>
  )
}

// ═════════════════════════════════════════ 07 · LA RETE E I RESI ═════════════════════════════════════════
function Rete({ data, analisi, giac, figura }: any) {
  const peggiori: any[] = analisi.d?.peggiori || []
  const righe: any[] = giac.d?.rows || []
  const tc = data?.topCorriere
  const nomeCorriere = tc?.nome && !TECNICI.test(String(tc.nome)) ? String(tc.nome) : ''
  const gg = (s: string) => { const x = new Date(s); return isNaN(+x) ? '' : `${x.getDate()} ${MESI[x.getMonth()].slice(0, 3)}` }
  const maxPct = Math.max(1, ...peggiori.map(c => Number(c.pct || 0)))
  return (
    <section id="rv-rete" className="rv-sez rv-sez--lunga" aria-labelledby="rv-t-rete">
      <Occhiello c={6} />
      <h2 id="rv-t-rete" className="rv-frase rv-frase--titolo"><Parole t="Da sempre, nella tua rete:" /></h2>
      <Eroe v={data ? Number(data.spedizioniTotali || 0) : null} i={4} />
      <p className="rv-frase"><Parole t={Number(data?.spedizioniTotali) === 1 ? 'spedizione.' : 'spedizioni.'} da={6} /></p>
      <div className="rv-cifre rv-cifre--tre">
        <Cifra v={data ? Number(data.clientiTotali || 0) : null} etichetta={pl(Number(data?.clientiTotali || 0), 'cliente', 'clienti')} href="/dashboard/clienti" d={420} />
        <Cifra v={data ? Number(data.sottomaster || 0) : null} etichetta="sotto-master" href="/dashboard/network" d={500} />
        <Cifra v={tc ? Number(tc.n || 0) : null} etichetta={nomeCorriere ? `con ${nomeCorriere}, il corriere più usato` : 'col corriere più usato'} d={580} />
      </div>

      <div className="rv-due">
        <div className="rv-elenco rv-sale" style={{ ['--d' as any]: 300 }}>
          <p className="rv-sottotitolo"><b>I clienti con più resi</b>ultimi 90 giorni{analisi.d?.totale ? ` · nella rete ${virgola(analisi.d.totale.pct)}%` : ''}<a href="/dashboard/resi/analisi">Analisi resi</a></p>
          {peggiori.length ? (
            <ol className="rv-resi">
              {peggiori.slice(0, 5).map((c, i) => (
                <li key={c.id || i}>
                  <span className="rv-resi__nome">{c.nome}<small>{n(c.resi)} {pl(c.resi, 'reso', 'resi')} su {n(c.partite)} {pl(c.partite, 'partita', 'partite')}</small></span>
                  <span className="rv-resi__barra"><i style={{ width: Math.min(100, Number(c.pct || 0) / maxPct * 100) + '%' }} className={c.livello === 'rosso' ? 'rv-rosso' : undefined} /></span>
                  <b className={c.livello === 'rosso' ? 'rv-meno' : undefined}>{virgola(c.pct)}%</b>
                </li>
              ))}
            </ol>
          ) : <p className="rv-vuoto">{analisi.fatto ? (analisi.d ? 'Nessun cliente con resi da segnalare.' : 'L\'analisi dei resi non è arrivata.') : '…'}</p>}
        </div>
        <div className="rv-elenco rv-sale" style={{ ['--d' as any]: 420 }}>
          <p className="rv-sottotitolo"><b>Giacenze da risolvere</b>{data ? `${n(data.inGiacenza || 0)} in tutto` : ''}<a href="/dashboard/spedizioni/giacenze">Tutte le giacenze</a></p>
          {righe.length ? (
            <ol className="rv-giacenze">
              {righe.slice(0, 5).map((s, i) => (
                <li key={s.id || i}>
                  <span className="rv-giacenze__chi">{s.dest_nome}{s.dest_citta ? ` · ${s.dest_citta}` : ''}<small>{gg(s.giacenza_data || s.created_at) ? `ferma dal ${gg(s.giacenza_data || s.created_at)}` : ''}{s.giacenza_motivo ? ` · ${String(s.giacenza_motivo).toLowerCase()}` : ''}</small></span>
                  <a className="rv-bottone rv-bottone--piccolo" href="/dashboard/spedizioni/giacenze">Istruzioni</a>
                </li>
              ))}
            </ol>
          ) : <p className="rv-vuoto">{giac.fatto ? (giac.d ? 'Nessuna giacenza da risolvere.' : 'L\'elenco delle giacenze non è arrivato.') : '…'}</p>}
        </div>
      </div>
      {figura}
    </section>
  )
}
