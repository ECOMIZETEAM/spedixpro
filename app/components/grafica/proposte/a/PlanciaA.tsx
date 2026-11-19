'use client'
// PROPOSTA A DI PLANCIA — «TORRE DI CONTROLLO» (27/10). La prima schermata è la sala di controllo della rete: al
// centro l'Italia vera, inclinata sul tavolo, che si accende col volume degli ultimi 30 giorni; ai bordi i pannelli
// di vetro (in alto i numeri di oggi, a sinistra il nastro delle ultime spedizioni, a destra gli anelli, in basso la
// linea del giorno). Sotto, nello stesso linguaggio, il resto: giacenze, stati, soldi, saldi, rete.
// Tutti i numeri vengono dalle rotte del portale, solo letture GET; dove un dato manca il riquadro lo dice.
// Niente segue il mouse (a Lorenzo fa venire mal di testa): si muove all'apertura, quando arrivano i dati e scorrendo.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useDatiPlancia } from '../dati'
import { Conta, calmo, useScorrimentoMorbido } from '../../movimento'
import { fmtN, GIORNI, MESI, usaJson } from '../../PlanciaNuova'
import { Icona } from '../../icone'
import { vettoreFisico } from '@/lib/vettore'
import { MappaItalia, type Volo } from './mappa'
import { Sezioni } from './sezioni'
import './plancia-a.css'

const intero = (n: number) => fmtN.format(n)
const pct = (v: number) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',')
const due = (n: number) => String(n).padStart(2, '0')

// lo stato di una spedizione: la parola e il tono del puntino
export const STATO: Record<string, [string, string]> = {
  in_lavorazione: ['In lavorazione', 'corso'], spedita: ['Spedita', 'corso'], in_transito: ['In transito', 'corso'], in_consegna: ['In consegna', 'corso'],
  consegnata: ['Consegnata', 'bene'], in_giacenza: ['In giacenza', 'problema'], non_consegnato: ['Non consegnata', 'problema'],
  reso_mittente: ['Reso al mittente', 'problema'], annullata: ['Annullata', 'fermo'], storno_richiesto: ['Storno richiesto', 'fermo'],
  annullamento_pending: ['In annullamento', 'fermo'],
}

// solo i vettori veri: se il nome del contratto non ne dice uno, meglio niente che una parola presa a caso
const VETTORI = new Set(['GLS', 'BRT', 'POSTE', 'SDA', 'UPS', 'DHL', 'TNT', 'FEDEX', 'INPOST', 'NEXIVE', 'HERMES', 'SAILPOST', 'FERCAM'])
const vettoreDi = (s: any) => { const v = vettoreFisico({ nome_contratto: s?.corrieri?.nome_contratto || '' }); return VETTORI.has(v) ? v : '' }
const sigla = (v: any) => { const s = String(v || '').replace(/[^A-Za-z]/g, '').toUpperCase(); return s.length === 2 ? s : '' }

export default function PlanciaA() {
  const { data, giornata, badge, quando, tema, entrata } = useDatiPlancia()
  const dest = usaJson<any>('/api/dashboard/destinazioni')
  const resi = usaJson<any>('/api/resi/analisi?giorni=90&riepilogo=1')
  const topo = usaJson<any>('/geo/italia-province.json')
  // la sede del master (la provincia operativa, se no quella legale): da qui partono gli archi. Se non c'è, niente archi
  const master = usaJson<any>('/api/master')
  const [nomiProv, setNomiProv] = useState<Map<string, string> | null>(null)
  const sede = useMemo(() => {
    const s = String(master?.provincia_operativo || master?.provincia || '').trim()
    if (!s) return null
    if (/^[A-Za-z]{2}$/.test(s)) return s.toUpperCase()
    if (!nomiProv) return null
    for (const [k, n] of nomiProv) if (n.toLowerCase() === s.toLowerCase()) return k
    return null
  }, [master, nomiProv])
  const prendiNomi = useCallback((m: Map<string, string>) => setNomiProv(m), [])

  // l'entrata dai bordi: una volta per sessione, come la Plancia nuova (?entrata=si la rifà)
  const [entra, setEntra] = useState(entrata)
  useEffect(() => {
    document.cookie = 'mx_entrata=1; path=/; samesite=lax'
    if (new URLSearchParams(location.search).get('entrata') === 'si') { setEntra(false); requestAnimationFrame(() => requestAnimationFrame(() => setEntra(true))) }
  }, [])

  // l'ora per la linea del giorno: parte dopo l'apertura (server e browser devono disegnare la stessa pagina) e si
  // rinfresca ogni 20 secondi; i secondi li batte l'Orologio da solo, senza ridisegnare tutta la sala
  const [ora, setOra] = useState<Date | null>(null)
  useEffect(() => { setOra(new Date()); const t = setInterval(() => setOra(new Date()), 20000); return () => clearInterval(t) }, [])

  // ── il palco: la sua misura e il riquadro libero al centro, dove sta l'Italia ──
  const radice = useRef<HTMLDivElement>(null), palco = useRef<HTMLElement>(null), finestra = useRef<HTMLDivElement>(null)
  const [misura, setMisura] = useState<{ W: number; H: number; box: { x: number; y: number; w: number; h: number }; fin: { x: number; y: number; w: number; h: number } } | null>(null)
  useEffect(() => {
    const misura = () => {
      const p = palco.current?.getBoundingClientRect(), f = finestra.current?.getBoundingClientRect()
      if (!p || !f || p.width < 50) return
      const stretto = p.width < 900
      // l'Italia si allarga un poco sotto il vetro dei pannelli (la sala sembra più grande dei suoi bordi); le
      // etichette e la bussola invece restano dentro la finestra
      const box = stretto ? { x: 12, y: f.top - p.top + 20, w: p.width - 24, h: f.height - 30 } : { x: f.left - p.left - 64, y: f.top - p.top + 22, w: f.width + 128, h: f.height - 10 }
      const tondo = (r: { x: number; y: number; w: number; h: number }) => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) })
      const nuovo = { W: Math.round(p.width), H: Math.round(p.height), box: tondo(box), fin: tondo({ x: f.left - p.left, y: f.top - p.top, w: f.width, h: f.height }) }
      setMisura(m => (m && JSON.stringify(m) === JSON.stringify(nuovo) ? m : nuovo))
    }
    misura()
    const ro = new ResizeObserver(misura)
    if (palco.current) ro.observe(palco.current)
    if (finestra.current) ro.observe(finestra.current)
    return () => ro.disconnect()
  }, [])

  useScorrimentoMorbido(radice)

  // ── il nastro: le ultime spedizioni entrano una alla volta, la più vecchia per prima, la più nuova in cima ──
  const ultime: any[] = useMemo(() => data?.ultimeSpedizioni || [], [data])
  const [quante, setQuante] = useState(0)
  const arrivate = ultime.length > 0
  useEffect(() => {
    if (!arrivate) return
    if (calmo()) { setQuante(10); return }
    let k = 0
    const t = setInterval(() => { k++; setQuante(k); if (k >= 10) clearInterval(t) }, 520)
    return () => clearInterval(t)
  }, [arrivate])
  const nastro = useMemo(() => ultime.slice(Math.max(0, ultime.length - quante)), [ultime, quante])
  // gli archi del nastro: dal mittente al destinatario, solo in Italia e solo se le due province si sanno
  const voli: Volo[] = useMemo(() => nastro.slice(0, 6)
    .filter(s => !(s.dest_paese && s.dest_paese !== 'IT') && !(s.mitt_paese && s.mitt_paese !== 'IT'))
    .map((s, i) => ({ id: String(s.id || s.numero || i), da: sigla(s.mitt_provincia), a: sigla(s.dest_provincia), nuovo: i === 0 }))
    .filter(v => v.da && v.a), [nastro])

  const fuori = Number(data?.daMettereInDistinta || 0), giacenze = Number(data?.inGiacenza || 0)
  const limite = Number(data?.limiteMese || 0), mese = Number(data?.spedizioniMese || 0)
  const consegnate = Number(data?.consegnateTotali || 0), totali = Number(data?.spedizioniTotali || 0)

  return (
    <div className={'pa' + (entra ? ' pa-entra' : '')} ref={radice}>
      <section className="pa-palco" ref={palco} aria-label="Torre di controllo: oggi">
        <div className="pa-palco__fondo" aria-hidden="true" />
        {misura && <MappaItalia W={misura.W} H={misura.H} box={misura.box} fin={misura.fin} topo={topo} dest={dest?.province || null} sede={sede} voli={voli} tema={tema} nomi={prendiNomi} />}

        <div className="pa-griglia-palco">
          <header className="pa-intesta">
            <small><i className="pa-vivo" />Torre di controllo</small>
            <h1>{String(data?.masterNome || '').trim() || '…'}</h1>
            <Orologio />
          </header>

          <div className="pa-oggi gx-vetro">
            <a href="/dashboard/spedizioni" className="pa-oggi__voce">
              <span>Partite oggi</span>
              <b>{data ? <Conta v={Number(data.spediteOggi || 0)}>{intero}</Conta> : '—'}</b>
              <em>{data ? `${intero(Number(data.inLavorazione || 0))} in lavorazione` : ' '}</em>
            </a>
            <a href="/dashboard/spedizioni" className="pa-oggi__voce">
              <span>Create oggi</span>
              <b>{giornata ? <Conta v={Number(giornata.create || 0)}>{intero}</Conta> : '—'}</b>
              <em>{giornata ? `${intero(Number(giornata.fuoriDistinta || 0))} ancora fuori distinta` : ' '}</em>
            </a>
            <a href="/dashboard/distinte/crea" className="pa-oggi__voce pa-oggi__voce--accento">
              <span>Fuori distinta</span>
              <b>{data ? <Conta v={fuori}>{intero}</Conta> : '—'}</b>
              <em>da chiudere, tutta la rete</em>
            </a>
            <a href="/dashboard/spedizioni/giacenze" className={'pa-oggi__voce' + (giacenze ? ' pa-oggi__voce--problema' : '')}>
              <span>Giacenze</span>
              <b>{data ? <Conta v={giacenze}>{intero}</Conta> : '—'}</b>
              <em>{data ? (giacenze ? 'aspettano le tue istruzioni' : 'nessuna da risolvere') : ' '}</em>
            </a>
          </div>

          <aside className="pa-nastro gx-vetro" aria-label="Le ultime spedizioni">
            {/* l'ora dell'ultima lettura: il nastro si rilegge da solo ogni due minuti, «in diretta» sarebbe una promessa */}
            <div className="pa-pan__testa"><span>Ultime spedizioni</span><em><i className="pa-vivo" />{quando ? `agg. ${due(quando.getHours())}:${due(quando.getMinutes())}` : ''}</em></div>
            {data && !ultime.length && <p className="pa-vuoto">Ancora nessuna spedizione.</p>}
            {!data && <p className="pa-vuoto">…</p>}
            <ol>
              {nastro.map((s, i) => {
                const st = STATO[s.stato] || [String(s.stato || ''), 'fermo']
                const d = new Date(s.created_at), da = sigla(s.mitt_provincia), a = sigla(s.dest_provincia), v = vettoreDi(s)
                return (
                  <li key={s.id || s.numero || i} className={i === 0 && quante > 1 ? 'pa-nastro__nuova' : undefined}>
                    <i className={'pa-punto pa-punto--' + st[1]} />
                    <time>{isNaN(+d) ? '' : `${due(d.getHours())}:${due(d.getMinutes())}`}</time>
                    <b>{String(s.dest_citta || '—')}</b>
                    {v && <em>{v}</em>}
                    <span>{st[0]}</span>
                    {da && a && <small>{da} → {a}</small>}
                  </li>
                )
              })}
            </ol>
            <a className="pa-pan__piede" href="/dashboard/spedizioni">Elenco spedizioni<Icona id="i-chevron" /></a>
          </aside>

          {/* il riquadro libero al centro: lì sta l'Italia (la mappa è sotto, a tutto palco); gli angoli di mira e la
              legenda della carta stanno sul suo bordo */}
          <div className="pa-finestra" ref={finestra} aria-hidden="true">
            {dest && (
              <div className="pa-legenda">
                <span>Italia · ultimi 30 giorni</span>
                <span><b>{intero(Number(dest.totale || 0))}</b> spedizioni</span>
                <span><b>{intero(Number(dest.nProvince || 0))}</b> province</span>
                <span className="pa-legenda__scala"><i />poche → molte</span>
                {voli.length > 0 && <span className="pa-legenda__archi"><i />le ultime spedizioni, dal mittente al destinatario</span>}
              </div>
            )}
          </div>

          <aside className="pa-anelli gx-vetro" aria-label="Indicatori">
            <Anello v={data && data.tassoConsegna != null ? Number(data.tassoConsegna) : null} attesa={!data} titolo="Consegnate" quando="da sempre"
              sotto={data && totali ? `${intero(consegnate)} su ${intero(totali)}` : ''} />
            {data && (data.illimitato || !limite)
              ? <Anello v={null} pieno titolo="Piano del mese" quando="senza limite" sotto={`${intero(mese)} spedizioni nel mese`} />
              : <Anello v={data ? mese / limite * 100 : null} attesa={!data} titolo="Piano del mese" quando={quando ? MESI[quando.getMonth()] : 'questo mese'}
                sotto={data ? `${intero(mese)} su ${intero(limite)}` : ''} />}
            <Anello v={resi?.totale?.pct != null ? Number(resi.totale.pct) : null} attesa={!resi} titolo="Resi" quando="ultimi 90 giorni" problema
              sotto={resi ? `${intero(Number(resi.totale?.resi || 0))} su ${intero(Number(resi.totale?.partite || 0))} partite` : ''} />
          </aside>

          <Giornata g={giornata} ora={ora} />
        </div>

      </section>

      <Sezioni data={data} badge={badge} resi={resi} quando={quando} />
    </div>
  )
}

// ── l'orologio della sala: giorno, ore, minuti e secondi (i secondi più chiari) ──
function Orologio() {
  const [t, setT] = useState<Date | null>(null)
  useEffect(() => { setT(new Date()); const k = setInterval(() => setT(new Date()), 1000); return () => clearInterval(k) }, [])
  return <p>{t ? <>{GIORNI[t.getDay()].slice(0, 3)} {t.getDate()} {MESI[t.getMonth()].slice(0, 3)} · <b>{due(t.getHours())}:{due(t.getMinutes())}<span>:{due(t.getSeconds())}</span></b></> : ' '}</p>
}

// ── un anello: il valore come arco attorno, le tacche del quadrante fuori, il numero dentro ──
function Anello({ v, titolo, quando, sotto, problema, pieno, attesa }: { v: number | null; titolo: string; quando: string; sotto: string; problema?: boolean; pieno?: boolean; attesa?: boolean }) {
  const [pronto, setPronto] = useState(false)
  useEffect(() => { if (v === null && !pieno) return; const t = setTimeout(() => setPronto(true), calmo() ? 0 : 200); return () => clearTimeout(t) }, [v, pieno])
  const quota = pieno ? 100 : Math.max(0, Math.min(100, v || 0))
  return (
    <div className={'pa-anello' + (problema ? ' pa-anello--problema' : '') + (pieno ? ' pa-anello--pieno' : '')}>
      <div className="pa-anello__quadrante">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          {/* le coordinate arrotondate: coi decimali pieni server e browser scrivevano numeri diversi all'ultima cifra */}
          {Array.from({ length: 48 }, (_, i) => {
            const a = i / 48 * Math.PI * 2 - Math.PI / 2, lungo = i % 4 === 0, r0 = lungo ? 53.5 : 55.5, r1 = 58.5, f = (v: number) => (60 + v).toFixed(2)
            return <line key={i} className={i / 48 * 100 < quota && pronto ? 'pa-tacca pa-tacca--su' : 'pa-tacca'} x1={f(Math.cos(a) * r0)} y1={f(Math.sin(a) * r0)} x2={f(Math.cos(a) * r1)} y2={f(Math.sin(a) * r1)} style={{ transitionDelay: (i * 18) + 'ms' }} />
          })}
          <circle cx="60" cy="60" r="46" className="pa-anello__binario" />
          <circle cx="60" cy="60" r="46" className="pa-anello__valore" pathLength={100} transform="rotate(-90 60 60)"
            style={{ strokeDasharray: `${pronto ? quota : 0} 100` }} />
        </svg>
        <b>{pieno ? <span className="pa-anello__inf">∞</span> : v === null ? (attesa ? '…' : '—') : <span className="pa-anello__n"><Conta v={Math.round(v * 10) / 10}>{n => pct(n)}</Conta><small>%</small></span>}</b>
      </div>
      <div className="pa-anello__testo">
        <span>{titolo}</span>
        <em>{quando}</em>
        {/* in attesa della rotta i puntini; se la rotta ha risposto senza il dato, lo si dice */}
        <small>{sotto || (v === null && !pieno && !attesa ? 'dato non disponibile' : '')}</small>
      </div>
    </div>
  )
}

// ── la linea del giorno: le create ora per ora (a puntini quelle già in distinta, a righe quelle ancora fuori),
// le ore che devono ancora venire velate, e la lancetta di adesso ──
function Giornata({ g, ora }: { g: any; ora: Date | null }) {
  const ore: any[] = g?.ore?.length ? g.ore : Array.from({ length: 24 }, (_, i) => ({ ora: i, create: 0, fuoriDistinta: 0 }))
  const max = Math.max(4, ...ore.map(o => Number(o.create || 0)))
  const adesso = ora ? ora.getHours() + ora.getMinutes() / 60 : null
  const picco = ore.reduce((a: any, o: any) => (Number(o.create) > Number(a?.create || 0) ? o : a), null)
  return (
    <div className="pa-giorno gx-vetro" aria-label="La linea del giorno">
      <div className="pa-giorno__testa">
        <span>Linea del giorno</span>
        <b>{g ? intero(Number(g.create || 0)) : '—'}<small>create</small></b>
        <em>{g ? `${intero(Number(g.fuoriDistinta || 0))} fuori distinta` : ' '}</em>
        <em>{picco && Number(picco.create) > 0 ? `picco alle ${due(picco.ora)}:00 · ${intero(Number(picco.create))}` : ' '}</em>
      </div>
      <div className="pa-giorno__ore" role="img" aria-label={g ? 'Create oggi ora per ora: ' + ore.filter(o => o.create).map(o => `${o.ora}: ${o.create}`).join(', ') : 'Create oggi ora per ora'}>
        {ore.map((o, i) => {
          const c = Number(o.create || 0), f = Math.min(c, Number(o.fuoriDistinta || 0)), dentro = c - f
          const futura = adesso !== null && o.ora > adesso
          return (
            <div key={o.ora} className={'pa-ora' + (futura ? ' pa-ora--futura' : '')} style={{ ['--i' as any]: i }}>
              <div className="pa-ora__barra" title={`${due(o.ora)}:00 · ${c} create, ${f} fuori distinta`}>
                {f > 0 && <i className="pa-ora__fuori" style={{ height: (f / max * 100) + '%' }} />}
                {dentro > 0 && <i className="pa-ora__dentro" style={{ height: (dentro / max * 100) + '%' }} />}
              </div>
              <span>{o.ora % 3 === 0 ? due(o.ora) : ''}</span>
            </div>
          )
        })}
        {adesso !== null && ora && <div className="pa-lancetta" style={{ left: `${adesso / 24 * 100}%` }}><span>{due(ora.getHours())}:{due(ora.getMinutes())}</span></div>}
      </div>
      <ul className="pa-giorno__chiave" aria-hidden="true"><li><i className="pa-ora__dentro" />in distinta</li><li><i className="pa-ora__fuori" />fuori distinta</li></ul>
    </div>
  )
}
