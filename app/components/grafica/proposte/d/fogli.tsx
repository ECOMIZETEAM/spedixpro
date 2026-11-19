'use client'
// I FOGLI della Proposta D «Bento»: il dettaglio che si apre dalla tessera (la tessera cresce fino a diventare il
// foglio). Ogni foglio legge le sue rotte solo quando si apre, e solo in GET. I verbi portano alle pagine di lavoro:
// dalla Plancia non si scrive niente.
import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Euro, fmtN, MESI, euroPiano } from '../../PlanciaNuova'
import { Anello, Colonne, Italia, Mosaico, Ore, Quota, Strada, scalaItalia } from './grafici'
import { STATI, gruppiStati, meseItaliano, pct, useLettura, vettoreSicuro, PERIODI, URL_GIACENZE, urlContrattiOggi, type Lettura, type NomePeriodo, type Periodo } from './comune'
import { Cifra, Oggetto, VOCI, intero, righeFare, soldo, type Soldi } from './tessere'

// ── la testa di ogni foglio: l'oggetto, il titolo, la chiusura ──
export function Testa({ oggetto, tema, occhiello, titolo, sotto, chiudi, children }: { oggetto?: string; tema: string; occhiello: string; titolo: ReactNode; sotto?: ReactNode; chiudi: () => void; children?: ReactNode }) {
  return (
    <header className="bd-foglio__testa">
      {oggetto && <Oggetto n={oggetto} tema={tema} misura="m" />}
      <div className="bd-foglio__titoli">
        <small>{occhiello}</small>
        <h2 id="bd-foglio-titolo">{titolo}</h2>
        {sotto && <p>{sotto}</p>}
      </div>
      {children}
      <button type="button" className="bd-chiudi" onClick={chiudi} aria-label="Chiudi il dettaglio" title="Chiudi (Esc)">
        <svg className="gx-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 6.5l11 11M17.5 6.5l-11 11" /></svg>
      </button>
    </header>
  )
}
function Cifre({ voci }: { voci: { nome: string; v: ReactNode; nota?: ReactNode; punto?: string }[] }) {
  return (
    <div className="bd-cifre">
      {voci.map(x => (
        <div key={x.nome}>
          <span>{x.punto ? <i className={'bd-punto bd-punto--' + x.punto} /> : null}{x.nome}</span>
          <b>{x.v}</b>
          {x.nota && <em>{x.nota}</em>}
        </div>
      ))}
    </div>
  )
}
function Sezione({ titolo, link, children }: { titolo: string; link?: { href: string; testo: string }; children: ReactNode }) {
  return (
    <section className="bd-sez">
      <div className="bd-sez__testa"><h3>{titolo}</h3>{link && <a href={link.href}>{link.testo}<svg className="gx-ico" aria-hidden="true"><use href="#i-chevron" /></svg></a>}</div>
      {children}
    </section>
  )
}
const Vuoto = ({ children }: { children: ReactNode }) => <div className="bd-vuoto">{children}</div>
const hm = (s: string) => { const d = new Date(s); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` }
const gg = (s: string) => { const d = new Date(s); return `${d.getDate()} ${MESI[d.getMonth()].slice(0, 3)}` }
const citta = (s: string) => String(s || '').toLowerCase().replace(/(^|[\s'-])\S/g, c => c.toUpperCase())
function Stato({ k }: { k: string }) {
  const s = STATI[k] || { nome: k, tipo: '' }
  return <span className="bd-stato">{s.tipo === 'bene' || s.tipo === 'problema' ? <i className={'bd-punto bd-punto--' + s.tipo} /> : <i className="bd-punto" />}{s.nome}</span>
}

type Comuni = { data: any; badge: any; giornata: any; tema: string; chiudi: () => void }

// ── OGGI ──
export function FOggi({ data, giornata, tema, chiudi, adesso, giorno }: Comuni & { adesso: number | null; giorno: string }) {
  const ultime: any[] = data?.ultimeSpedizioni || []
  return (
    <>
      <Testa oggetto="furgone" tema={tema} occhiello="Oggi" titolo="La giornata" sotto={giorno} chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <Cifre voci={[
          { nome: 'Partite oggi', v: <Cifra v={Number(data?.spediteOggi || 0)}>{intero}</Cifra> },
          { nome: 'Create oggi', v: giornata ? <Cifra v={giornata.create}>{intero}</Cifra> : '…' },
          { nome: 'Ancora da chiudere', v: giornata ? <Cifra v={giornata.fuoriDistinta}>{intero}</Cifra> : '…', nota: 'create oggi, fuori distinta', punto: giornata?.fuoriDistinta ? 'accento' : '' },
          { nome: 'In lavorazione', v: <Cifra v={Number(data?.inLavorazione || 0)}>{intero}</Cifra> },
        ]} />
        <Sezione titolo="Ora per ora">
          {giornata?.ore ? <Ore ore={giornata.ore} adesso={adesso} alto={210} grande /> : <Vuoto>…</Vuoto>}
          <span className="bd-legenda-mini"><i className="bd-l-p" />già in distinta<i className="bd-l-r" />ancora da chiudere</span>
        </Sezione>
        <Sezione titolo="Le ultime spedizioni" link={{ href: '/dashboard/spedizioni', testo: 'Elenco spedizioni' }}>
          {ultime.length ? (
            <table className="bd-tab"><tbody>
              {ultime.slice(0, 10).map(s => (
                <tr key={s.id || s.tracking_number}>
                  <td className="bd-tab__ora">{hm(s.created_at)}</td>
                  <td className="bd-tab__chi">{s.dest_nome}</td>
                  <td>{citta(s.dest_citta)}</td>
                  <td className="bd-tab__cod"><a href={`/dashboard/spedizioni?numero=${encodeURIComponent(s.tracking_number || s.numero || '')}`}>{s.tracking_number || s.numero}</a></td>
                  <td><Stato k={s.stato} /></td>
                </tr>
              ))}
            </tbody></table>
          ) : <Vuoto>Ancora nessuna spedizione.</Vuoto>}
        </Sezione>
      </div>
    </>
  )
}

// ── DA FARE ──
function ListaGiacenze({ n }: { n: number }) {
  const giac = useLettura<any>(URL_GIACENZE, true)
  if (giac.stato === 'attesa') return <Vuoto>…</Vuoto>
  if (!giac.d?.rows?.length) return <Vuoto>{giac.stato === 'manca' ? 'Le giacenze non sono disponibili.' : 'Nessuna giacenza da risolvere.'}</Vuoto>
  return (
    <ul className="bd-giac">
      {giac.d.rows.map((s: any) => (
        <li key={s.id}>
          <i className="bd-punto bd-punto--problema" />
          <div><b>{s.dest_nome}</b><span>{citta(s.dest_citta)} · in giacenza dal {gg(s.giacenza_data || s.created_at)}{s.giacenza_motivo ? ' · ' + String(s.giacenza_motivo).toLowerCase() : ''}</span></div>
          <a className="bd-verbo" href="/dashboard/spedizioni/giacenze">Istruzioni</a>
        </li>
      ))}
      {n > giac.d.rows.length && <li className="bd-giac__altre"><a href="/dashboard/spedizioni/giacenze">Tutte le {intero(n)} giacenze</a></li>}
    </ul>
  )
}
export function FFare({ data, badge, tema, chiudi }: Comuni) {
  const righe = righeFare(data, badge)
  // i contratti di oggi: il conto si fa per vettore (mai il fornitore tecnico, mai il tipo del contratto)
  const [url] = useState(urlContrattiOggi)
  const contratti = useLettura<any[]>(url, true)
  const perVettore = useMemo(() => {
    const m = new Map<string, number>()
    for (const c of (Array.isArray(contratti.d) ? contratti.d : [])) { const n = Number(c?.da_chiudere || 0); if (n > 0) { const v = vettoreSicuro(c); m.set(v, (m.get(v) || 0) + n) } }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [contratti.d])
  const DESCR: Record<string, string> = {
    distinta: 'Le spedizioni di tutta la tua rete che non sono ancora in una distinta: finché non la chiudi, il corriere non sa di doverle ritirare.',
    giacenze: 'Il corriere ha fermato il pacco e aspetta le tue istruzioni: riconsegna, reso o nuovo indirizzo.',
    rettifiche: 'Pesi e misure rifatti dal corriere: confermali per addebitarli ai clienti.',
    rete: 'Master e clienti che chiedono di entrare nella tua rete.',
  }
  return (
    <>
      <Testa oggetto="pedana" tema={tema} occhiello="Da fare" titolo={righe.length ? `${righe.length} ${righe.length === 1 ? 'cosa aspetta' : 'cose aspettano'} te` : 'Tutto in ordine'} chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <ul className="bd-fare bd-fare--grande">
          {righe.map((r, i) => (
            <li key={r.k}>
              <b><Cifra v={r.n}>{intero}</Cifra></b>
              <span>{r.testo}{r.nota && <em>{r.nota}</em>}<small>{DESCR[r.k]}</small></span>
              <a className={'bd-verbo' + (i === 0 ? ' bd-verbo--pieno' : '')} href={r.href}>{r.verbo}</a>
            </li>
          ))}
        </ul>
        {!righe.length && <Vuoto><i className="bd-punto bd-punto--bene" /> Niente da chiudere in distinta, nessuna giacenza, nessuna rettifica, nessuna richiesta.</Vuoto>}
        <Sezione titolo="Create oggi e ancora senza distinta, per corriere" link={{ href: '/dashboard/distinte/crea', testo: 'Crea distinta' }}>
          {contratti.stato === 'attesa' ? <Vuoto>…</Vuoto> : contratti.stato === 'manca' ? <Vuoto>Il conto per corriere non è disponibile.</Vuoto> : perVettore.length ? (
            <ul className="bd-vettori">
              {perVettore.map(([v, n]) => <li key={v}><span>{v}</span><Quota v={n / Math.max(1, perVettore[0][1])} /><b>{intero(n)}</b></li>)}
            </ul>
          ) : <Vuoto>Oggi nessuna spedizione da chiudere.</Vuoto>}
        </Sezione>
        {Number(data?.inGiacenza || 0) > 0 && <Sezione titolo="Giacenze da risolvere" link={{ href: '/dashboard/spedizioni/giacenze', testo: 'Tutte le giacenze' }}><ListaGiacenze n={Number(data.inGiacenza)} /></Sezione>}
      </div>
    </>
  )
}

// ── IN TRANSITO ──
export function FTransito({ data, tema, chiudi }: Comuni) {
  const s = data?.statiUltimi30 || {}
  return (
    <>
      <Testa oggetto="strada" tema={tema} occhiello="In transito" titolo={<><Cifra v={Number(data?.inTransito || 0)}>{intero}</Cifra> pacchi in viaggio</>} sotto="adesso, in tutta la tua rete" chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <Sezione titolo="La strada degli ultimi 30 giorni" link={{ href: '/dashboard/spedizioni?stato=in_transito', testo: 'Spedizioni in transito' }}>
          <Cifre voci={[
            { nome: 'In lavorazione', v: intero(Number(s.in_lavorazione || 0)) },
            { nome: 'Spedite', v: intero(Number(s.spedita || 0)) },
            { nome: 'In transito', v: intero(Number(s.in_transito || 0)), punto: 'accento' },
            { nome: 'In consegna', v: intero(Number(s.in_consegna || 0)) },
          ]} />
          <div className="bd-strada-grande"><Strada s={s} /></div>
        </Sezione>
        <Cifre voci={[
          { nome: 'Consegnate questo mese', v: <Cifra v={Number(data?.consegnateMese || 0)}>{intero}</Cifra>, punto: 'bene' },
          { nome: 'Consegnate da sempre', v: intero(Number(data?.consegnateTotali || 0)), nota: `il ${pct(Number(data?.tassoConsegna || 0))}% di tutte le spedizioni` },
        ]} />
      </div>
    </>
  )
}

// ── GIACENZE ──
export function FGiacenze({ data, tema, chiudi }: Comuni) {
  const n = Number(data?.inGiacenza || 0)
  return (
    <>
      <Testa oggetto="gabbia" tema={tema} occhiello="In giacenza" titolo={n ? <><Cifra v={n}>{intero}</Cifra> {n === 1 ? 'giacenza da risolvere' : 'giacenze da risolvere'}</> : 'Nessuna giacenza'} sotto="Il corriere ha fermato il pacco: aspetta le tue istruzioni." chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <Sezione titolo="Le giacenze aperte" link={{ href: '/dashboard/spedizioni/giacenze', testo: 'Controllo giacenze' }}><ListaGiacenze n={n} /></Sezione>
      </div>
    </>
  )
}

// ── SALDI APERTI (anche dai contrassegni) ──
export function FSaldi({ data, tema, chiudi }: Comuni) {
  const sc = data?.creditiDaRecuperare?.scalare, fa = data?.creditiDaRecuperare?.fattura, cm = data?.creditoMaster
  return (
    <>
      <Testa oggetto="cassa" tema={tema} occhiello="Saldi aperti" titolo="I conti di adesso" sotto="Non cambiano col periodo: sono i saldi di questo momento." chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <Cifre voci={[
          { nome: 'Contrassegni da rimettere', v: <Cifra v={Number(data?.codDaRimettere || 0)}>{soldo}</Cifra>, nota: <a href="/dashboard/contrassegni">ai tuoi clienti · Contrassegni</a> },
          { nome: 'Da recuperare a scalare', v: <Euro v={Math.abs(Number(sc?.totale || 0))} />, nota: `${intero(Number(sc?.clienti || 0))} clienti bloccati finché non ricaricano`, punto: Math.abs(Number(sc?.totale || 0)) > 0.004 ? 'problema' : '' },
          { nome: 'Da recuperare a fattura', v: <Euro v={Math.abs(Number(fa?.totale || 0))} />, nota: `${intero(Number(fa?.clienti || 0))} clienti, spediscono normalmente` },
        ]} />
        <Cifre voci={[
          { nome: 'Conto proprio', v: <Euro v={Number(cm?.proprio || 0)} />, nota: <a href="/dashboard/movimenti">i tuoi contratti · Movimenti</a>, punto: Number(cm?.proprio) < 0 ? 'problema' : '' },
          ...(cm && cm.rete !== undefined ? [{ nome: cm.reteLabel ? `Credito ${cm.reteLabel}` : 'Credito di rete', v: <Euro v={Number(cm.rete || 0)} />, nota: 'il credito con cui spedisce la tua rete', punto: Number(cm.rete) < 0 ? 'problema' : '' }] : []),
        ]} />
      </div>
    </>
  )
}

// ── I MESI e IL PIANO ──
export function FMesi({ data, tema, chiudi }: Comuni) {
  const mesi: any[] = data?.statsMensili || []
  const n = Number(data?.spedizioniMese || 0), limite = Number(data?.limiteMese || 0), senza = !!data?.illimitato || !limite
  return (
    <>
      <Testa oggetto="piano" tema={tema} occhiello="I mesi" titolo="Il piano e i mesi" sotto="Le spedizioni create ogni mese da tutta la tua rete." chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <div className="bd-foglio__piano">
          <Anello quota={senza ? 0 : n / limite} lato={132} spessore={11}><b>{senza ? '∞' : `${pct(n / limite * 100)}%`}</b><span>del piano</span></Anello>
          <Cifre voci={[
            { nome: 'Questo mese', v: <Cifra v={n}>{intero}</Cifra>, nota: senza ? 'senza limite' : `su ${intero(limite)} del tuo piano` },
            ...(senza ? [] : [{ nome: 'Ne restano', v: intero(Math.max(0, limite - n)), nota: <a href="/dashboard/abbonamento">Abbonamento</a> }]),
          ]} />
        </div>
        <Sezione titolo="Spedizioni per mese">
          {mesi.length ? <Colonne valori={mesi.map((m, i) => ({ k: String(m.mese), v: Number(m.totale || 0), sopra: intero(Number(m.totale || 0)), sotto: meseItaliano(m.mese), accento: i === mesi.length - 1, titolo: meseItaliano(m.mese) }))} alto={230} assi={v => fmtN.format(v)} larghezzaMax={54} /> : <Vuoto>Ancora nessun mese.</Vuoto>}
        </Sezione>
        {mesi.length > 0 && (
          <table className="bd-tab bd-tab--numeri"><thead><tr><th>Mese</th><th>Spedizioni</th><th>Importo</th></tr></thead><tbody>
            {mesi.slice().reverse().map(m => <tr key={m.mese}><td>{meseItaliano(m.mese)} {String(m.mese).slice(-2) ? '20' + String(m.mese).slice(-2) : ''}</td><td>{intero(Number(m.totale || 0))}</td><td>{euroPiano(Number(m.importo || 0))}</td></tr>)}
          </tbody></table>
        )}
      </div>
    </>
  )
}

// ── I SOLDI: il periodo unico, il grafico giorno per giorno, le voci ──
export function FSoldi({ s, p, scegli, voce, tema, chiudi }: { s: Soldi; p: Periodo | null; scegli: (n: NomePeriodo) => void; voce?: string; tema: string; chiudi: () => void }) {
  const t = s.tot.d, sped = s.voci[0].d, serie: any[] = sped?.serie || []
  const margine = t?.ricavi ? t.guadagno / t.ricavi * 100 : 0
  const gestione = t && t.costiGestione !== undefined
  const et = (g: string) => g.length === 7 ? MESI[+g.slice(5, 7) - 1].slice(0, 3) : `${+g.slice(8, 10)}/${+g.slice(5, 7)}`
  return (
    <>
      <Testa oggetto="monete" tema={tema} occhiello="I soldi" titolo={<>Il guadagno di {p ? p.titolo : '…'}</>} chiudi={chiudi}>
        <Segmenti p={p} scegli={scegli} />
      </Testa>
      <div className="bd-foglio__corpo">
        <Cifre voci={[
          { nome: 'Guadagno totale', v: t ? <Cifra v={Number(t.guadagno || 0)}>{soldo}</Cifra> : s.tot.stato === 'manca' ? '—' : '…', punto: 'accento' },
          { nome: 'Incassato', v: t ? <Euro v={Number(t.ricavi || 0)} /> : '…' },
          { nome: 'Costi', v: t ? <Euro v={Number(t.costi || 0)} /> : '…' },
          { nome: 'Margine', v: t ? <>{pct(margine)}<small>%</small></> : '…' },
        ]} />
        <Sezione titolo="Il margine delle spedizioni, giorno per giorno" link={{ href: '/dashboard/statistiche/profitto', testo: 'Report guadagno' }}>
          {serie.length ? <Colonne valori={serie.map((g: any, i: number) => {
            const d = g.giorno.length === 10 ? new Date(g.giorno + 'T12:00:00') : null
            return { k: g.giorno, v: Number(g.margine || 0), sotto: et(g.giorno), accento: i === serie.length - 1, tenue: !!d && (d.getDay() === 0 || d.getDay() === 6), titolo: et(g.giorno) + ' · incassato ' + euroPiano(Number(g.ricavi || 0)), sopra: undefined }
          })} alto={220} assi={v => '€ ' + fmtN.format(v)} larghezzaMax={30} /> : <Vuoto>{s.voci[0].stato === 'attesa' ? '…' : 'Nessuna spedizione nel periodo.'}</Vuoto>}
        </Sezione>
        <Sezione titolo="Le voci">
          <table className="bd-tab bd-tab--soldi">
            <thead><tr><th>Voce</th><th>Incassato</th><th>Costo</th><th>Guadagno</th><th aria-label="Quota del guadagno" /></tr></thead>
            <tbody>
              {VOCI.map((v, i) => {
                const l = s.voci[i]
                return (
                  <tr key={v.k} className={voce === v.k ? 'bd-acceso' : undefined}>
                    <td><a href={v.href}><Oggetto n={v.segno} tema={tema} misura="s" />{v.nome}</a></td>
                    <td>{l.d ? euroPiano(Number(l.d.ricavi || 0)) : l.stato === 'manca' ? '—' : '…'}</td>
                    <td>{l.d ? euroPiano(Number(l.d.costi || 0)) : l.stato === 'manca' ? '—' : '…'}</td>
                    <td><b>{l.d ? euroPiano(Number(l.d.guadagno || 0)) : l.stato === 'manca' ? '—' : '…'}</b></td>
                    <td><Quota v={s.quota(v.k)} etichetta={`${Math.round(s.quota(v.k) * 100)}% del guadagno`} /></td>
                  </tr>
                )
              })}
              {s.altre > 0.005 && <tr><td><span className="bd-tab__senza">Altre voci</span></td><td colSpan={2} className="bd-nota">commissioni, accessori, rimborsi</td><td><b>{euroPiano(s.altre)}</b></td><td><Quota v={s.quota('altre')} /></td></tr>}
              {gestione && <>
                <tr className={'bd-tab__gestione' + (voce === 'utile' ? ' bd-acceso' : '')}><td><a href="/dashboard/costi-gestione"><Oggetto n="cassa" tema={tema} misura="s" />Costi di gestione</a></td><td /><td>{euroPiano(Number(t.costiGestione || 0))}</td><td /><td /></tr>
                <tr className={'bd-tab__utile' + (voce === 'utile' ? ' bd-acceso' : '')}><td>Utile netto</td><td /><td /><td><b>{euroPiano(Number(t.utileNetto || 0))}</b></td><td className="bd-riservato"><svg className="gx-ico" aria-hidden="true"><use href="#i-lucchetto" /></svg>solo tu e i tuoi admin</td></tr>
              </>}
            </tbody>
          </table>
          {gestione && s.gest.d?.perCategoria?.length > 0 && (
            <ul className="bd-vettori">{s.gest.d.perCategoria.slice(0, 5).map((c: any) => <li key={c.categoria}><span>{c.categoria}</span><Quota v={Number(c.importo || 0) / Math.max(1, Number(s.gest.d.totale || 0))} /><b>{euroPiano(Number(c.importo || 0))}</b></li>)}</ul>
          )}
        </Sezione>
      </div>
    </>
  )
}
// il periodo a segmenti: la pastiglia bianca scivola sul periodo scelto (come i controlli di iOS), non salta
export function Segmenti({ p, scegli }: { p: Periodo | null; scegli: (n: NomePeriodo) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ x: number; w: number } | null>(null)
  useLayoutEffect(() => {
    const misura = () => { const el = box.current?.querySelector<HTMLElement>('button[aria-pressed="true"]'); if (el) setPos({ x: el.offsetLeft, w: el.offsetWidth }) }
    misura()
    // il carattere arriva dopo (e cambia le larghezze): si rimisura quando il gruppo cambia misura
    const ro = new ResizeObserver(misura); if (box.current) ro.observe(box.current)
    return () => ro.disconnect()
  }, [p?.nome])
  return (
    <div className="bd-segmenti" role="group" aria-label="Periodo di tutte le tessere dei soldi" ref={box}>
      {pos && <i className="bd-segmenti__pastiglia" style={{ transform: `translateX(${pos.x}px)`, width: pos.w }} aria-hidden="true" />}
      {PERIODI.map(([n, t]) => <button key={n} type="button" aria-pressed={p?.nome === n} onClick={() => scegli(n)}>{t}</button>)}
    </div>
  )
}

// ── STATI ──
// i puntini dell'elenco hanno la stessa chiave del mosaico (in corso arancio, consegnate inchiostro, problemi rosso,
// annullate vuote): due codici di colore nello stesso foglio si contraddicevano
const GRUPPO: Record<string, string> = { in_lavorazione: 'corso', spedita: 'corso', in_transito: 'corso', in_consegna: 'corso', consegnata: 'bene', in_giacenza: 'problema', non_consegnato: 'problema', reso_mittente: 'problema', annullata: 'fermo', storno_richiesto: 'fermo', annullamento_pending: 'fermo' }
export function FStati({ data, tema, chiudi }: Comuni) {
  const s: Record<string, number> = data?.statiUltimi30 || {}
  const { g, tot } = gruppiStati(s)
  const elenco = Object.keys(STATI).map(k => ({ k, n: Number(s[k] || 0) })).filter(x => x.n > 0).sort((a, b) => b.n - a.n)
  return (
    <>
      <Testa oggetto="consegna" tema={tema} occhiello="Ultimi 30 giorni" titolo={<><Cifra v={tot}>{intero}</Cifra> spedizioni</>} sotto={`Il ${pct(tot ? g[1].n / tot * 100 : 0)}% è già consegnato · da sempre il ${pct(Number(data?.tassoConsegna || 0))}%`} chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <div className="bd-foglio__stati">
          <Mosaico gruppi={g} lato={250} />
          <ul className="bd-stati-elenco">
            {elenco.map(x => <li key={x.k}><span><i className={'bd-cella-l bd-cella-l--' + (GRUPPO[x.k] || 'fermo')} />{STATI[x.k].nome}</span><Quota v={x.n / Math.max(1, elenco[0].n)} /><b>{intero(x.n)}</b><em>{quotaTesto(x.n, tot)}</em></li>)}
          </ul>
        </div>
        <ul className="bd-legenda bd-legenda--riga">{g.map(x => <li key={x.k}><i className={'bd-cella-l bd-cella-l--' + x.k} />{x.nome}<b>{intero(x.n)}</b><em>{quotaTesto(x.n, tot)}</em></li>)}</ul>
      </div>
    </>
  )
}
// una quota piccola ma vera non diventa «0%»
const quotaTesto = (n: number, tot: number) => !tot ? '0%' : n > 0 && n / tot < 0.0005 ? '<0,1%' : pct(n / tot * 100) + '%'

// ── DESTINAZIONI ──
export function FDove({ dati, forme, tema, chiudi, nomeDi }: { dati: Lettura<any>; forme: any[] | null; tema: string; chiudi: () => void; nomeDi: (s: string) => string }) {
  const d = dati.d, province: any[] = d?.province || []
  const [acceso, accendi] = useState<string | null>(null)
  const max = Math.max(1, ...province.map(p => p.n))
  const estero: any[] = (d?.paesi || []).filter((p: any) => p.code !== 'IT')
  return (
    <>
      <Testa oggetto="dove" tema={tema} occhiello="Destinazioni" titolo={<>L&apos;Italia della tua rete</>} sotto={d ? `${intero(d.totale || 0)} spedizioni in ${intero(d.nProvince || 0)} province, ${intero(Math.max(0, (d.totalePaesi || 0) - (d.totale || 0)))} all'estero · ultimi 30 giorni` : '…'} chiudi={chiudi} />
      <div className="bd-foglio__corpo bd-foglio__dove">
        <div className="bd-foglio__mappa">
          <Italia forme={forme} province={province} tema={tema} W={420} H={480} acceso={acceso} accendi={accendi} />
          <div className="bd-scala"><span>poche</span><i style={{ background: scalaItalia(tema) }} /><span>molte</span></div>
          {acceso && (() => { const p = province.find(x => x.sigla === acceso); return <p className="bd-volante"><b>{nomeDi(acceso)}</b>{p ? `${intero(p.n)} spedizioni · ${pct(p.perc)}%` : 'nessuna spedizione'}</p> })()}
        </div>
        <div className="bd-foglio__elenco">
          <ol className="bd-province bd-province--tutte" onPointerLeave={() => accendi(null)}>
            {province.map((p, i) => (
              <li key={p.sigla} data-acceso={acceso === p.sigla ? '' : undefined} onPointerEnter={() => accendi(p.sigla)}>
                <span>{i + 1}</span>{nomeDi(p.sigla)}<small>{p.sigla}</small><Quota v={p.n / max} /><b>{intero(p.n)}</b><em>{pct(p.perc)}%</em>
              </li>
            ))}
          </ol>
          {estero.length > 0 && <p className="bd-nota bd-estero">All&apos;estero: {estero.map(p => `${p.code} ${intero(p.n)}`).join(' · ')}</p>}
        </div>
      </div>
    </>
  )
}

// ── RETE ──
export function FRete({ data, tema, chiudi }: Comuni) {
  const corriere = data?.topCorriere?.nome ? vettoreSicuro({ nome_contratto: data.topCorriere.nome }) : ''
  return (
    <>
      <Testa oggetto="rete" tema={tema} occhiello="La tua rete" titolo={<>Te e chi sta sotto di te</>} sotto="Da sempre." chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <Cifre voci={[
          { nome: 'Clienti', v: <Cifra v={Number(data?.clientiTotali || 0)}>{intero}</Cifra>, nota: <a href="/dashboard/clienti">Clienti</a> },
          { nome: 'Sotto-master', v: <Cifra v={Number(data?.sottomaster || 0)}>{intero}</Cifra>, nota: <a href="/dashboard/network">Dal mio network</a> },
          { nome: 'Spedizioni da sempre', v: <Cifra v={Number(data?.spedizioniTotali || 0)}>{intero}</Cifra> },
        ]} />
        <Cifre voci={[
          ...(corriere ? [{ nome: 'Il corriere più usato', v: corriere, nota: `${intero(Number(data.topCorriere.n || 0))} spedizioni` }] : []),
          ...(data?.topCliente?.nome ? [{ nome: 'Il cliente che spedisce di più', v: <span className="bd-cifre__testo">{String(data.topCliente.nome).trim()}</span>, nota: `${intero(Number(data.topCliente.n || 0))} spedizioni` }] : []),
        ]} />
      </div>
    </>
  )
}

// ── RESI ──
export function FResi({ analisi, tema, chiudi }: { analisi: Lettura<any>; tema: string; chiudi: () => void }) {
  const a = analisi.d, peggiori: any[] = a?.peggiori || []
  const max = Math.max(1, ...peggiori.map(c => Number(c.pct || 0)))
  return (
    <>
      <Testa oggetto="resi" tema={tema} occhiello="Resi a 90 giorni" titolo={a ? <><Cifra v={Number(a.totale?.pct || 0)}>{n => pct(n)}</Cifra>% di resi</> : '…'} sotto={a ? `${intero(a.totale?.resi || 0)} resi su ${intero(a.totale?.partite || 0)} spedizioni partite negli ultimi 90 giorni` : ''} chiudi={chiudi} />
      <div className="bd-foglio__corpo">
        <Sezione titolo="I clienti con più resi" link={{ href: '/dashboard/resi/analisi', testo: 'Analisi resi' }}>
          {peggiori.length ? (
            <ul className="bd-peggiori bd-peggiori--grande">
              {peggiori.map(c => (
                <li key={c.id}>
                  <span>{c.livello === 'rosso' ? <i className="bd-punto bd-punto--problema" /> : <i className="bd-punto" />}{String(c.nome || '').trim()}<small>{intero(c.resi)} resi su {intero(c.partite)} partite</small></span>
                  <Quota v={Number(c.pct || 0) / max} />
                  <b>{pct(c.pct)}%</b>
                </li>
              ))}
            </ul>
          ) : <Vuoto>{analisi.stato === 'attesa' ? '…' : 'Nessun cliente con resi da segnalare.'}</Vuoto>}
          <p className="bd-nota">Un cliente può avere più resi che partite: i resi contano il giorno in cui rientrano, anche di pacchi partiti prima dei 90 giorni.</p>
        </Sezione>
      </div>
    </>
  )
}
