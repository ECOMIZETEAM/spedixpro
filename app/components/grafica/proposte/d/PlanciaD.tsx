'use client'
// PROPOSTA D «BENTO» della Plancia (27/10). La home come una griglia di tessere di misure diverse, in una o due
// schermate: ogni tessera è UNA cosa (un numero protagonista, un micro-grafico, spesso un piccolo oggetto 3D).
// Al clic la tessera si apre: cresce fino a diventare un foglio grande sopra la griglia (View Transitions dello stesso
// documento, «a elemento condiviso»); Esc o un clic fuori la richiude al suo posto. Dove il browser non le ha, una
// dissolvenza; con meno movimento chiesto al sistema, apre e chiude e basta.
// Numeri solo dalle rotte che il portale ha già, in sola lettura (vedi dati.ts e comune.ts). Niente segue il mouse.
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { flushSync } from 'react-dom'
import { useDatiPlancia } from '../dati'
import { useScorrimentoMorbido, calmo } from '../../movimento'
import { GIORNI, MESI } from '../../PlanciaNuova'
import { dalAl, periodo, useLettura, maiuscola, precarica, URL_GIACENZE, urlContrattiOggi, type NomePeriodo, type Periodo } from './comune'
import { useForme } from './grafici'
import { TCod, TDove, TFare, TGiacenze, TMesi, TOggi, TPiano, TResi, TRete, TSaldi, TSoldi, TStati, TTransito, TUtile, TVoce, VOCI, type Soldi } from './tessere'
import { FDove, FFare, FGiacenze, FMesi, FOggi, FResi, FRete, FSaldi, FSoldi, FStati, FTransito, Segmenti } from './fogli'
import './bento.css'

type Aperta = { t: string; f: string; voce?: string }
type Posto = { x: number; y: number; w: number; h: number }
// quale foglio apre ogni tessera (le voci dei soldi aprono il foglio dei soldi, con la loro riga accesa)
const FOGLIO: Record<string, string> = { oggi: 'oggi', fare: 'fare', transito: 'transito', giacenze: 'giacenze', cod: 'saldi', piano: 'mesi', soldi: 'soldi', saldi: 'saldi', utile: 'soldi', stati: 'stati', mesi: 'mesi', dove: 'dove', rete: 'rete', resi: 'resi' }

// i soldi del periodo: tutte le tessere dei soldi leggono lo STESSO periodo
function useSoldi(p: Periodo | null): Soldi {
  const q = dalAl(p), su = (u: string) => (q ? u + q : null)
  const tot = useLettura<any>(su('/api/reports/guadagno-totale'))
  const voci = [useLettura<any>(su(VOCI[0].url)), useLettura<any>(su(VOCI[1].url)), useLettura<any>(su(VOCI[2].url)), useLettura<any>(su(VOCI[3].url)), useLettura<any>(su(VOCI[4].url)), useLettura<any>(su(VOCI[5].url))]
  const gest = useLettura<any>(su('/api/costi-gestione'))
  // la quota di ogni voce sul guadagno: il resto del totale (commissioni, accessori, rimborsi) è «altre voci»
  const g = voci.map(l => Number(l.d?.guadagno || 0))
  const altre = tot.d ? Number(tot.d.guadagno || 0) - g.reduce((a, b) => a + b, 0) : 0
  const somma = g.filter(x => x > 0).reduce((a, b) => a + b, 0) + (altre > 0.005 ? altre : 0)
  const quota = (k: string) => { const i = VOCI.findIndex(v => v.k === k), v = k === 'altre' ? altre : (i >= 0 ? g[i] : 0); return somma > 0 ? Math.max(0, v) / somma : 0 }
  return { tot, voci, gest, quota, altre }
}

// una tessera: tutta la superficie apre il foglio (il bottone trasparente sotto), i verbi dentro stanno sopra.
// --i è il posto nella cascata dell'entrata
// le rotte che il foglio di una tessera legge: partono quando il mouse arriva sulla tessera (o il fuoco, da tastiera)
const PRIMA: Record<string, () => string[]> = { fare: () => [urlContrattiOggi(), URL_GIACENZE], giacenze: () => [URL_GIACENZE] }
function Tessera({ k, area, misura, titolo, i, aperta, apri, children }: { k: string; area: string; misura: 'l' | 'm' | 's'; titolo: string; i: number; aperta: boolean; apri: (k: string) => void; children: ReactNode }) {
  const prima = PRIMA[k] ? () => precarica(...PRIMA[k]()) : undefined
  return (
    <article className={`bd-t bd-t--${misura} bd-a-${area}`} data-tessera={k} data-aperta={aperta ? '' : undefined} style={{ ['--i' as any]: i }} onPointerEnter={prima} onFocus={prima}>
      <button type="button" className="bd-t__apri" aria-haspopup="dialog" aria-label={`${titolo}: apri il dettaglio`} onClick={() => apri(k)} />
      {children}
    </article>
  )
}

export default function PlanciaD() {
  const { data, giornata, badge, quando, tema } = useDatiPlancia()
  const radice = useRef<HTMLDivElement>(null)
  const lenis = useScorrimentoMorbido(radice)

  // il periodo dei soldi si sceglie dopo l'apertura (il «oggi» del browser)
  const [p, setP] = useState<Periodo | null>(null)
  // ?periodo=oggi|settimana|mese|scorso parte da quel periodo (per un link, o per fotografarlo)
  useEffect(() => { const q = new URLSearchParams(location.search).get('periodo') as NomePeriodo | null; setP(periodo(q && ['oggi', 'settimana', 'mese', 'scorso'].includes(q) ? q : 'mese')) }, [])
  const soldi = useSoldi(p)
  const scegli = useCallback((n: NomePeriodo) => setP(periodo(n)), [])

  // le rotte di «Come va», lette una volta
  const destinazioni = useLettura<any>('/api/dashboard/destinazioni')
  const topo = useLettura<any>('/geo/italia-province.json')
  const analisi = useLettura<any>('/api/resi/analisi?giorni=90&riepilogo=1')
  const formePiccole = useForme(topo.d, 220, 250)
  const formeGrandi = useForme(topo.d, 420, 480)
  const nomi = useMemo(() => { const m = new Map<string, string>(); for (const f of (formeGrandi || [])) m.set(f.sigla, f.nome); return m }, [formeGrandi])
  const nomeDi = useCallback((s: string) => nomi.get(s) || s, [nomi])

  // ── il foglio aperto ──
  const [aperta, setAperta] = useState<Aperta | null>(null)
  const [posto, setPosto] = useState<Posto | null>(null)
  const [dissolvi, setDissolvi] = useState<'' | 'entra' | 'esce'>('')
  // il velo resta un attimo dopo la chiusura, il tempo di svanire
  const [veloVia, setVeloVia] = useState(false)
  const foglio = useRef<HTMLElement>(null)
  const inCorso = useRef(false)

  // il foglio si posa sopra la griglia: dentro il riquadro della pagina (a destra del menu, sotto la barra)
  const misura = (): Posto => {
    const pg = radice.current?.closest('.gx-pagina') as HTMLElement | null
    const r = pg ? pg.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight }
    const stretto = innerWidth < 700, m = stretto ? 8 : 16
    const w = Math.min(1120, r.width - 2 * m), y = r.top + (stretto ? 2 : 6)
    return { x: r.left + (r.width - w) / 2, y, w, h: innerHeight - y - (stretto ? 8 : 18) }
  }
  const tessera = (t: string) => radice.current?.querySelector<HTMLElement>(`[data-tessera="${t}"]`) || null

  // La transizione a elemento condiviso: la tessera e il foglio portano lo stesso nome (bd-foglio) solo per la durata
  // della transizione, una prima e l'altro dopo: il browser fa crescere l'una nell'altro. I nomi non restano addosso
  // a niente, se no il cerchio giorno/notte della cornice e il passaggio fra le pagine li prenderebbero a parte.
  const transizione = (verso: 'apre' | 'chiude', prima: HTMLElement | null, cambia: () => void, dopo: () => HTMLElement | null, fine?: () => void) => {
    const d: any = document, html = document.documentElement, classi = ['vt-bento', 'vt-bento--' + verso]
    html.classList.add(...classi)
    if (prima) prima.style.viewTransitionName = 'bd-foglio'
    inCorso.current = true
    let poi: HTMLElement | null = null
    const vt = d.startViewTransition(() => {
      if (prima) prima.style.viewTransitionName = ''
      flushSync(cambia)
      poi = dopo(); if (poi) poi.style.viewTransitionName = 'bd-foglio'
    })
    vt.finished.catch(() => {}).finally(() => { html.classList.remove(...classi); if (poi) poi.style.viewTransitionName = ''; inCorso.current = false; fine?.() })
  }

  const voceDi = (t: string) => t.startsWith('voce-') ? t.slice(5) : t === 'utile' ? 'utile' : undefined
  const apri = (t: string) => {
    if (inCorso.current || aperta) return
    const prossima = { t, f: FOGLIO[t] || 'soldi', voce: voceDi(t) }, pos = misura()
    const d: any = document
    if (calmo()) { setPosto(pos); setAperta(prossima); return }
    if (!d.startViewTransition) { setPosto(pos); setDissolvi('entra'); setAperta(prossima); return }
    transizione('apre', tessera(t), () => { setPosto(pos); setDissolvi(''); setAperta(prossima) }, () => foglio.current)
  }
  const chiudi = () => {
    if (!aperta || inCorso.current) return
    const t = aperta.t, d: any = document
    const torna = () => tessera(t)?.querySelector<HTMLElement>('.bd-t__apri')?.focus({ preventScroll: true })
    if (calmo()) { setAperta(null); torna(); return }
    if (!d.startViewTransition) { inCorso.current = true; setDissolvi('esce'); setVeloVia(true); setTimeout(() => { setAperta(null); setDissolvi(''); setVeloVia(false); inCorso.current = false; torna() }, 220); return }
    transizione('chiude', foglio.current, () => { setAperta(null); setVeloVia(true) }, () => tessera(t), () => { setVeloVia(false); torna() })
  }
  // Esc chiama sempre la chiusura di adesso (quella del disegno più recente)
  const chiudiRef = useRef(chiudi)
  useEffect(() => { chiudiRef.current = chiudi })

  // col foglio aperto: la pagina sotto sta ferma, Esc chiude, il fuoco gira dentro il foglio
  useEffect(() => {
    if (!aperta) return
    const pg = radice.current?.closest('.gx-pagina') as HTMLElement | null
    pg?.classList.add('bd-ferma'); lenis?.stop()
    const tasto = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); chiudiRef.current(); return }
      if (e.key !== 'Tab' || !foglio.current) return
      const f = [...foglio.current.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      if (!f.length) return
      const primo = f[0], ultimo = f[f.length - 1]
      if (!foglio.current.contains(document.activeElement)) { e.preventDefault(); primo.focus() }
      else if (e.shiftKey && document.activeElement === primo) { e.preventDefault(); ultimo.focus() }
      else if (!e.shiftKey && document.activeElement === ultimo) { e.preventDefault(); primo.focus() }
    }
    document.addEventListener('keydown', tasto)
    const ridisegna = () => setPosto(misura())
    addEventListener('resize', ridisegna)
    // il fuoco va al foglio stesso (non alla chiusura): chi legge con lo schermo sente il titolo, e Tab entra nel foglio
    requestAnimationFrame(() => foglio.current?.focus({ preventScroll: true }))
    return () => { document.removeEventListener('keydown', tasto); removeEventListener('resize', ridisegna); pg?.classList.remove('bd-ferma'); lenis?.start() }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aperta?.t, aperta?.f, lenis])

  // ?apri=<tessera> apre un foglio all'arrivo (per mandare il link a qualcuno, o fotografarlo), senza transizione
  useEffect(() => {
    const t = new URLSearchParams(location.search).get('apri')
    if (t && FOGLIO[t]) { setPosto(misura()); setAperta({ t, f: FOGLIO[t], voce: voceDi(t) }) }
    else if (t && VOCI.some(v => v.k === t)) { setPosto(misura()); setAperta({ t: 'voce-' + t, f: 'soldi', voce: t }) }
  }, [])

  // ── l'ora e il giorno, solo dopo l'apertura ──
  const adesso = quando ? quando.getHours() : null
  const giorno = quando ? `${maiuscola(GIORNI[quando.getDay()])} ${quando.getDate()} ${MESI[quando.getMonth()]}` : ''
  const nome = String(data?.masterNome || '').trim()
  const utile = !!soldi.tot.d && soldi.tot.d.costiGestione !== undefined
  const su = (k: string) => aperta?.t === k

  const comuni = { data, badge, giornata, tema, chiudi }
  let contenuto: ReactNode = null
  if (aperta) {
    const f = aperta.f
    contenuto = f === 'oggi' ? <FOggi {...comuni} adesso={adesso} giorno={giorno} />
      : f === 'fare' ? <FFare {...comuni} />
      : f === 'transito' ? <FTransito {...comuni} />
      : f === 'giacenze' ? <FGiacenze {...comuni} />
      : f === 'saldi' ? <FSaldi {...comuni} />
      : f === 'mesi' ? <FMesi {...comuni} />
      : f === 'stati' ? <FStati {...comuni} />
      : f === 'dove' ? <FDove dati={destinazioni} forme={formeGrandi} tema={tema} chiudi={chiudi} nomeDi={nomeDi} />
      : f === 'rete' ? <FRete {...comuni} />
      : f === 'resi' ? <FResi analisi={analisi} tema={tema} chiudi={chiudi} />
      : <FSoldi s={soldi} p={p} scegli={scegli} voce={aperta.voce} tema={tema} chiudi={chiudi} />
  }

  return (
    <div className="bd" ref={radice}>
      <div className="bd-fondo" aria-hidden="true" />

      <header className="bd-capo">
        <small><i className="bd-punto bd-punto--bene" />{quando ? <>{giorno} · aggiornato alle {String(quando.getHours()).padStart(2, '0')}:{String(quando.getMinutes()).padStart(2, '0')}</> : ' '}</small>
        <h1>{nome || ' '}</h1>
      </header>

      {/* ── ADESSO: la giornata e quello che aspetta te ── */}
      <section className="bd-banda bd-banda--adesso" aria-label="Adesso">
        <Tessera i={0} k="oggi" area="oggi" misura="l" titolo="Oggi" aperta={su('oggi')} apri={apri}><TOggi data={data} giornata={giornata} adesso={adesso} tema={tema} giorno={giorno} /></Tessera>
        <Tessera i={1} k="fare" area="fare" misura="l" titolo="Da fare" aperta={su('fare')} apri={apri}><TFare data={data} badge={badge} tema={tema} /></Tessera>
        <Tessera i={2} k="transito" area="tran" misura="s" titolo="In transito" aperta={su('transito')} apri={apri}><TTransito data={data} tema={tema} /></Tessera>
        <Tessera i={3} k="giacenze" area="giac" misura="s" titolo="In giacenza" aperta={su('giacenze')} apri={apri}><TGiacenze data={data} tema={tema} /></Tessera>
        <Tessera i={4} k="cod" area="cod" misura="s" titolo="Contrassegni" aperta={su('cod')} apri={apri}><TCod data={data} tema={tema} /></Tessera>
        <Tessera i={5} k="saldi" area="saldi" misura="m" titolo="Saldi aperti" aperta={su('saldi')} apri={apri}><TSaldi data={data} /></Tessera>
      </section>

      {/* ── I SOLDI: un periodo solo per tutte le tessere ── */}
      <div className="bd-banda-testa">
        <div><h2>I soldi</h2><p>{p ? maiuscola(p.titolo) : ' '} · il periodo vale per tutte le tessere dei soldi</p></div>
        <Segmenti p={p} scegli={scegli} />
      </div>
      <section className={'bd-banda bd-banda--soldi' + (utile ? ' bd-con-utile' : '')} aria-label="I soldi">
        <Tessera i={6} k="soldi" area="soldi" misura="l" titolo="Guadagno totale" aperta={su('soldi')} apri={apri}><TSoldi s={soldi} p={p} tema={tema} /></Tessera>
        {VOCI.map((v, i) => (
          <Tessera key={v.k} i={7 + i} k={'voce-' + v.k} area={'v' + i} misura="s" titolo={v.nome} aperta={su('voce-' + v.k)} apri={apri}><TVoce v={v} l={soldi.voci[i]} quota={soldi.quota(v.k)} tema={tema} /></Tessera>
        ))}
        {utile && <Tessera i={13} k="utile" area="utile" misura="m" titolo="Utile netto" aperta={su('utile')} apri={apri}><TUtile t={soldi.tot.d} gest={soldi.gest.d} tema={tema} /></Tessera>}
      </section>

      {/* ── COME VA: gli ultimi 30 giorni, i mesi, dove vanno, la rete ── */}
      <div className="bd-banda-testa">
        <div><h2>Come va</h2><p>Gli ultimi 30 giorni, i mesi, la rete</p></div>
      </div>
      <section className="bd-banda bd-banda--come" aria-label="Come va">
        <Tessera i={15} k="stati" area="stati" misura="l" titolo="Ultimi 30 giorni" aperta={su('stati')} apri={apri}><TStati data={data} /></Tessera>
        <Tessera i={16} k="mesi" area="mesi" misura="l" titolo="Mesi" aperta={su('mesi')} apri={apri}><TMesi data={data} /></Tessera>
        <Tessera i={17} k="dove" area="dove" misura="l" titolo="Destinazioni" aperta={su('dove')} apri={apri}><TDove dati={destinazioni} forme={formePiccole} tema={tema} nomeDi={nomeDi} /></Tessera>
        <Tessera i={18} k="piano" area="piano" misura="s" titolo="Il piano del mese" aperta={su('piano')} apri={apri}><TPiano data={data} mese={quando ? MESI[quando.getMonth()] : ''} /></Tessera>
        <Tessera i={19} k="rete" area="rete" misura="s" titolo="La tua rete" aperta={su('rete')} apri={apri}><TRete data={data} tema={tema} /></Tessera>
        <Tessera i={20} k="resi" area="resi" misura="m" titolo="Resi a 90 giorni" aperta={su('resi')} apri={apri}><TResi analisi={analisi} tema={tema} /></Tessera>
      </section>

      {/* ── il foglio aperto, sopra a tutto ── */}
      {/* il velo non entra nella transizione: è nella pagina e sfuma da sé (la sua sfocatura, fotografata dalla
          transizione, a metà ritorno spariva e tornava) */}
      {((aperta && posto) || veloVia) && <div className={'bd-velo' + (veloVia ? ' bd-velo--via' : '')} onClick={chiudi} aria-hidden="true" />}
      {aperta && posto && <>
        <section ref={foglio} tabIndex={-1} className={'bd-foglio' + (dissolvi ? ' bd-dissolvi-' + dissolvi : '')} role="dialog" aria-modal="true" aria-labelledby="bd-foglio-titolo" data-lenis-prevent=""
          style={{ left: posto.x, top: posto.y, width: posto.w, maxHeight: posto.h }}>
          {contenuto}
        </section>
      </>}
    </div>
  )
}
