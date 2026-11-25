'use client'
import { useEffect, useRef, useState } from 'react'
import SmsFinexy from './SmsFinexy'
import ContiFinexy from './ContiFinexy'
import ResiReteWidget from '@/app/components/ResiReteWidget'
import DestinazioniWidget from '@/app/components/DestinazioniWidget'
import { CreditiDaRecuperare, LaTuaRete, LavoroInCorso, MesePerMese, StatiTrentaGiorni, type DatiDashboard } from './SezioniFinexy'
import { IlTuoGuadagno } from './GuadagnoFinexy'
import { euro, intero } from './formati'
import { Barra3D, DefsBarre, profondita } from './Barre3D'
import Conta from './Conta'
import './dashboard-finexy.css'

// LA DASHBOARD DEL MASTER nella grafica nuova. Il 25/11 Lorenzo: «non interessa che sia 1:1 dello screen, deve essere
// funzionale... nella vecchia versione ci stavano tanti blocchi, ora non se li ritrovano piu'»; poi, sulla fascia nera
// del mese: «mi piace questo... rifacciamo sta dashboard in modo figo come questo». Quindi: TUTTI i riquadri della
// dashboard di oggi, nella lingua della fascia: lastre scure, numeri grandi e chiari con l'etichetta sopra e la nota
// sotto, divisori sottili invece delle caselle dentro le caselle, una luce arancio sola per volta.
//   le spedizioni del mese, in cima a tutto, col piano e il ritmo (fascia)
//   oggi: create, partite, da chiudere, in giacenza (fascia)
//   i tuoi conti (tutti) | spedizioni per settimana (larga)
//   il lavoro in corso (le altre caselle di oggi, ognuna col suo periodo)
//   corrieri del mese (tutti, con la quota) | destinazioni (larga: Italia, Europa, Mondo)
//   la tua rete | gli stati degli ultimi 30 giorni | resi della rete
//   mese per mese
//   (gli SMS stanno in piccolo accanto al saluto)
//   crediti da recuperare (a scalare, a fattura)
//   il guadagno, con un periodo solo: totale | spedizioni (grafico); le voci in una fila
// Fuori resta solo la tabella «Statistiche spese spedizioni extra», che non ha mai mostrato dati (diceva sempre
// «Nessun dato disponibile»): rettifiche, resi e giacenze hanno le loro schede nel guadagno.
// I numeri vengono da /api/dashboard (passati dalla pagina), da /api/dashboard/plancia (oggi sul giorno di Roma,
// corrieri, settimane) e da /api/master/credito?dettaglio=1 (i conti).

type Dashboard = DatiDashboard & {
  ruolo?: string
  masterNome?: string
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


function saluto() {
  const ora = Number(new Intl.DateTimeFormat('it-IT', { hour: 'numeric', hour12: false, timeZone: 'Europe/Rome' }).format(new Date()))
  return ora >= 5 && ora < 13 ? 'Buongiorno' : ora < 18 && ora >= 13 ? 'Buon pomeriggio' : 'Buonasera'
}


// Una scala «tonda» per l'asse: 5 tacche, massimo da 1, 2, 2,5 o 5 per una potenza di dieci.
function scala(max: number) {
  if (max <= 0) return 5
  const p = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= max) return m * p
  return 10 * p
}
const breve = (v: number) => v >= 1000 ? `${(v / 1000).toLocaleString('it-IT', { maximumFractionDigits: 1 })}k` : String(v)


export default function DashboardFinexy({ data }: { data: Dashboard }) {
  const [plancia, setPlancia] = useState<Plancia | null>(null)
  const [erroreP, setErroreP] = useState<string | null>(null)
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
    return () => { vivo = false }
  }, [])

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

  // Le spedizioni del mese: lo stesso numero della casella nera della dashboard di oggi («Create a nov 4.645 / 100.000»),
  // tutta la rete, col limite del piano. Il ritmo è la media dei giorni passati (oggi compreso) e la stima di fine mese
  // è quella media per i giorni del mese: Wave il 25/11 era a 83.242 su 100.000, a questo ritmo 99.890.
  const spedMese = Number(data.spedizioniMese || 0)
  const limite = Number(data.limiteMese || 0)
  const conLimite = !data.illimitato && limite > 0
  const usoPiano = conLimite ? Math.min(100, spedMese / limite * 100) : 0
  const [annoR, meseR, giornoR] = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()).split('-').map(Number)
  const giorniDelMese = new Date(Date.UTC(annoR, meseR, 0)).getUTCDate()
  const alGiorno = giornoR > 0 ? spedMese / giornoR : 0
  const stima = Math.round(alGiorno * giorniDelMese)
  const oltre = conLimite && stima > limite

  return (
    <div className="fx">
      <div className="fx-titolo">
        <div>
          <h1>{saluto()}, {data.masterNome || 'master'}</h1>
          <p>Le spedizioni di oggi, cosa c&apos;è da chiudere e come va la tua rete.</p>
        </div>
        <SmsFinexy />
      </div>

      {/* LE SPEDIZIONI DEL MESE, in cima a tutto */}
      <section className="fx-mese">
        <div className="fx-mese-totale">
          <span>Spedizioni di {meseNome}</span>
          <b><Conta n={spedMese} formato={x => intero(Math.round(x))} /></b>
          <small>tutta la rete, dal primo del mese</small>
        </div>
        <div className="fx-mese-piano">
          <div className="fx-mese-riga"><span>Il tuo piano</span><b>{conLimite ? `${usoPiano.toLocaleString('it-IT', { maximumFractionDigits: usoPiano < 10 ? 1 : 0 })}% di ${intero(limite)}` : 'illimitato'}</b></div>
          <div className="fx-mese-barra"><i style={{ width: `${conLimite ? Math.max(usoPiano, 1) : 100}%` }} /></div>
          <div className="fx-mese-riga"><small>{conLimite ? (spedMese >= limite ? 'limite raggiunto' : `ne restano ${intero(limite - spedMese)}`) : 'nessun limite di spedizioni'}</small></div>
        </div>
        <div className="fx-mese-ritmo">
          <div><span>Al giorno</span><b>{intero(Math.round(alGiorno))}</b><small>media di {giornoR} {giornoR === 1 ? 'giorno' : 'giorni'}</small></div>
          <div><span>A fine mese</span><b>{intero(stima)}</b>{oltre ? <small className="fx-mese-oltre">oltre il piano di {intero(stima - limite)}</small> : <small>a questo ritmo</small>}</div>
        </div>
      </section>

      {/* OGGI: i quattro numeri della giornata, nella stessa fascia del mese (Lorenzo 25/11, sulla fascia del mese: «mi
          piace questo... rifacciamo sta dashboard in modo figo come questo»).
          CREATE e PARTITE sono due numeri diversi: create oggi (dal giorno di Roma, col confronto) e partite oggi, cioè
          create oggi e già uscite dalla lavorazione (spedite, in viaggio, consegnate), il numero che la dashboard di oggi
          chiamava «Partite oggi» (dashboard_contatori_master). Il 25/11 alle 13 Ecomize LL: 154 create, 14 partite. */}
      <section className="fx-mese fx-oggi" aria-label="Oggi">
        <a className="fx-oggi-voce" href="/dashboard/spedizioni">
          <span>Create oggi</span>
          <b>{oggi == null ? '…' : <Conta n={oggi} formato={x => intero(Math.round(x))} />}</b>
          <small title={variazione == null ? undefined : `${giornoSettimana} scorso fino alle ${plancia?.stessoGiornoSettimanaScorsa.finoAlle || 'stessa ora'}: ${intero(prima)} spedizioni`}>
            {variazione == null ? 'dal mattino, ora di Roma'
              : <><em className={variazione >= 0 ? 'fx-oggi-su' : 'fx-oggi-giu'}>{variazione >= 0 ? '↑' : '↓'} {Math.abs(variazione)}%</em> su {giornoSettimana} scorso alla stessa ora</>}
          </small>
        </a>
        <a className="fx-oggi-voce" href="/dashboard/spedizioni" title="Create oggi e già uscite dalla lavorazione: spedite, in viaggio, consegnate">
          <span>Partite oggi</span>
          <b><Conta n={Number(data.spediteOggi || 0)} formato={x => intero(Math.round(x))} /></b>
          <small>create oggi e già in viaggio</small>
        </a>
        <a className="fx-oggi-voce" href="/dashboard/distinte/crea">
          <span>Da chiudere</span>
          <b>{plancia ? <Conta n={plancia.daChiudereOggi} formato={x => intero(Math.round(x))} /> : '…'}</b>
          <small>create oggi, senza distinta</small>
        </a>
        <a className="fx-oggi-voce" href="/dashboard/spedizioni?stato=in_giacenza">
          <span>In giacenza</span>
          <b><Conta n={Number(data.inGiacenza || 0)} formato={x => intero(Math.round(x))} /></b>
          <small>{Number(data.inGiacenza || 0) > 0 ? <em className="fx-oggi-giu">da sbloccare</em> : 'nessuna'}</small>
        </a>
      </section>

      <div className="fx-griglia">
        {/* I CONTI: tutti, gli stessi della tendina in alto */}
        <ContiFinexy aScalare={aScalare} codDaRimettere={Number(data.codDaRimettere || 0)} />

        {/* SPEDIZIONI PER SETTIMANA */}
        <section className="fx-scheda fx-grafico-scheda fx-largo">
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
                    return <g key={i}><text className="fx-asse" x={0} y={yy + 3}>{breve(v)}</text>{i < 5 && <line x1={X0} x2={W} y1={yy} y2={yy} stroke="var(--fx-filo)" strokeWidth="0.6" />}</g>
                  })}
                  {sett.map((s, i) => {
                    const x = X0 + i * slot + (slot - larga - profondita(larga)) / 2, yc = y(s.consegnate), ya = y(s.create)
                    return (
                      <g key={s.dal}>
                        <title>{`Settimana dal ${s.dal}: ${intero(s.create)} create, ${intero(s.consegnate)} consegnate, ${intero(s.nonConsegnate)} non ancora`}</title>
                        {/* la colonna intera sale dalla base, una dopo l'altra */}
                        <g className="fx-barra3d" style={{ animationDelay: `${150 + i * 70}ms` }}>
                          <Barra3D id="fxs" x={x} y={yc} larga={larga} alta={Math.max(0, Y1 - yc)} tinta="nero" cima={s.nonConsegnate <= 0} />
                          {s.nonConsegnate > 0 && <Barra3D id="fxs" x={x} y={ya} larga={larga} alta={Math.max(yc - ya, 2)} tinta="righe" ombra={false} />}
                        </g>
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

        {/* I CORRIERI DEL MESE: la classifica, ognuno con la sua quota del mese (la barra) e quante oggi. Prima erano due
            carte coi primi due e «+ altri N»: Wave ne ha 7, QUICK 28, e gli altri non si vedevano */}
        <section className="fx-scheda fx-corrieri">
          <div className="fx-testa">
            <h2>I tuoi corrieri a {meseNome}</h2>
            {mese.length > 7 && <a className="fx-altri" href="/dashboard/statistiche/corrieri">tutti i {intero(mese.length)}</a>}
          </div>
          {!plancia ? <div className="fx-vuoto">{erroreP || 'Carico i corrieri…'}</div> : !mese.length ? <div className="fx-vuoto">Nessuna spedizione a {meseNome}</div> : (
            <div className="fx-corrieri-righe">
              {mese.slice(0, 7).map((c, i) => (
                <div key={c.corriere} className="fx-corriere-riga" title={`${c.corriere}: ${intero(c.n)} a ${meseNome}, ${intero(oggiDi(c.corriere))} oggi`}>
                  <div className="fx-corriere-testa"><b>{c.corriere}<small> · oggi {intero(oggiDi(c.corriere))}</small></b><span>{intero(c.n)}<small> · {quota(c.n)}%</small></span></div>
                  <div className="fx-corriere-barra"><i style={{ width: `${Math.max(quota(c.n), 1)}%`, animationDelay: `${300 + i * 80}ms` }} /></div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* DESTINAZIONI, larga: al posto delle ultime spedizioni (Lorenzo 25/11: «non serve a un cazzo», c'e' l'Elenco) */}
        <DestinazioniWidget fx />

        {/* LA RETE: tasso di consegna e i primi, gli stati degli ultimi 30 giorni, i resi */}
        <LaTuaRete data={data} />
        <StatiTrentaGiorni stati={data.statiUltimi30 || {}} />
        <ResiReteWidget fx />

        {/* MESE PER MESE, a tutta larghezza: il grafico e la tabella col volume */}
        <MesePerMese mesi={data.statsMensili || []} />

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
