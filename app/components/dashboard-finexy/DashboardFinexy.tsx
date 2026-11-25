'use client'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { ldvProvvisoria, LDV_IN_ELABORAZIONE, numeroMostrato, nomeClientePulito } from '@/lib/numero-spedizione'
import BannerSms from '@/app/components/BannerSms'
import ResiReteWidget from '@/app/components/ResiReteWidget'
import DestinazioniWidget from '@/app/components/DestinazioniWidget'
import { CreditiDaRecuperare, IlTuoGuadagno, LaTuaRete, LavoroInCorso, MesePerMese, StatiTrentaGiorni, type DatiDashboard } from './SezioniFinexy'
import { euro, intero, statoDi } from './formati'
import { Barra3D, DefsBarre, profondita } from './Barre3D'
import './dashboard-finexy.css'

// LA DASHBOARD DEL MASTER nella composizione «Finexy» (Lorenzo 24/11/2026: «molto bene»), dentro il portale di oggi:
// il menu a sinistra non cambia. Il 25/11 Lorenzo: «non interessa che sia 1:1 dello screen, deve essere funzionale...
// nella vecchia versione ci stavano tanti blocchi, ora non se li ritrovano piu'». Quindi il disegno e' quello del
// riferimento, ma dentro ci sono TUTTI i riquadri della dashboard di oggi, sistemati per uso:
//   credito e conti | i quattro numeri di oggi | spedizioni per settimana
//   il lavoro in corso (le altre caselle di oggi, ognuna col suo periodo)
//   piano + corrieri | ultime spedizioni
//   la tua rete | gli stati degli ultimi 30 giorni | resi della rete
//   mese per mese (largo) | destinazioni
//   (gli SMS stanno in piccolo accanto al saluto)
//   crediti da recuperare (a scalare, a fattura)
//   il guadagno, con un periodo solo: totale | spedizioni (grafico); le voci in una fila
// Fuori resta solo la tabella «Statistiche spese spedizioni extra», che non ha mai mostrato dati (diceva sempre
// «Nessun dato disponibile»): rettifiche, resi e giacenze hanno le loro schede nel guadagno.
// I numeri vengono da /api/dashboard (passati dalla pagina), da /api/dashboard/plancia (oggi sul giorno di Roma,
// corrieri, settimane) e dalla lista dell'Elenco (le ultime cinque, coi prezzi che l'Elenco mostra).
// Niente controlli finti: nel riferimento la tabella ha caselle e «···» che qui non farebbero niente, quindi la
// riga intera apre la spedizione.

type Dashboard = DatiDashboard & {
  ruolo?: string
  masterNome?: string
  creditoMaster?: { rete?: number; proprio?: number; reteLabel?: string | null }
  codDaRimettere?: number; inTransito?: number; inGiacenza?: number
  spedizioniMese?: number; limiteMese?: number; illimitato?: boolean
  clientiTotali?: number; totClienti?: number; sottomaster?: number
}
type Corriere = { corriere: string; n: number }
type Plancia = {
  oggi: { totale: number; perCorriere: Corriere[] }
  stessoGiornoSettimanaScorsa: { giorno: string; totale: number; finoAlle?: string }
  mese: { dal: string; totale: number; perCorriere: Corriere[] }
  daChiudereOggi: number
  settimane: { dal: string; create: number; consegnate: number; nonConsegnate: number }[]
  aScalare: boolean
}
type Riga = {
  id: string; numero?: string | null; tracking_number?: string | null; dest_citta?: string | null; dest_provincia?: string | null
  stato?: string | null; created_at: string; prezzo_cliente?: number | null; costo_mostrato?: number | null; costo_totale?: number | null
  corrieri?: { nome_contratto?: string | null } | { nome_contratto?: string | null }[] | null
  clienti?: { ragione_sociale?: string | null } | { ragione_sociale?: string | null }[] | null
  master_rete?: string | null
}

const uno = <T,>(x: T | T[] | null | undefined): T | null => (Array.isArray(x) ? x[0] : x) || null

function saluto() {
  const ora = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()))
  return ora >= 5 && ora < 13 ? 'Buongiorno' : ora < 18 && ora >= 13 ? 'Buon pomeriggio' : 'Buonasera'
}

// Il segno del corriere nella tabella: le sigle dei contratti, mai i nomi dei fornitori tecnici.
function segnoCorriere(nome: string): [string, string, string] {
  const n = nome.toLowerCase()
  if (n.includes('brt')) return ['BRT', '#D7141A', '#fff']
  if (n.includes('sda')) return ['SDA', '#1F4E9B', '#fff']
  if (n.includes('gls')) return ['GLS', '#172A88', '#fff']
  if (n.includes('poste') || n.includes('crono')) return ['PT', '#F5C400', '#1a1a1a']
  if (n.includes('ups')) return ['UPS', '#4B2E1E', '#F5B800']
  if (n.includes('fedex')) return ['FDX', '#4D148C', '#fff']
  if (n.includes('dhl')) return ['DHL', '#FFCC00', '#D40511']
  if (n.includes('inpost')) return ['INP', '#FFCD00', '#1a1a1a']
  return [nome.slice(0, 3).toUpperCase(), '#6E6E73', '#fff']
}

// Una scala «tonda» per l'asse: 5 tacche, massimo da 1, 2, 2,5 o 5 per una potenza di dieci.
function scala(max: number) {
  if (max <= 0) return 5
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}
const breve = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k` : String(v)

const Icona = ({ d }: { d: string }) => <svg viewBox="0 0 24 24" aria-hidden="true"><path d={d} /></svg>

export default function DashboardFinexy({ data }: { data: Dashboard }) {
  const router = useRouter()
  const [plancia, setPlancia] = useState<Plancia | null>(null)
  const [erroreP, setErroreP] = useState<string | null>(null)
  const [righe, setRighe] = useState<Riga[] | null>(null)
  const [cerca, setCerca] = useState('')
  const area = useRef<HTMLDivElement>(null)
  const [misura, setMisura] = useState({ w: 330, h: 172 })

  useEffect(() => {
    const el = area.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height)
      if (w > 0 && h > 0) setMisura(m => (m.w === w && m.h === h ? m : { w, h }))
    })
    o.observe(el)
    return () => o.disconnect()
  }, [plancia])

  useEffect(() => {
    let vivo = true
    fetch('/api/dashboard/plancia', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (!vivo) return; if (d?.error) setErroreP(String(d.error)); else setPlancia(d) })
      .catch(() => { if (vivo) setErroreP('Numeri di oggi non disponibili') })
    fetch('/api/spedizioni/lista?page=1&perPage=5', { cache: 'no-store' }).then(r => r.json())
      .then(d => { if (vivo) setRighe(Array.isArray(d?.rows) ? d.rows : []) })
      .catch(() => { if (vivo) setRighe([]) })
    return () => { vivo = false }
  }, [])

  const rete = Number(data.creditoMaster?.rete || 0)
  const proprio = Number(data.creditoMaster?.proprio || 0)
  const nomeRete = (data.creditoMaster?.reteLabel || '').trim()
  const aScalare = plancia?.aScalare ?? true
  const giornoSettimana = new Intl.DateTimeFormat('it-IT', { weekday: 'long', timeZone: 'Europe/Rome' }).format(new Date())
  const meseNome = new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'Europe/Rome' }).format(new Date())

  // Create oggi contro lo stesso giorno della settimana scorsa, fino alla stessa ora (api/dashboard/plancia)
  const oggi = plancia?.oggi.totale ?? null
  const prima = plancia?.stessoGiornoSettimanaScorsa.totale ?? 0
  const variazione = oggi != null && prima > 0 ? Math.round((oggi - prima) / prima * 100) : null

  // Corrieri del mese: i primi due nelle carte, gli altri contati nella pillola
  const mese = plancia?.mese.perCorriere || []
  const oggiDi = (nome: string) => plancia?.oggi.perCorriere.find(c => c.corriere === nome)?.n || 0
  const quota = (n: number) => plancia?.mese.totale ? Math.round(n / plancia.mese.totale * 100) : 0

  // Grafico
  const sett = plancia?.settimane || []
  const massimo = scala(Math.max(0, ...sett.map(s => s.create)))
  const W = misura.w, H = misura.h, X0 = 30, Y0 = 14, Y1 = H - 22, slot = (W - X0) / 8, larga = Math.min(slot * 0.5, 28)
  const y = (v: number) => Y1 - v / massimo * (Y1 - Y0)

  const usoPiano = data.illimitato || !data.limiteMese ? 0 : Math.min(100, Number(data.spedizioniMese || 0) / Number(data.limiteMese) * 100)

  return (
    <div className="fx">
      <div className="fx-titolo">
        <div>
          <h1>{saluto()}, {data.masterNome || 'master'}</h1>
          <p>Le spedizioni di oggi, cosa c&apos;è da chiudere e come va la tua rete.</p>
        </div>
        <BannerSms />
      </div>

      <div className="fx-griglia">
        {/* CREDITO E CONTI */}
        <section className="fx-scheda">
          <div className="fx-testa">
            <span className="fx-etichetta">Credito</span>
            {nomeRete && <span className="fx-pillola" title={`Il conto che hai presso ${nomeRete}`}><i>{nomeRete.slice(0, 1).toUpperCase()}</i>{nomeRete}</span>}
          </div>
          <div className={`fx-saldo${aScalare && rete < 0 ? ' fx-saldo--meno' : ''}`}>{euro(rete)}</div>
          {/* A zero non e' «esaurito»: chi spedisce sui contratti suoi (Wave il 24/11/2026: rete 0, 5.178 spedizioni
              in giornata) ha il conto di rete fermo a zero e lavora lo stesso. */}
          <div className="fx-nota">
            {aScalare
              ? <><span className={`fx-chip ${rete > 0 ? 'fx-chip--bene' : rete < 0 ? 'fx-chip--male' : 'fx-chip--neutro'}`}>{rete > 0 ? 'a credito' : rete < 0 ? 'sotto zero' : 'a zero'}</span>conto a scalare</>
              : <><span className="fx-chip fx-chip--neutro">a fattura</span>lo saldi con la fattura</>}
          </div>
          <div className="fx-tasti">
            <a className="fx-tasto fx-tasto--nero" href="/dashboard/movimenti"><Icona d="M4 6h16M4 12h16M4 18h10" />Movimenti</a>
            <a className="fx-tasto fx-tasto--chiaro" href="/dashboard/fatture"><Icona d="M7 3h10a2 2 0 012 2v16l-3-2-3 2-3-2-3 2V5a2 2 0 012-2zM9 8h6M9 12h6" />Fatture</a>
          </div>
          <div className="fx-conti">
            <div className="fx-conti-testa">I tuoi conti</div>
            <div className="fx-conti-righe">
              <div className="fx-conto">
                <div className="fx-conto-nome" title={nomeRete ? `Il conto presso ${nomeRete}` : undefined}><b style={{ background: 'var(--fx-arancio)' }} />Rete</div>
                <div className="fx-conto-cifra">{euro(rete)}</div>
                <div className="fx-conto-sotto">conto di rete</div>
                <div className={`fx-conto-stato${aScalare && rete > 0 ? ' fx-conto-stato--bene' : aScalare && rete < 0 ? ' fx-conto-stato--male' : ''}`}>{aScalare ? 'a scalare' : 'a fattura'}</div>
              </div>
              {proprio !== 0 ? (
                <div className="fx-conto">
                  <div className="fx-conto-nome"><b style={{ background: 'var(--fx-nero)' }} />Proprio</div>
                  <div className="fx-conto-cifra">{euro(proprio)}</div>
                  <div className="fx-conto-sotto">contratti tuoi</div>
                  <div className="fx-conto-stato">&nbsp;</div>
                </div>
              ) : (
                <div className="fx-conto">
                  <div className="fx-conto-nome"><b style={{ background: 'var(--fx-nero)' }} />Rete clienti</div>
                  <div className="fx-conto-cifra">{intero(Number(data.clientiTotali ?? data.totClienti ?? 0))} clienti</div>
                  <div className="fx-conto-sotto">{intero(Number(data.sottomaster || 0))} sotto-master</div>
                  <div className="fx-conto-stato">&nbsp;</div>
                </div>
              )}
              <a className="fx-conto" href="/dashboard/contrassegni">
                <div className="fx-conto-nome"><b style={{ background: 'var(--fx-bene)' }} />Contrassegni</div>
                <div className="fx-conto-cifra">{euro(Number(data.codDaRimettere || 0))}</div>
                <div className="fx-conto-sotto" title="Contrassegni incassati sui pacchi consegnati, da rimettere ai clienti">incassati</div>
                <div className={`fx-conto-stato${Number(data.codDaRimettere || 0) > 0 ? ' fx-conto-stato--arancio' : ''}`}>{Number(data.codDaRimettere || 0) > 0 ? 'da rimettere' : 'niente da rimettere'}</div>
              </a>
            </div>
          </div>
        </section>

        {/* I QUATTRO NUMERI DI OGGI */}
        <section className="fx-scheda" style={{ padding: 0 }}>
          <div className="fx-numeri">
            {/* CREATE e PARTITE sono due numeri diversi: create oggi (dal giorno di Roma, col confronto) e partite oggi,
                cioe' create oggi e gia' uscite dalla lavorazione (spedite, in viaggio, consegnate), il numero che la
                dashboard di oggi chiamava «Partite oggi» (dashboard_contatori_master). Il 25/11 alle 13 Ecomize LL: 154
                create, 14 partite; nella prima prova le create stavano sotto il nome «Partite oggi». */}
            <a className="fx-numero fx-numero--pieno" href="/dashboard/spedizioni">
              <div className="fx-numero-testa">Create oggi<i><Icona d="M12 5v14M5 12h14" /></i></div>
              <div className="fx-numero-cifra">{oggi == null ? '…' : intero(oggi)}</div>
              <div className="fx-nota">{variazione == null ? 'dal mattino, ora di Roma'
                : <><span className="fx-chip fx-chip--vetro">{variazione >= 0 ? '↑' : '↓'} {Math.abs(variazione)}%</span>
                  <span title={`${giornoSettimana} scorso fino alle ${plancia?.stessoGiornoSettimanaScorsa.finoAlle || 'stessa ora'}: ${intero(prima)} spedizioni`}>su {giornoSettimana} scorso alla stessa ora</span></>}</div>
            </a>
            <a className="fx-numero" href="/dashboard/spedizioni" title="Create oggi e già uscite dalla lavorazione: spedite, in viaggio, consegnate">
              <div className="fx-numero-testa">Partite oggi<i><Icona d="M3 7h11v9H3zM14 10h4l3 3v3h-7M7 19.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM17 19.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" /></i></div>
              <div className="fx-numero-cifra">{intero(Number(data.spediteOggi || 0))}</div>
              <div className="fx-nota"><span className="fx-chip fx-chip--neutro">oggi</span>già in viaggio</div>
            </a>
            <a className="fx-numero" href="/dashboard/distinte/crea">
              <div className="fx-numero-testa">Da chiudere<i><Icona d="M7 3h10a2 2 0 012 2v14a2 2 0 01-2 2H7a2 2 0 01-2-2V5a2 2 0 012-2zM9 9h6M9 13h6" /></i></div>
              <div className="fx-numero-cifra">{plancia ? intero(plancia.daChiudereOggi) : '…'}</div>
              <div className="fx-nota"><span className="fx-chip fx-chip--neutro">oggi</span>senza distinta</div>
            </a>
            <a className="fx-numero" href="/dashboard/spedizioni?stato=in_giacenza">
              <div className="fx-numero-testa">In giacenza<i><Icona d="M8 5v14M16 5v14" /></i></div>
              <div className="fx-numero-cifra">{intero(Number(data.inGiacenza || 0))}</div>
              <div className="fx-nota">{Number(data.inGiacenza || 0) > 0 ? <span className="fx-chip fx-chip--male">da sbloccare</span> : <span className="fx-chip fx-chip--bene">nessuna</span>}</div>
            </a>
          </div>
        </section>

        {/* SPEDIZIONI PER SETTIMANA */}
        <section className="fx-scheda fx-grafico-scheda">
          <h2 style={{ margin: 0, fontSize: 17, fontWeight: 500, letterSpacing: -0.2 }}>Spedizioni per settimana</h2>
          <p className="fx-sotto">Consegnate e non ancora consegnate</p>
          <div className="fx-pannello">
            <div className="fx-pannello-testa">Ultime 8 settimane
              <span className="fx-legenda"><span><b style={{ background: '#EE5A2A' }} />Non consegnate</span><span><b style={{ background: 'var(--fx-nero)' }} />Consegnate</span></span>
            </div>
            <div className="fx-grafico" ref={area}>
              {!plancia ? <div className="fx-vuoto">{erroreP || 'Carico le settimane…'}</div> : (
                <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spedizioni per settimana, ultime 8 settimane">
                  <DefsBarre id="fxs" />
                  {[0, 1, 2, 3, 4, 5].map(i => {
                    const v = massimo * (5 - i) / 5, yy = Y0 + i * (Y1 - Y0) / 5
                    return <g key={i}><text className="fx-asse" x={0} y={yy + 3}>{breve(v)}</text>{i < 5 && <line x1={X0} x2={W} y1={yy} y2={yy} stroke="#E9E9E9" strokeWidth="0.6" />}</g>
                  })}
                  {sett.map((s, i) => {
                    const x = X0 + i * slot + (slot - larga - profondita(larga)) / 2, yc = y(s.consegnate), ya = y(s.create)
                    return (
                      <g key={s.dal}>
                        <title>{`Settimana dal ${s.dal}: ${intero(s.create)} create, ${intero(s.consegnate)} consegnate, ${intero(s.nonConsegnate)} non ancora`}</title>
                        <Barra3D id="fxs" x={x} y={yc} larga={larga} alta={Math.max(0, Y1 - yc)} tinta="nero" cima={s.nonConsegnate <= 0} />
                        {s.nonConsegnate > 0 && <Barra3D id="fxs" x={x} y={ya} larga={larga} alta={Math.max(yc - ya, 2)} tinta="righe" ombra={false} />}
                        <text className="fx-asse" x={x + (larga + profondita(larga)) / 2} y={H - 4} textAnchor="middle">{s.dal}</text>
                      </g>
                    )
                  })}
                </svg>
              )}
            </div>
          </div>
        </section>

        {/* IL LAVORO IN CORSO: le altre caselle della dashboard di oggi */}
        <LavoroInCorso data={data} />

        <div className="fx-colonna">
          {/* IL PIANO */}
          <section className="fx-scheda">
            <h2 style={{ margin: 0, fontSize: 13.5, fontWeight: 500 }}>Il tuo piano a {meseNome}</h2>
            <div className="fx-piano-barra"><div style={{ width: `${data.illimitato ? 100 : usoPiano}%`, background: data.illimitato ? 'var(--fx-nero)' : undefined }} /></div>
            <div className="fx-piano-numeri">
              <span><b>{intero(Number(data.spedizioniMese || 0))}</b>spedizioni create, su</span>
              <span>{data.illimitato ? 'illimitate' : intero(Number(data.limiteMese || 0))}</span>
            </div>
          </section>

          {/* I CORRIERI DEL MESE */}
          <section className="fx-scheda" style={{ overflow: 'hidden' }}>
            <div className="fx-testa">
              <h2 style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 12 }}>
                <svg viewBox="0 0 24 24" width="21" height="21" fill="none" stroke="#333" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17" cy="18" r="1.6" /></svg>
                I tuoi corrieri
              </h2>
              {mese.length > 2 && <a className="fx-altri" href="/dashboard/statistiche/corrieri">+ altri {mese.length - 2}</a>}
            </div>
            {!plancia ? <div className="fx-vuoto">{erroreP || 'Carico i corrieri…'}</div> : !mese.length ? <div className="fx-vuoto">Nessuna spedizione a {meseNome}</div> : (
              <div className="fx-carte">
                {mese.slice(0, 2).map((c, i) => (
                  <div key={c.corriere} className={`fx-carta ${i === 0 ? 'fx-carta--nera' : 'fx-carta--arancio'}`}>
                    <div className="fx-carta-testa"><b>{quota(c.n)}%</b>{i === 0 ? 'delle spedizioni del mese' : ''}</div>
                    <div className="fx-carta-nome" title={c.corriere}>{c.corriere}</div>
                    <div className="fx-carta-cifre">
                      <div>{meseNome.charAt(0).toUpperCase() + meseNome.slice(1)}<b>{intero(c.n)}</b></div>
                      <div>Oggi<b>{intero(oggiDi(c.corriere))}</b></div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>

        {/* ULTIME SPEDIZIONI */}
        <section className="fx-scheda fx-largo">
          <div className="fx-testa">
            <h2>Ultime spedizioni</h2>
            <div className="fx-cerca">
              <label><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                <input value={cerca} onChange={e => setCerca(e.target.value)} placeholder="Cerca"
                  onKeyDown={e => { if (e.key === 'Enter' && cerca.trim()) router.push(`/dashboard/spedizioni?cerca=${encodeURIComponent(cerca.trim())}`) }} />
              </label>
              <a className="fx-filtri" href="/dashboard/spedizioni">Filtri<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M7 12h10M10 17h4" /></svg></a>
            </div>
          </div>
          <div className="fx-tabella-box">
            {righe == null ? <div className="fx-vuoto">Carico le ultime spedizioni…</div> : !righe.length ? <div className="fx-vuoto">Nessuna spedizione ancora</div> : (
              <table className="fx-tabella">
                {/* La data sta sotto il numero, come il cliente sotto la destinazione, e la riga intera si apre col
                    clic (senza la colonna della freccia): con le colonne Data e › la tabella usciva dalla scheda (25/11,
                    Ecomize LL a 1440: 825 px su 745, la data tagliata a «25/11 1»). */}
                <thead><tr><th>N. spedizione</th><th>Cliente e destinazione</th><th>Prezzo cliente</th><th>Stato</th></tr></thead>
                <tbody>
                  {righe.map(r => {
                    const corr = uno(r.corrieri)?.nome_contratto || ''
                    const [sigla, fondo, scritta] = segnoCorriere(corr)
                    const [stato, colore] = statoDi(r.stato || '')
                    // Cliente e prezzo come li scrive l'Elenco (app/dashboard/spedizioni): il cliente, e il sotto-master
                    // da cui arriva; il prezzo al cliente, non il costo.
                    const cliente = [nomeClientePulito(uno(r.clienti)?.ragione_sociale || ''), r.master_rete || ''].filter(Boolean).join(' · ')
                    const prezzo = r.prezzo_cliente ?? r.costo_mostrato ?? r.costo_totale
                    return (
                      <tr key={r.id} onClick={() => router.push(`/dashboard/spedizioni/${r.id}`)}>
                        <td>{ldvProvvisoria(r.numero) ? LDV_IN_ELABORAZIONE : (numeroMostrato(r.numero, r.tracking_number) || '—')}
                          <span className="fx-piccolo" title={new Intl.DateTimeFormat('it-IT', { dateStyle: 'full', timeStyle: 'short', timeZone: 'Europe/Rome' }).format(new Date(r.created_at))}>
                            {new Intl.DateTimeFormat('it-IT', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Rome' }).format(new Date(r.created_at)).replace(',', '')}</span></td>
                        <td><span className="fx-dest"><span className="fx-corriere" style={{ background: fondo, color: scritta }} title={corr}>{sigla}</span>
                          <span>{[r.dest_citta, r.dest_provincia ? `(${r.dest_provincia})` : ''].filter(Boolean).join(' ') || '—'}
                            {cliente && <span className="fx-piccolo" title={cliente}>{cliente}</span>}</span></span></td>
                        <td>{prezzo == null ? '—' : euro(Number(prezzo))}</td>
                        <td><span className="fx-stato"><i style={{ background: colore }} />{stato}</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>

        {/* LA RETE: tasso di consegna e i primi, gli stati degli ultimi 30 giorni, i resi */}
        <LaTuaRete data={data} />
        <StatiTrentaGiorni stati={data.statiUltimi30 || {}} />
        <ResiReteWidget fx />

        {/* MESE PER MESE (largo) e DESTINAZIONI (la mappa in rilievo e le prime province) */}
        <MesePerMese mesi={data.statsMensili || []} />
        <DestinazioniWidget fx />

        {/* I CREDITI DA RECUPERARE: compaiono solo se ci sono, meta' e meta' */}
        {(Number(data.creditiDaRecuperare?.scalare?.clienti || 0) > 0 || Number(data.creditiDaRecuperare?.fattura?.clienti || 0) > 0) && (
          <div className="fx-tutta fx-fila">
            <CreditiDaRecuperare crediti={data.creditiDaRecuperare} />
          </div>
        )}

        {/* IL GUADAGNO: un periodo per tutte le voci. Il totale e' il calderone del master: spedizioni + rettifiche +
            rimborsi + resi + giacenze + commissioni + accessori + logistica + canone, una cifra senza doppi conteggi e
            senza i soldi che passano soltanto (ricariche, cassa dei contrassegni), vedi /api/reports/guadagno-totale. */}
        <IlTuoGuadagno ruolo={data.ruolo} />
      </div>
    </div>
  )
}
