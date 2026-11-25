'use client'
// IL CALENDARIO del portale (master, agenti e clienti; Lorenzo 25/11/2026: «sì per tutti e tre»).
// Le tue voci (promemoria, eventi, riunioni) e quelle che arrivano da sole (ritiri, giacenze), in mese, settimana,
// giorno ed elenco. Vedi tipi.ts per le regole, /api/calendario/* per chi vede cosa.
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { GraficaNuova } from '../grafica/contesto'
import DettaglioSpedizione from '../DettaglioSpedizione'
import type { EventoMio, RitiroCal, GiacenzaCal, Voce, Filtri } from './tipi'
import { NOME_TIPO } from './tipi'
import {
  GIORNI_BREVI, chiaveGiorno, giorniMese, giorniSettimana, inizioGiorno, piuGiorni, piuMesi, stessoGiorno,
  ora, oraBreve, dataLunga, quandoRelativo, titoloPeriodo, MESI, MESI_BREVI, GIORNI, giornoSettimana,
} from './date'
import { costruisciGiorni, disponi, voceDaMio } from './voci'
import { leggiMiei, leggiDaFare, eliminaMio, segnaFatto, azioneOccorrenza, rispondiInvito, leggiFeed, creaFeed, spegniFeed, CAMBIATO, type StatoFeed } from './deposito'
import { momentoAvviso } from '@/lib/calendario-avviso'
import FinestraEvento, { type Bozza } from './FinestraEvento'
import SchedaVoce from './SchedaVoce'
import Ic from './icone'
import './calendario.css'
// il dettaglio spedizione nella grafica nuova è una tendina: i suoi vestiti stanno con l'elenco (valgono solo sotto .gx)
import '../grafica/elenco.css'

type Vista = 'mese' | 'settimana' | 'giorno' | 'elenco'
const VISTE: { v: Vista; l: string; tasto: string }[] = [
  { v: 'mese', l: 'Mese', tasto: 'm' }, { v: 'settimana', l: 'Settimana', tasto: 's' },
  { v: 'giorno', l: 'Giorno', tasto: 'g' }, { v: 'elenco', l: 'Elenco', tasto: 'e' },
]
const ORA_PX = 52
const GIORNI_ELENCO = 30

// le comodità di chi guarda (vista e filtri) restano nel browser; se il browser non lascia salvare, si parte dal solito
function ricorda<T>(k: string, iniziale: T): T { try { const v = localStorage.getItem(k); return v ? { ...iniziale as any, ...JSON.parse(v) } : iniziale } catch { return iniziale } }
function salvaComodita(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)) } catch { } }

type Avviso = { id: string; etichetta?: string; titolo: string; sotto?: string; evento?: EventoMio }

export default function Calendario({ portale, vedeRitiri, vedeGiacenze, puoInvitare = false }: { portale: 'master' | 'cliente'; vedeRitiri: boolean; vedeGiacenze: boolean; puoInvitare?: boolean }) {
  const grafica = useContext(GraficaNuova)
  const notte = grafica.attiva && grafica.luce === 'notte'
  const cliente = portale === 'cliente'

  // niente che dipenda da «oggi» nel primo disegno: il server non ha l'ora di chi guarda
  const [montato, setMontato] = useState(false)
  const [adesso, setAdesso] = useState(() => new Date())
  const [vista, setVista] = useState<Vista>('mese')
  const [ancora, setAncora] = useState(() => inizioGiorno(new Date()))
  const [filtri, setFiltri] = useState<Filtri>({ miei: true, ritiri: true, giacenze: true })
  const [telefono, setTelefono] = useState(false)
  const [miniMese, setMiniMese] = useState(() => inizioGiorno(new Date()))

  const [miei, setMiei] = useState<EventoMio[]>([])
  const [auto, setAuto] = useState<{ ritiri: RitiroCal[]; giacenze: GiacenzaCal[]; troncati: boolean }>({ ritiri: [], giacenze: [], troncati: false })
  const [daFare, setDaFare] = useState<EventoMio[]>([])
  const [caricaAuto, setCaricaAuto] = useState(false)
  const [caricaMiei, setCaricaMiei] = useState(false)
  const [erroreAuto, setErroreAuto] = useState('')
  const [erroreMiei, setErroreMiei] = useState('')
  const [versione, setVersione] = useState(0)          // le tue voci cambiate (anche da un'altra finestra)
  const [riprova, setRiprova] = useState(0)

  const [aperta, setAperta] = useState<Voce | null>(null)
  const [finestra, setFinestra] = useState<{ evento?: EventoMio; bozza?: Bozza } | null>(null)
  const [spedizione, setSpedizione] = useState<string | null>(null)
  const [avvisi, setAvvisi] = useState<Avviso[]>([])
  // il dettaglio spedizione rilegge da sé tutto il resto per id: gli basta una riga con l'id, sempre la stessa
  const spedRiga = useMemo(() => (spedizione ? { id: spedizione } : null), [spedizione])

  useEffect(() => {
    setMontato(true)
    setVista(ricorda<{ v: Vista }>('mx_cal_vista', { v: 'mese' }).v)
    setFiltri(ricorda<Filtri>('mx_cal_filtri', { miei: true, ritiri: true, giacenze: true }))
    const mq = window.matchMedia('(max-width: 760px)')
    const metti = () => setTelefono(mq.matches)
    metti(); mq.addEventListener('change', metti)
    const t = setInterval(() => setAdesso(new Date()), 30000)
    const cambiato = () => setVersione(v => v + 1)
    window.addEventListener(CAMBIATO, cambiato)
    return () => { mq.removeEventListener('change', metti); clearInterval(t); window.removeEventListener(CAMBIATO, cambiato) }
  }, [])
  useEffect(() => { if (montato) salvaComodita('mx_cal_vista', { v: vista }) }, [vista, montato])
  useEffect(() => { if (montato) salvaComodita('mx_cal_filtri', filtri) }, [filtri, montato])

  // ── il periodo mostrato ──
  const giorni = useMemo(() => {
    if (vista === 'mese') return giorniMese(ancora)
    if (vista === 'settimana') return giorniSettimana(ancora)
    if (vista === 'giorno') return [inizioGiorno(ancora)]
    return Array.from({ length: GIORNI_ELENCO }, (_, i) => piuGiorni(inizioGiorno(ancora), i))
  }, [vista, ancora])
  const dal = giorni[0]
  const al = piuGiorni(giorni[giorni.length - 1], 1)
  const kDal = chiaveGiorno(dal), kUltimo = chiaveGiorno(giorni[giorni.length - 1])

  // ── letture ──
  useEffect(() => {
    if (!montato) return
    if (!vedeRitiri && !vedeGiacenze) { setAuto({ ritiri: [], giacenze: [], troncati: false }); return }
    let vivo = true
    setCaricaAuto(true); setErroreAuto('')
    fetch(`/api/calendario/automatici?dal=${kDal}&al=${kUltimo}`)
      .then(async r => { const d = await r.json().catch(() => null); if (!r.ok) throw new Error(d?.error || 'Non riesco a leggere ritiri e giacenze'); return d })
      .then(d => { if (vivo) setAuto({ ritiri: d.ritiri || [], giacenze: d.giacenze || [], troncati: !!d.ritiriTroncati }) })
      .catch(e => { if (vivo) setErroreAuto(e?.message || 'Non riesco a leggere ritiri e giacenze') })
      .finally(() => { if (vivo) setCaricaAuto(false) })
    return () => { vivo = false }
  }, [montato, kDal, kUltimo, vedeRitiri, vedeGiacenze, riprova])

  useEffect(() => {
    if (!montato) return
    let vivo = true
    setCaricaMiei(true); setErroreMiei('')
    Promise.all([leggiMiei(dal, al), leggiDaFare()])
      .then(([m, f]) => { if (!vivo) return; setMiei(m); setDaFare(f) })
      .catch(e => { if (vivo) setErroreMiei(e?.message || 'Non riesco a leggere le tue voci') })
      .finally(() => { if (vivo) setCaricaMiei(false) })
    return () => { vivo = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montato, kDal, kUltimo, versione, riprova])

  const perGiorno = useMemo(
    () => costruisciGiorni({ miei, ritiri: auto.ritiri, giacenze: auto.giacenze, filtri, dal, al, cliente }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [miei, auto, filtri, kDal, kUltimo, cliente],
  )
  const voci = (d: Date) => perGiorno.get(chiaveGiorno(d)) || []

  // ── navigazione ──
  const vai = useCallback((passo: number) => {
    setAncora(a => vista === 'mese' ? piuMesi(a, passo) : piuGiorni(a, passo * (vista === 'settimana' ? 7 : vista === 'giorno' ? 1 : 7)))
  }, [vista])
  const oggi = useCallback(() => { const d = inizioGiorno(new Date()); setAncora(d); setMiniMese(d) }, [])
  const apriGiorno = (d: Date) => { setAncora(inizioGiorno(d)); setVista('giorno') }
  useEffect(() => { setMiniMese(ancora) }, [ancora])

  const nuova = useCallback((b?: Partial<Bozza>) => {
    const base = new Date(); base.setMinutes(0, 0, 0); base.setHours(base.getHours() + 1)
    const giorno = b?.inizio || (stessoGiorno(ancora, new Date()) ? base : new Date(ancora.getFullYear(), ancora.getMonth(), ancora.getDate(), 9))
    setFinestra({ bozza: { tipo: 'promemoria', ...b, inizio: giorno } })
  }, [ancora])

  // scorciatoie da tastiera, come i calendari che conosci: T oggi, M/S/G/E vista, N nuova, frecce
  useEffect(() => {
    const tasto = (e: KeyboardEvent) => {
      if (finestra || aperta || spedizione || e.metaKey || e.ctrlKey || e.altKey) return
      const t = e.target as HTMLElement | null
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return
      const k = e.key.toLowerCase()
      const v = VISTE.find(x => x.tasto === k)
      if (v) { setVista(v.v); return }
      if (k === 't') oggi()
      else if (k === 'n' || k === 'c') { e.preventDefault(); nuova() }
      else if (e.key === 'ArrowLeft') vai(-1)
      else if (e.key === 'ArrowRight') vai(1)
    }
    window.addEventListener('keydown', tasto)
    return () => window.removeEventListener('keydown', tasto)
  }, [finestra, aperta, spedizione, oggi, nuova, vai])

  // ── l'avviso a calendario aperto (campanella ed email li mandano il server e il giro ogni 5 minuti) ──
  const mostrati = useRef<Set<string>>(new Set())
  useEffect(() => {
    if (!montato) return
    try { JSON.parse(sessionStorage.getItem('mx_cal_avvisati') || '[]').forEach((k: string) => mostrati.current.add(k)) } catch { }
  }, [montato])
  useEffect(() => {
    if (!montato) return
    const tutti = new Map<string, EventoMio>()
    for (const e of [...miei, ...daFare]) if (e.invito?.stato !== 'rifiutato') tutti.set(e.id + '|' + (e.occorrenza || ''), e)
    const nuovi: Avviso[] = []
    for (const e of tutti.values()) {
      if (e.fatto) continue
      const m = momentoAvviso(e)
      if (!m) continue
      const quando = m.getTime()
      const chiave = `${e.id}|${e.inizio}|${e.avviso_minuti}`
      // a calendario aperto si mostra nella mezz'ora dopo il momento dell'avviso, una volta per sessione
      if (adesso.getTime() >= quando && adesso.getTime() < quando + 30 * 60000 && !mostrati.current.has(chiave)) {
        mostrati.current.add(chiave)
        nuovi.push({ id: chiave, etichetta: 'Promemoria', titolo: e.titolo, sotto: `${NOME_TIPO[e.tipo]} · ${quandoRelativo(new Date(e.inizio), adesso)}${e.tutto_il_giorno ? '' : ' alle ' + ora(new Date(e.inizio))}`, evento: e })
      }
    }
    if (nuovi.length) {
      try { sessionStorage.setItem('mx_cal_avvisati', JSON.stringify([...mostrati.current])) } catch { }
      setAvvisi(a => [...a, ...nuovi].slice(-3))
    }
  }, [adesso, miei, daFare, montato])
  const togliAvviso = (id: string) => setAvvisi(a => a.filter(x => x.id !== id))
  useEffect(() => {
    if (!avvisi.length) return
    const t = setTimeout(() => setAvvisi(a => a.slice(1)), 15000)
    return () => clearTimeout(t)
  }, [avvisi])
  const conferma = (titolo: string, sotto = '') => {
    const id = 'ok-' + Date.now()
    setAvvisi(a => [...a, { id, titolo, sotto }].slice(-3))
  }

  // ── azioni sulle tue voci ──
  const salvata = (e: EventoMio, nuovo: boolean) => {
    setFinestra(null); setAperta(null)
    conferma(nuovo ? `${NOME_TIPO[e.tipo]} salvato` : 'Modifiche salvate', `${quandoRelativo(new Date(e.inizio))}${e.tutto_il_giorno ? '' : ' alle ' + ora(new Date(e.inizio))} · ${e.titolo}`)
    // una voce nuova fuori dal periodo: ci si sposta lì; modificando una serie no (il suo inizio è la prima occorrenza)
    const d = new Date(e.inizio)
    if (nuovo && (d < dal || d >= al)) setAncora(inizioGiorno(d))
  }
  const voceDi = (e: EventoMio): Voce => voceDaMio(e)

  // ── disegno ──
  const contaRitiri = auto.ritiri.length, contaGiacenze = auto.giacenze.length
  const caricando = caricaAuto || caricaMiei
  const pill = (v: Voce, compatta = false) => {
    const conOra = !v.tuttoIlGiorno
    return (
      <button key={v.chiave} className={`cal-pill cal-t--${v.tipo}${conOra ? ' cal-pill--ora' : ''}${v.fatto ? ' cal-pill--fatto' : ''}${v.mio?.invito ? ' cal-invito--' + v.mio.invito.stato : ''}${v.ritiri && v.ritiri.length > 1 || v.giacenze && v.giacenze.length > 1 ? ' cal-pill--gruppo' : ''}`}
        title={[v.titolo, v.sotto].filter(Boolean).join(' · ')}
        onClick={ev => { ev.stopPropagation(); setAperta(v) }}>
        <i />{conOra && !compatta && <b>{oraBreve(v.inizio)}</b>}<span>{v.titolo}</span>
      </button>
    )
  }

  const riga = (v: Voce) => {
    const quando = v.tuttoIlGiorno ? (v.tipo === 'ritiro' ? 'Ritiro' : v.tipo === 'giacenza' ? 'Giacenza' : 'Tutto il giorno')
      : <>{ora(v.inizio)}{v.fine && <em> – {ora(v.fine)}</em>}</>
    const gruppo = (v.ritiri?.length || 0) > 1 || (v.giacenze?.length || 0) > 1
    return (
      <button key={v.chiave} className={`cal-riga cal-t--${v.tipo}${v.fatto ? ' cal-riga--fatto' : ''}${v.mio?.invito ? ' cal-invito--' + v.mio.invito.stato : ''}`} onClick={() => setAperta(v)}>
        <span className="cal-riga-ora">{quando}</span>
        <i />
        <span className="cal-riga-testo"><b>{v.titolo}</b>{v.sotto && <span>{v.sotto}</span>}</span>
        {gruppo ? <span className="cal-chip">{v.ritiri ? 'vedi tutti' : 'da gestire'}</span>
          : v.mio?.invito ? <span className="cal-chip cal-chip--neutro"><Ic n="persona" />{v.mio.invito.stato === 'in_attesa' ? 'da rispondere' : v.mio.invito.stato === 'accettato' ? 'partecipi' : 'non partecipi'}</span>
          : v.mio?.collegamento ? <span className="cal-chip cal-chip--neutro"><Ic n="pacco" />spedizione</span>
            : v.mio ? <span className="cal-chip cal-chip--neutro">{NOME_TIPO[v.tipo]}</span> : null}
      </button>
    )
  }

  const vistaMese = () => {
    const mese = ancora.getMonth()
    const scelto = telefono ? ancora : null
    return (
      <>
        <div className="cal-mese-testa">{GIORNI_BREVI.map(g => <div key={g}>{g}</div>)}</div>
        <div className="cal-mese">
          {giorni.map(d => {
            const l = voci(d)
            const max = 3
            const visibili = l.length > max ? l.slice(0, max - 1) : l
            const fine = giornoSettimana(d) >= 5
            const tipi = [...new Set(l.map(v => v.tipo))].slice(0, 3)
            return (
              <div key={chiaveGiorno(d)} role="button" tabIndex={0}
                className={`cal-cella${d.getMonth() !== mese ? ' cal-cella--fuori' : ''}${fine && d.getMonth() === mese ? ' cal-cella--fine' : ''}${stessoGiorno(d, adesso) ? ' cal-cella--oggi' : ''}${scelto && stessoGiorno(d, scelto) ? ' cal-cella--scelta' : ''}`}
                aria-label={`${dataLunga(d)}: ${l.length ? l.length + (l.length === 1 ? ' voce' : ' voci') : 'niente'}`}
                onClick={() => telefono ? setAncora(inizioGiorno(d)) : nuova({ inizio: new Date(d.getFullYear(), d.getMonth(), d.getDate(), 9), tipo: 'promemoria' })}
                onKeyDown={e => { if (e.key === 'Enter') apriGiorno(d) }}>
                <span className="cal-num" onClick={e => { if (!telefono) { e.stopPropagation(); apriGiorno(d) } }}>{d.getDate()}</span>
                {visibili.map(v => pill(v))}
                {l.length > visibili.length && <button className="cal-altri" onClick={e => { e.stopPropagation(); apriGiorno(d) }}>+{l.length - visibili.length} altre</button>}
                {tipi.length > 0 && <span className="cal-puntini">{tipi.map(t => <i key={t} className={`cal-t--${t}`} />)}</span>}
              </div>
            )
          })}
        </div>
        {telefono && (
          <div className="cal-giorno-sotto">
            <div className="cal-elenco-giorno">
              <div className={`cal-elenco-data${stessoGiorno(ancora, adesso) ? ' cal-elenco-data--oggi' : ''}`} onClick={() => apriGiorno(ancora)}>
                <b>{ancora.getDate()}</b><span>{dataLunga(ancora)}</span>
              </div>
              <div className="cal-righe">
                {voci(ancora).length ? voci(ancora).map(riga) : <div className="cal-dafare-vuoto">Niente in questo giorno. Tocca + per aggiungere.</div>}
              </div>
            </div>
          </div>
        )}
      </>
    )
  }

  // settimana e giorno: la griglia delle ore
  const oreRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!montato || (vista !== 'settimana' && vista !== 'giorno') || !oreRef.current) return
    // si apre sulle 7, o un'ora prima della prima voce con l'ora se è più presto
    let prima = 7 * 60
    for (const d of giorni) for (const v of voci(d)) if (!v.tuttoIlGiorno && stessoGiorno(v.inizio, d)) prima = Math.min(prima, v.inizio.getHours() * 60 + v.inizio.getMinutes() - 60)
    oreRef.current.scrollTop = Math.max(0, prima / 60 * ORA_PX - 8)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [montato, vista, kDal])

  const clicOra = (d: Date, e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const minuti = Math.max(0, Math.min(23 * 60 + 30, Math.floor(y / ORA_PX * 2) * 30))
    const inizio = new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minuti / 60), minuti % 60)
    nuova({ inizio, fine: new Date(inizio.getTime() + 60 * 60000), tipo: 'evento' })
  }

  const vistaOre = () => {
    const bozza = finestra?.bozza && !finestra.evento && !finestra.bozza.tuttoIlGiorno && finestra.bozza.tipo !== 'promemoria' ? finestra.bozza : null
    return (
      <div className="cal-sett" style={{ ['--giorni' as any]: giorni.length }}>
        <div className="cal-sett-testa">
          <div />
          {giorni.map(d => (
            <div key={chiaveGiorno(d)} className={`cal-sett-giorno${stessoGiorno(d, adesso) ? ' cal-sett-giorno--oggi' : ''}`} onClick={() => vista === 'settimana' && apriGiorno(d)}>
              <small>{GIORNI_BREVI[giornoSettimana(d)]}</small><b>{d.getDate()}</b>
              {vista === 'giorno' && <small style={{ textTransform: 'none', letterSpacing: 0 }}>{MESI[d.getMonth()]}</small>}
            </div>
          ))}
        </div>
        <div className="cal-sett-tutto">
          <div>tutto il<br />giorno</div>
          {giorni.map(d => <div key={chiaveGiorno(d)}>{voci(d).filter(v => v.tuttoIlGiorno).map(v => pill(v))}</div>)}
        </div>
        <div className="cal-ore" ref={oreRef}>
          <div className="cal-ore-griglia" style={{ ['--cal-ora' as any]: ORA_PX + 'px' }}>
            <div className="cal-ore-etichette">{Array.from({ length: 23 }, (_, i) => <span key={i} style={{ top: (i + 1) * ORA_PX }}>{String(i + 1).padStart(2, '0')}:00</span>)}</div>
            {giorni.map(d => {
              const oggiQui = stessoGiorno(d, adesso)
              const bozzaQui = bozza && stessoGiorno(bozza.inizio, d) ? bozza : null
              return (
                <div key={chiaveGiorno(d)} className={`cal-ore-colonna${oggiQui ? ' cal-ore-colonna--oggi' : ''}`} onClick={e => clicOra(d, e)}>
                  {disponi(voci(d), d).map(x => {
                    const largo = 100 / x.cols
                    const alto = Math.max(22, (x.fineMin - x.inizioMin) / 60 * ORA_PX - 3)
                    // sotto i 40 px (un promemoria, mezz'ora) ora e titolo stanno su una riga: su due si tagliavano a metà
                    const corto = alto < 40
                    return (
                      <button key={x.v.chiave} className={`cal-blocco cal-t--${x.v.tipo}${x.v.fatto ? ' cal-blocco--fatto' : ''}${corto ? ' cal-blocco--corto' : ''}${x.v.mio?.invito ? ' cal-invito--' + x.v.mio.invito.stato : ''}`}
                        style={{ top: x.inizioMin / 60 * ORA_PX + 1, height: alto, left: `calc(${x.col * largo}% + 3px)`, width: `calc(${largo}% - 6px)`, right: 'auto' }}
                        onClick={e => { e.stopPropagation(); setAperta(x.v) }} title={[ora(x.v.inizio), x.v.titolo].join(' ')}>
                        {corto
                          ? <b><time>{ora(x.v.inizio)}</time> {x.v.titolo}</b>
                          : <><b>{x.v.titolo}</b><span>{ora(x.v.inizio)}{x.v.fine ? ' – ' + ora(x.v.fine) : ''}{x.v.mio?.luogo ? ' · ' + x.v.mio.luogo : ''}</span></>}
                      </button>
                    )
                  })}
                  {bozzaQui && (() => {
                    const a = bozzaQui.inizio.getHours() * 60 + bozzaQui.inizio.getMinutes()
                    const b = bozzaQui.fine ? Math.max(a + 30, (bozzaQui.fine.getTime() - inizioGiorno(d).getTime()) / 60000) : a + 60
                    return <div className="cal-blocco cal-blocco--nuovo" style={{ top: a / 60 * ORA_PX + 1, height: (b - a) / 60 * ORA_PX - 3 }}><b>(senza titolo)</b><span>{ora(bozzaQui.inizio)}</span></div>
                  })()}
                  {oggiQui && <div className="cal-adesso" style={{ top: (adesso.getHours() * 60 + adesso.getMinutes()) / 60 * ORA_PX }} />}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    )
  }

  // sul telefono la settimana è un elenco dei sette giorni: sette colonne da 40 px non si leggono
  const vistaElenco = (soloGiorni?: Date[]) => {
    // la settimana sul telefono mostra tutti e sette i giorni; l'elenco solo quelli con qualcosa
    const lista = soloGiorni || giorni.filter(d => voci(d).length > 0)
    if (!lista.length) return (
      <div className="cal-vuoto"><Ic n="calendario" /><b>Niente nei prossimi {GIORNI_ELENCO} giorni</b>
        <span>Aggiungi un promemoria, un evento o una riunione{vedeRitiri ? '; i ritiri prenotati compaiono da soli' : ''}.</span>
        <button className="cal-tasto cal-tasto--nero" style={{ marginTop: 8 }} onClick={() => nuova()}><Ic n="piu" />Nuova voce</button>
      </div>
    )
    return (
      <div className="cal-elenco">
        {lista.map(d => (
          <div key={chiaveGiorno(d)} className="cal-elenco-giorno">
            <div className={`cal-elenco-data${stessoGiorno(d, adesso) ? ' cal-elenco-data--oggi' : ''}`} onClick={() => apriGiorno(d)}>
              <b>{d.getDate()}</b><span>{stessoGiorno(d, adesso) ? 'oggi · ' : ''}{GIORNI[giornoSettimana(d)]} · {MESI_BREVI[d.getMonth()]}</span>
            </div>
            <div className="cal-righe">{voci(d).length ? voci(d).map(riga) : <div className="cal-dafare-vuoto">Niente</div>}</div>
          </div>
        ))}
      </div>
    )
  }

  const corpo = () => {
    if (vista === 'mese') return vistaMese()
    if (vista === 'settimana' && telefono) return vistaElenco(giorni)
    if (vista === 'settimana' || vista === 'giorno') return vistaOre()
    return vistaElenco()
  }

  // la barra laterale: il mese piccolo, le cose da fare, i filtri
  const mini = useMemo(() => giorniMese(miniMese), [miniMese])
  const lato = (
    <aside className="cal-lato">
      <div className="cal-scheda cal-mini-scheda">
        <div className="cal-mini-testa">
          <b>{MESI[miniMese.getMonth()]} {miniMese.getFullYear()}</b>
          <span>
            <button className="cal-tondo" onClick={() => setMiniMese(m => piuMesi(m, -1))} aria-label="Mese prima"><Ic n="sinistra" /></button>
            <button className="cal-tondo" onClick={() => setMiniMese(m => piuMesi(m, 1))} aria-label="Mese dopo"><Ic n="destra" /></button>
          </span>
        </div>
        <div className="cal-mini">
          {GIORNI_BREVI.map(g => <small key={g}>{g[0]}</small>)}
          {mini.map(d => {
            const nelPeriodo = d >= dal && d < al && vista !== 'mese' && vista !== 'elenco'
            return (
              <button key={chiaveGiorno(d)} onClick={() => { setAncora(inizioGiorno(d)); if (vista === 'mese' && d.getMonth() === ancora.getMonth()) apriGiorno(d) }}
                className={[d.getMonth() !== miniMese.getMonth() && 'fuori', stessoGiorno(d, adesso) && 'oggi', nelPeriodo && 'periodo'].filter(Boolean).join(' ')}
                aria-label={dataLunga(d)}>
                {d.getDate()}
              </button>
            )
          })}
        </div>
      </div>

      <div className="cal-scheda">
        <h3>Da fare <span>{daFare.length ? `${daFare.length} promemoria` : ''}</span></h3>
        <div className="cal-dafare">
          {daFare.length === 0 && <div className="cal-dafare-vuoto">{caricaMiei ? 'Un attimo…' : 'Nessun promemoria in sospeso.'}</div>}
          {daFare.slice(0, 6).map(e => {
            const d = new Date(e.inizio)
            const tardi = d < inizioGiorno(adesso)
            return (
              <div key={e.id + (e.occorrenza || '')} className="cal-dafare-voce">
                <button className="cal-spunta" aria-label={`Segna «${e.titolo}» come fatto`} onClick={async () => {
                  try { await segnaFatto(e, true); conferma('Fatto', e.titolo) } catch (err: any) { setErroreMiei(err?.message || 'Non riuscito') }
                }}><Ic n="spunta" /></button>
                <button style={{ minWidth: 0 }} onClick={() => setAperta(voceDi(e))}>
                  <b>{e.titolo}</b>
                  <span className={tardi ? 'tardi' : undefined}>{quandoRelativo(d, adesso)}{e.tutto_il_giorno ? '' : ' alle ' + ora(d)}{e.ricorrenza ? ' · si ripete' : ''}{e.collegamento ? ' · spedizione' : ''}</span>
                </button>
              </div>
            )
          })}
          {daFare.length > 6 && <div className="cal-dafare-vuoto">e altri {daFare.length - 6}</div>}
        </div>
      </div>

      <div className="cal-scheda">
        <h3>Cosa vedere</h3>
        <div className="cal-filtri">
          <button className="cal-filtro cal-t--promemoria" aria-pressed={filtri.miei} onClick={() => setFiltri(f => ({ ...f, miei: !f.miei }))}>
            <i><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i><span>Le mie voci</span><em>{miei.length || ''}</em>
          </button>
          {vedeRitiri && (
            <button className="cal-filtro cal-t--ritiro" aria-pressed={filtri.ritiri} onClick={() => setFiltri(f => ({ ...f, ritiri: !f.ritiri }))}>
              <i><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i><span>Ritiri prenotati</span><em>{contaRitiri || ''}</em>
            </button>
          )}
          {vedeGiacenze && (
            <button className="cal-filtro cal-t--giacenza" aria-pressed={filtri.giacenze} onClick={() => setFiltri(f => ({ ...f, giacenze: !f.giacenze }))}>
              <i><svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg></i><span>Giacenze da gestire</span><em>{contaGiacenze || ''}</em>
            </button>
          )}
        </div>
      </div>

      <SchedaFeed />
      {auto.troncati && (
        <div className="cal-nota"><Ic n="info" /><div>In questo periodo ci sono più di 5.000 ritiri: ne mostro i primi. L’elenco completo è in Elenco Ritiri.</div></div>
      )}
    </aside>
  )

  return (
    <div className="cal" data-notte={notte ? '1' : undefined}>
      <div className="cal-pagina">
        <div className="cal-testa">
          <div>
            <h1>Calendario</h1>
            <p>{cliente ? 'I tuoi ritiri, le giacenze da gestire e i tuoi promemoria, in un posto solo.' : 'Ritiri, giacenze, promemoria e riunioni, in un posto solo.'}</p>
          </div>
          <button className="cal-tasto cal-tasto--nero cal-nuova" onClick={() => nuova()} aria-label="Nuova voce"><Ic n="piu" /><span>Nuova voce</span></button>
        </div>

        <div className="cal-corpo">
          {montato ? lato : <aside className="cal-lato" />}
          <section className="cal-scheda" aria-busy={caricando}>
            <div className="cal-barra">
              <button className="cal-tondo" onClick={() => vai(-1)} aria-label="Indietro"><Ic n="sinistra" /></button>
              <button className="cal-oggi" onClick={oggi}>Oggi</button>
              <button className="cal-tondo" onClick={() => vai(1)} aria-label="Avanti"><Ic n="destra" /></button>
              <h2 className="cal-periodo">{montato ? titoloPeriodo(vista, ancora) : ' '}</h2>
              <div className="cal-viste" role="tablist" aria-label="Vista">
                {VISTE.map(x => <button key={x.v} role="tab" aria-selected={vista === x.v} onClick={() => setVista(x.v)} title={`${x.l} (${x.tasto.toUpperCase()})`}>{x.l}</button>)}
              </div>
            </div>
            <div className={`cal-carica${caricando ? '' : ' cal-carica--ferma'}`} />
            {(erroreAuto || erroreMiei) && (
              <div className="cal-errore" role="alert"><Ic n="info" /><span>{erroreAuto || erroreMiei}</span><button onClick={() => setRiprova(x => x + 1)}>Riprova</button></div>
            )}
            {montato ? corpo() : <div style={{ height: 560 }} />}
          </section>
        </div>
      </div>

      {aperta && (
        <SchedaVoce voce={aperta} cliente={cliente}
          onChiudi={() => setAperta(null)}
          onModifica={() => { if (aperta.mio) { setFinestra({ evento: aperta.mio }); setAperta(null) } }}
          onElimina={async () => { if (aperta.mio) { await eliminaMio(aperta.mio.id); setAperta(null); conferma(aperta.mio.ricorrenza ? 'Serie eliminata' : 'Voce eliminata', aperta.mio.titolo) } }}
          onSaltaQuesta={async () => { if (aperta.mio?.occorrenza) { await azioneOccorrenza(aperta.mio.id, aperta.mio.occorrenza, 'salta'); setAperta(null); conferma('Tolta solo questa', `${aperta.mio.titolo} · ${dataLunga(new Date(aperta.mio.inizio))}`) } }}
          onRispondi={async (r) => { if (aperta.mio) { await rispondiInvito(aperta.mio.id, r); setAperta(null); conferma(r === 'accettato' ? 'Parteciperai' : 'Non parteciperai', aperta.mio.titolo) } }}
          onFatto={async (f) => { if (aperta.mio) { await segnaFatto(aperta.mio, f); setAperta(null); conferma(f ? 'Fatto' : 'Di nuovo da fare', aperta.mio.titolo) } }}
          onApriSpedizione={(id) => { setAperta(null); setSpedizione(id) }} />
      )}
      {finestra && <FinestraEvento evento={finestra.evento} bozza={finestra.bozza} puoInvitare={puoInvitare} onChiudi={() => setFinestra(null)} onSalvato={salvata} />}
      {spedRiga && <DettaglioSpedizione s={spedRiga} onClose={() => setSpedizione(null)} />}

      {avvisi.length > 0 && (
        <div className="cal-avvisi" aria-live="polite">
          {avvisi.map(a => (
            <div key={a.id} className="cal-avviso">
              <Ic n={a.evento ? 'campanella' : 'spunta'} />
              <div>{a.etichetta && <small>{a.etichetta}</small>}<b>{a.titolo}</b>{a.sotto && <small className="sotto">{a.sotto}</small>}</div>
              {a.evento && <button className="arancio" onClick={() => { togliAvviso(a.id); setAperta(voceDi(a.evento!)) }}>Apri</button>}
              <button className="x" onClick={() => togliAvviso(a.id)} aria-label="Chiudi avviso"><Ic n="x" /></button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}


// GOOGLE E IPHONE: il link privato del proprio calendario (fase 2). Si mostra una volta, quando si crea: dopo resta solo
// «attivo dal …», e per riaverlo si rigenera (il vecchio smette di funzionare).
function SchedaFeed() {
  const [stato, setStato] = useState<StatoFeed | null>(null)
  const [link, setLink] = useState<{ url: string; webcal: string } | null>(null)
  const [occupato, setOccupato] = useState(false)
  const [errore, setErrore] = useState('')
  const [copiato, setCopiato] = useState(false)
  const [aperta, setAperta] = useState(false)
  useEffect(() => { leggiFeed().then(setStato).catch(() => setStato({ attivo: false, creato_il: null, ultimo_uso: null })) }, [])
  const fai = async (f: () => Promise<void>) => { setOccupato(true); setErrore(''); try { await f() } catch (e: any) { setErrore(e?.message || 'Non riuscito') } finally { setOccupato(false) } }
  const crea = () => fai(async () => { const l = await creaFeed(); setLink(l); setStato({ attivo: true, creato_il: new Date().toISOString(), ultimo_uso: null }); setAperta(true) })
  const spegni = () => fai(async () => { await spegniFeed(); setLink(null); setStato({ attivo: false, creato_il: null, ultimo_uso: null }) })
  const copia = async () => { if (!link) return; try { await navigator.clipboard.writeText(link.url); setCopiato(true); setTimeout(() => setCopiato(false), 2000) } catch { setErrore('Copia non riuscita: seleziona il link e copialo a mano') } }
  const giorno = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' }) : ''
  return (
    <div className="cal-scheda cal-feed">
      <h3><span className="cal-feed-titolo"><Ic n="link" />Google e iPhone</span>{stato?.attivo && <span className="cal-chip cal-chip--bene">attivo</span>}</h3>
      {!stato ? <div className="cal-dafare-vuoto">Un attimo…</div> : link ? (
        <>
          <p className="cal-feed-testo">Incolla questo link in Google Calendar o aprilo sull’iPhone: le tue voci compaiono lì e si aggiornano da sole.</p>
          <div className="cal-feed-link"><input readOnly value={link.url} onFocus={e => e.currentTarget.select()} aria-label="Link del calendario" />
            <button className="cal-tondo" onClick={copia} aria-label="Copia il link" title="Copia"><Ic n={copiato ? 'spunta' : 'copia'} /></button></div>
          <div className="cal-feed-tasti">
            <a className="cal-tasto cal-tasto--chiaro" href={link.webcal}>Apri su iPhone o Mac</a>
            <a className="cal-tasto cal-tasto--chiaro" href={'https://calendar.google.com/calendar/render?cid=' + encodeURIComponent(link.webcal)} target="_blank" rel="noopener noreferrer">Aggiungi a Google</a>
          </div>
          <p className="cal-feed-nota">Il link lo vede solo chi lo ha: non condividerlo. Escono titolo, orari e luogo delle tue voci; niente note, ritiri, giacenze né nomi di destinatari. Google lo rilegge ogni qualche ora.</p>
        </>
      ) : stato.attivo ? (
        <>
          <p className="cal-feed-testo">Collegamento attivo dal {giorno(stato.creato_il)}{stato.ultimo_uso ? `, letto l’ultima volta il ${giorno(stato.ultimo_uso)}` : ''}.</p>
          {aperta || <p className="cal-feed-nota">Per motivi di sicurezza il link si vede solo quando lo crei: se ti serve di nuovo, rigeneralo (quello vecchio smette di funzionare).</p>}
          <div className="cal-feed-tasti">
            <button className="cal-tasto cal-tasto--chiaro" disabled={occupato} onClick={crea}>Rigenera il link</button>
            <button className="cal-tasto cal-tasto--rosso" disabled={occupato} onClick={spegni}>Disattiva</button>
          </div>
        </>
      ) : (
        <>
          <p className="cal-feed-testo">Vedi le tue voci anche in Google Calendar o nel calendario dell’iPhone.</p>
          <button className="cal-tasto cal-tasto--chiaro" disabled={occupato} onClick={crea} style={{ width: '100%' }}>{occupato ? 'Creo…' : 'Crea il link'}</button>
        </>
      )}
      {errore && <div className="cal-msg" role="alert" style={{ marginTop: 8 }}>{errore}</div>}
    </div>
  )
}
