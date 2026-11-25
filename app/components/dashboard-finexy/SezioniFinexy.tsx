'use client'
import { useEffect, useRef, useState } from 'react'
import { euro, intero, meseItaliano, percento, statoDi } from './formati'
import { Barra3D, DefsBarre, profondita } from './Barre3D'
import Conta from './Conta'

// LE PARTI DELLA DASHBOARD NUOVA CHE LA DASHBOARD DI OGGI GIA' AVEVA. Lorenzo, 25/11: «nella vecchia versione nella home
// ci stavano tanti blocchi, ora non se li ritrovano piu'... applica il design, ma la sistemazione falla in base a tutti
// i dati che avevano». Ogni numero qui e' lo stesso di oggi, letto dallo stesso campo di /api/dashboard: cambia solo
// come si legge. Ogni casella dice di quando parla (ora, ultimi 30 giorni, il mese, da sempre): la dashboard di oggi
// lo spiegava in una nota a parte, perche' mescolava periodi diversi senza dirlo.

type Cliente = { id: string; nome: string; saldo: number }
type Gruppo = { clienti: number; totale: number; lista: Cliente[] }
export type DatiDashboard = {
  spediteOggi?: number; daSpedire?: number; inLavorazione?: number; daMettereInDistinta?: number
  inTransito?: number; inGiacenza?: number; consegnateMese?: number; fatturatoMese?: number
  totClienti?: number; clientiTotali?: number; sottomaster?: number; spedizioniTotali?: number; consegnateTotali?: number; tassoConsegna?: number
  topCorriere?: { nome?: string; n?: number } | null; topCliente?: { nome?: string; n?: number } | null
  statsMensili?: { mese: string; totale: number; importo: number }[]; statiUltimi30?: Record<string, number>
  creditiDaRecuperare?: { scalare?: Gruppo; fattura?: Gruppo }
}

const mesePerNome = () => new Intl.DateTimeFormat('it-IT', { month: 'long', timeZone: 'Europe/Rome' }).format(new Date())

// IL LAVORO IN CORSO: i contatori della dashboard di oggi che non stanno nei quattro numeri in alto.
export function LavoroInCorso({ data }: { data: DatiDashboard }) {
  const mese = mesePerNome()
  const senzaDistinta = Number(data.daMettereInDistinta || 0)
  const tutto = (x: number) => intero(Math.round(x))
  const celle: { nome: string; n: number; formato: (x: number) => string; quando: string; href?: string; arancio?: boolean; spiega?: string }[] = [
    { nome: 'In transito', n: Number(data.inTransito || 0), formato: tutto, quando: 'ora', href: '/dashboard/spedizioni?stato=in_transito' },
    { nome: 'Da spedire', n: Number(data.daSpedire || 0), formato: tutto, quando: 'ultimi 30 giorni', href: '/dashboard/spedizioni?stato=in_lavorazione',
      spiega: 'Create negli ultimi 30 giorni e ancora in lavorazione' },
    { nome: 'In lavorazione', n: Number(data.inLavorazione || 0), formato: tutto, quando: 'ultimi 30 giorni', href: '/dashboard/spedizioni',
      spiega: 'In lavorazione o spedite, create negli ultimi 30 giorni' },
    { nome: 'Senza distinta', n: senzaDistinta, formato: tutto, quando: 'da sempre', href: '/dashboard/distinte/crea', arancio: senzaDistinta > 0,
      spiega: 'Tutte le spedizioni della rete senza distinta, annullate escluse' },
    { nome: 'Consegnate', n: Number(data.consegnateMese || 0), formato: tutto, quando: mese, spiega: `Create a ${mese} e già consegnate` },
    { nome: 'Volume', n: Number(data.fatturatoMese || 0), formato: euro, quando: mese, spiega: `Il valore delle spedizioni create a ${mese}` },
    { nome: 'Clienti diretti', n: Number(data.totClienti || 0), formato: tutto, quando: 'tuoi', href: '/dashboard/clienti' },
  ]
  return (
    <section className="fx-scheda fx-striscia fx-tutta" aria-label="Il lavoro in corso">
      <div className="fx-striscia-righe">
        {celle.map(c => {
          const dentro = <>
            <div className="fx-cella-nome">{c.nome}</div>
            <div className={`fx-cella-cifra${c.formato(c.n).length > 11 ? ' fx-cella-cifra--lunga' : ''}`}><Conta n={c.n} formato={c.formato} /></div>
            <div className="fx-cella-quando"><span className="fx-chip fx-chip--neutro">{c.quando}</span></div>
          </>
          const cls = `fx-cella${c.arancio ? ' fx-cella--arancio' : ''}`
          return c.href
            ? <a key={c.nome} className={cls} href={c.href} title={c.spiega}>{dentro}</a>
            : <div key={c.nome} className={cls} title={c.spiega}>{dentro}</div>
        })}
      </div>
    </section>
  )
}

// LA TUA RETE: il tasso di consegna e i primi, da sempre.
export function LaTuaRete({ data }: { data: DatiDashboard }) {
  const tasso = Number(data.tassoConsegna || 0)
  return (
    <section className="fx-scheda">
      <div className="fx-testa"><h2>La tua rete</h2><span className="fx-chip fx-chip--neutro">da sempre</span></div>
      <div className="fx-grande fx-grande--bene">{percento(tasso)}</div>
      <p className="fx-sotto">consegnate: {intero(Number(data.consegnateTotali || 0))} su {intero(Number(data.spedizioniTotali || 0))} spedizioni della rete</p>
      <div className="fx-coppia">
        <div>
          <div className="fx-cella-nome">Primo cliente</div>
          <strong title={data.topCliente?.nome || ''}>{data.topCliente?.nome || '—'}</strong>
          <small>{data.topCliente?.n ? `${intero(Number(data.topCliente.n))} spedizioni` : 'nessun dato'}</small>
        </div>
        <div>
          <div className="fx-cella-nome">Primo corriere</div>
          <strong title={data.topCorriere?.nome || ''}>{data.topCorriere?.nome || '—'}</strong>
          <small>{data.topCorriere?.n ? `${intero(Number(data.topCorriere.n))} spedizioni` : 'nessun dato'}</small>
        </div>
        <a href="/dashboard/clienti">
          <div className="fx-cella-nome">Clienti della rete</div>
          <strong>{intero(Number(data.clientiTotali ?? data.totClienti ?? 0))}</strong>
          <small>{intero(Number(data.totClienti || 0))} diretti</small>
        </a>
        <div>
          <div className="fx-cella-nome">Sotto-master</div>
          <strong>{intero(Number(data.sottomaster || 0))}</strong>
          <small>nella tua rete</small>
        </div>
      </div>
    </section>
  )
}

// GLI STATI DEGLI ULTIMI 30 GIORNI: la ciambella della dashboard di oggi, con i numeri accanto.
export function StatiTrentaGiorni({ stati }: { stati: Record<string, number> }) {
  const voci = Object.entries(stati || {}).map(([s, n]) => ({ s, n: Number(n) || 0 })).filter(v => v.n > 0).sort((a, b) => b.n - a.n)
  const totale = voci.reduce((t, v) => t + v.n, 0)
  const R = 46, C = 2 * Math.PI * R
  let fatto = 0
  const visibili = voci.slice(0, 6), altri = voci.slice(6).reduce((t, v) => t + v.n, 0)
  return (
    <section className="fx-scheda">
      <div className="fx-testa"><h2>Gli stati</h2><span className="fx-chip fx-chip--neutro">ultimi 30 giorni</span></div>
      {!totale ? <div className="fx-vuoto">Nessuna spedizione negli ultimi 30 giorni</div> : (
        <div className="fx-ciambella">
          <svg className="fx-ciambella-svg" viewBox="0 0 120 120" role="img" aria-label={`Stati delle ${intero(totale)} spedizioni degli ultimi 30 giorni`}>
            <circle cx="60" cy="60" r={R} fill="none" stroke="var(--fx-riquadro)" strokeWidth="15" />
            {voci.map(v => {
              const lungo = v.n / totale * C, inizio = fatto
              fatto += lungo
              return <circle key={v.s} cx="60" cy="60" r={R} fill="none" stroke={statoDi(v.s)[1]} strokeWidth="15"
                strokeDasharray={`${Math.max(0, lungo - 0.8)} ${C}`} strokeDashoffset={-inizio} transform="rotate(-90 60 60)">
                <title>{`${statoDi(v.s)[0]}: ${intero(v.n)}`}</title></circle>
            })}
            <text x="60" y="58" textAnchor="middle" style={{ fontSize: 17, fontWeight: 600, fill: 'var(--fx-testo)' }}>{intero(totale)}</text>
            <text x="60" y="73" textAnchor="middle" style={{ fontSize: 8.5, fill: 'var(--fx-grigio)' }}>spedizioni</text>
          </svg>
          <div className="fx-righe">
            {visibili.map(v => (
              <a key={v.s} className="fx-riga" href={`/dashboard/spedizioni?stato=${v.s}`}>
                <span><i className="fx-pallino" style={{ background: statoDi(v.s)[1] }} />{statoDi(v.s)[0]}</span>
                <b>{intero(v.n)} <span style={{ color: 'var(--fx-grigio)', fontWeight: 400 }}>· {Math.round(v.n / totale * 100)}%</span></b>
              </a>
            ))}
            {altri > 0 && <div className="fx-riga"><span><i className="fx-pallino" style={{ background: '#D4D4D8' }} />Altri stati</span><b>{intero(altri)}</b></div>}
          </div>
        </div>
      )}
    </section>
  )
}

// MESE PER MESE: il grafico e la tabella «Statistiche spedizioni» della dashboard di oggi, in una scheda.
export function MesePerMese({ mesi }: { mesi: { mese: string; totale: number; importo: number }[] }) {
  const righe = (mesi || []).slice(-6)
  const max = Math.max(1, ...righe.map(m => Number(m.totale) || 0))
  // Disegnato sulla larghezza vera, come le settimane: con una larghezza fissa le scritte crescevano con la scheda.
  // E in altezza riempie la riga (la decide la scheda accanto): niente vuoto sotto il grafico.
  const area = useRef<HTMLDivElement>(null)
  const [misura, setMisura] = useState({ w: 420, h: 270 })
  useEffect(() => {
    const el = area.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const o = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height)
      if (w > 0) setMisura(m => (m.w === w && m.h === Math.max(220, h) ? m : { w, h: Math.max(220, h) }))
    })
    o.observe(el)
    return () => o.disconnect()
  }, [])
  const W = misura.w, H = misura.h, Y1 = H - 26, slot = W / Math.max(1, righe.length), larga = Math.min(slot * 0.42, 54), d = profondita(larga)
  return (
    <section className="fx-scheda fx-tutta fx-pieno">
      <div className="fx-testa">
        <div><h2>Mese per mese</h2><p className="fx-sotto">Spedizioni della rete create in ogni mese, e il loro volume</p></div>
        <a className="fx-link" href="/dashboard/statistiche/corrieri">Statistiche →</a>
      </div>
      {!righe.length ? <div className="fx-vuoto">Nessun dato</div> : (
        <div className="fx-mesi fx-riempi">
          <div className="fx-pannello fx-mesi-grafico">
            <div ref={area} className="fx-mesi-area">
            <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Spedizioni per mese">
              <DefsBarre id="fxm" />
              <line x1="0" x2={W} y1={Y1 + 0.5} y2={Y1 + 0.5} stroke="var(--fx-filo)" />
              {righe.map((m, i) => {
                const h = (Number(m.totale) || 0) / max * (Y1 - 40), x = i * slot + (slot - larga - d) / 2
                const ultimo = i === righe.length - 1
                return (
                  <g key={m.mese}>
                    <title>{`${meseItaliano(m.mese)}: ${intero(m.totale)} spedizioni, ${euro(m.importo)}`}</title>
                    <g className="fx-barra3d" style={{ animationDelay: `${120 + i * 90}ms` }}>
                      <Barra3D id="fxm" x={x} y={Y1 - Math.max(h, 2)} larga={larga} alta={Math.max(h, 2)} tinta={ultimo ? 'arancio' : 'nero'} />
                    </g>
                    <text className="fx-appare" style={{ fontSize: 11, fill: 'var(--fx-testo)', fontWeight: 600, animationDelay: `${700 + i * 90}ms` }} x={x + (larga + d) / 2} y={Y1 - h - d * 0.62 - 7} textAnchor="middle">{intero(m.totale)}</text>
                    <text x={x + (larga + d) / 2} y={H - 7} textAnchor="middle" className="fx-asse" style={{ fontSize: 11 }}>{meseItaliano(m.mese)}</text>
                  </g>
                )
              })}
            </svg>
            </div>
          </div>
          <table className="fx-tabella fx-tabella--piccola">
            <thead><tr><th>Mese</th><th className="fx-destra">Spedizioni</th><th className="fx-destra">Volume</th></tr></thead>
            <tbody>
              {[...righe].reverse().map(m => (
                <tr key={m.mese} style={{ cursor: 'default' }}>
                  <td>{meseItaliano(m.mese)}</td>
                  <td className="fx-destra">{intero(m.totale)}</td>
                  <td className="fx-destra">{euro(m.importo)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="fx-totale">
                <td>{righe.length} mesi</td>
                <td className="fx-destra">{intero(righe.reduce((t, m) => t + (Number(m.totale) || 0), 0))}</td>
                <td className="fx-destra">{euro(righe.reduce((t, m) => t + (Number(m.importo) || 0), 0))}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </section>
  )
}

// CREDITI DA RECUPERARE: le due modalita' NON vanno confuse (dashboard di oggi). A scalare = clienti bloccati che
// devono ricaricare; a fattura = l'esposizione normale da fatturare, che non e' un allarme (REGOLE.md: niente rosso).
export function CreditiDaRecuperare({ crediti }: { crediti?: DatiDashboard['creditiDaRecuperare'] }) {
  return <>
    {(['scalare', 'fattura'] as const).map(k => {
      const g = crediti?.[k]
      if (!g || !g.clienti) return null
      const scal = k === 'scalare'
      return (
        <section key={k} className="fx-scheda">
          <div className="fx-testa">
            <h2>{scal ? 'A scalare, bloccati' : 'A fattura, da fatturare'}</h2>
            <span className={`fx-chip ${scal ? 'fx-chip--male' : 'fx-chip--neutro'}`}>{euro(Math.abs(Number(g.totale || 0)))}</span>
          </div>
          <p className="fx-sotto">{scal
            ? `${g.clienti} client${g.clienti === 1 ? 'e non può' : 'i non possono'} spedire finché non ricaric${g.clienti === 1 ? 'a' : 'ano'}`
            : `${g.clienti} client${g.clienti === 1 ? 'e' : 'i'} con esposizione regolare: spedisc${g.clienti === 1 ? 'e' : 'ono'} normalmente`}</p>
          <div className="fx-righe">
            {g.lista.slice(0, 5).map(c => (
              <a key={c.id} className={`fx-riga${scal ? ' fx-riga--male' : ''}`} href={`/dashboard/clienti/${c.id}`}>
                <span title={c.nome}>{c.nome}</span><b>{euro(Number(c.saldo))}</b>
              </a>
            ))}
            {g.clienti > Math.min(5, g.lista.length) && <div className="fx-piu">e altri {g.clienti - Math.min(5, g.lista.length)}…</div>}
          </div>
        </section>
      )
    })}
  </>
}
