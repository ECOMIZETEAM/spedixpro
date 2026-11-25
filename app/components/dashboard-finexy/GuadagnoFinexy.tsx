'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import DateRangePicker from '@/app/components/DateRangePicker'
import { prendiAnticipata } from '@/lib/richieste-anticipate'

// IL TUO GUADAGNO nella Dashboard nuova: un periodo per tutte le voci (Lorenzo 25/11: «il controllo delle date a
// blocco singolo va raggruppato»). Le schede della dashboard di oggi (ReportGuadagno, GuadagnoChart, CostiGestioneCard)
// restano com'erano, perche' la grafica di oggi le usa ancora; queste leggono le STESSE rotte con gli STESSI indirizzi,
// cosi' le cifre sono le stesse e le chiamate che la pagina anticipa all'apertura (mese in corso, app/dashboard/page.tsx)
// si riusano.

// Lo stesso mese in corso delle schede di oggi: dal primo del mese a oggi, nel giorno del browser.
function meseCorrente(): { dal: string; al: string } {
  const oggi = new Date()
  const str = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dal: str(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), al: str(oggi) }
}
// Le rotte del guadagno: le stesse di app/dashboard/page.tsx (REPORT_TOTALE, REPORT_VOCI).
const TOTALE = '/api/reports/guadagno-totale'
const VOCI = [
  { titolo: 'Rettifiche', endpoint: '/api/reports/guadagno-rettifiche' },
  { titolo: 'Resi', endpoint: '/api/reports/guadagno-resi' },
  { titolo: 'Giacenze', endpoint: '/api/reports/guadagno-giacenze' },
  { titolo: 'Logistica', endpoint: '/api/reports/guadagno-logistica' },
  { titolo: 'Consumabili', endpoint: '/api/reports/guadagno-consumabili' },
]

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)
const intero = (x: number) => Number(x || 0).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)

// Una lettura per periodo, che riusa quella anticipata se l'indirizzo e' identico.
function useLettura(url: string | null) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!url) return
    let vivo = true
    setLoading(true)
    const risposta = prendiAnticipata(url) ?? fetch(url)
    risposta.then(r => r.json()).then(x => { if (vivo) { setD(x); setLoading(false) } }).catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [url])
  return { d, loading }
}

// GUADAGNO TOTALE: una fascia nera come quella delle spedizioni del mese (Lorenzo 25/11, sul guadagno: «sono veramente
// brutti»; della fascia del mese: «mi piace questo»). Il totale, quanto resta di ogni euro incassato con la barra, e a
// destra l'utile netto coi costi di gestione (solo al titolare: la rotta li manda soltanto a lui) o, per gli altri,
// incassato e costo. Cosa il totale comprende sta nella nota al passaggio del mouse, non in un paragrafo.
const SPIEGA_TOTALE = 'Spedizioni, rettifiche, rimborsi, resi, giacenze, commissioni, accessori, logistica e canone, senza contare due volte niente e senza i soldi che passano soltanto (ricariche, contrassegni).'
function Totale({ dal, al }: { dal: string, al: string }) {
  const { d, loading } = useLettura(`${TOTALE}?dal=${dal}&al=${al}`)
  const guadagno = Number(d?.guadagno || 0), incassato = Number(d?.ricavi || 0), costo = Number(d?.costi || 0)
  const quota = incassato > 0 ? guadagno / incassato * 100 : null
  const pct = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  const conNetto = !loading && d?.costiGestione !== undefined
  return (
    <section className="fx-mese fx-guadagno" aria-label="Guadagno totale">
      <div className="fx-mese-totale" title={SPIEGA_TOTALE}>
        <span>Guadagno totale</span>
        <b className={!loading && guadagno < 0 ? 'fx-guadagno-meno' : undefined}>{loading ? '…' : eur(guadagno)}</b>
        <small>tutte le voci del periodo</small>
      </div>
      <div className="fx-mese-piano">
        <div className="fx-mese-riga"><span>Ti resta di ogni euro incassato</span><b className={quota != null && quota < 0 ? 'fx-guadagno-meno' : 'fx-guadagno-piu'}>{loading || quota == null ? '…' : pct(quota)}</b></div>
        <div className={`fx-mese-barra fx-guadagno-barra${quota != null && quota < 0 ? ' fx-guadagno-barra--meno' : ''}`}>
          <i style={{ width: `${quota == null ? 0 : Math.max(1, Math.min(100, Math.abs(quota)))}%` }} />
        </div>
        <div className="fx-mese-riga"><small>incassato {loading ? '…' : eur(incassato)} · costo {loading ? '…' : eur(costo)}</small></div>
      </div>
      <div className="fx-mese-ritmo">
        {conNetto ? <>
          <div><span>Utile netto</span><b className={Number(d.utileNetto) < 0 ? 'fx-guadagno-meno' : undefined}>{eur(d.utileNetto)}</b><small>meno i costi di gestione</small></div>
          <div><span>Costi di gestione</span><b>{eur(d.costiGestione)}</b><small><a href="/dashboard/costi-gestione">aggiorna →</a></small></div>
        </> : <>
          <div><span>Incassato</span><b>{loading ? '…' : eur(incassato)}</b><small>nel periodo</small></div>
          <div><span>Costo</span><b>{loading ? '…' : eur(costo)}</b><small>nel periodo</small></div>
        </>}
      </div>
    </section>
  )
}

// UNA VOCE della fila: guadagno, incassato e costo.
function Voce({ titolo, endpoint, dal, al }: { titolo: string, endpoint: string, dal: string, al: string }) {
  const { d, loading } = useLettura(`${endpoint}?dal=${dal}&al=${al}`)
  const g = Number(d?.guadagno || 0)
  return (
    <div className="fx-cella fx-voce">
      <div className="fx-cella-nome">{titolo}</div>
      <div className={`fx-cella-cifra${!loading && g < 0 ? ' fx-grande--male' : ''}${eur(g).length > 12 ? ' fx-cella-cifra--lunga' : ''}`}>{loading ? '…' : eur(g)}</div>
      <div className="fx-voce-sotto"><span>incassato <b>{loading ? '…' : eur(d?.ricavi || 0)}</b></span><span>costo <b>{loading ? '…' : eur(d?.costi || 0)}</b></span></div>
    </div>
  )
}

// I COSTI DI GESTIONE: solo il titolare e i suoi admin (la rotta risponde 403 agli altri, e la casella non c'e').
function CostiGestione({ dal, al }: { dal: string, al: string }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [negato, setNegato] = useState(false)
  useEffect(() => {
    let vivo = true
    setLoading(true)
    fetch(`/api/costi-gestione?dal=${dal}&al=${al}`)
      .then(r => { if (r.status === 403 || r.status === 401) { if (vivo) setNegato(true); return null } return r.json() })
      .then(x => { if (vivo) { if (x && !x.error) setD(x); setLoading(false) } })
      .catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [dal, al])
  if (negato) return null
  const categorie: any[] = d?.perCategoria || []
  const prima = categorie[0]
  return (
    <a className="fx-cella fx-voce" href="/dashboard/costi-gestione" title={categorie.map(c => `${c.categoria}: ${eur(c.importo)}`).join('\n') || undefined}>
      <div className="fx-cella-nome">Costi di gestione</div>
      <div className={`fx-cella-cifra${!loading && Number(d?.totale || 0) > 0 ? ' fx-grande--male' : ''}`}>{loading ? '…' : eur(d?.totale || 0)}</div>
      <div className="fx-voce-sotto">
        {loading ? <span>…</span> : categorie.length
          ? <span>{prima.categoria} <b>{eur(prima.importo)}</b>{categorie.length > 1 ? ` e altre ${categorie.length - 1}` : ''}</span>
          : <span className="fx-link">Aggiungi i costi →</span>}
      </div>
    </a>
  )
}

function giorno(g: string) {
  if (!g) return ''
  if (g.length === 7) return ['Gen', 'Feb', 'Mar', 'Apr', 'Mag', 'Giu', 'Lug', 'Ago', 'Set', 'Ott', 'Nov', 'Dic'][Number(g.split('-')[1]) - 1] || g
  const [, m, dd] = g.split('-')
  return `${dd}/${m}`
}

// GUADAGNO SPEDIZIONI: il margine e il grafico di fatturato e costi (rettifiche escluse, hanno la loro voce).
function Grafico({ dal, al }: { dal: string, al: string }) {
  const { d, loading } = useLettura(`/api/reports/guadagno?dal=${dal}&al=${al}`)
  const margine = Number(d?.guadagno || 0)
  const serie = (d?.serie || []).map((s: any) => ({ ...s, label: giorno(s.giorno) }))
  return (
    <section className="fx-scheda fx-tutta">
      <div className="fx-testa">
        <div><h2>Guadagno spedizioni</h2><p className="fx-sotto">Rettifiche escluse: sono nella loro voce, qui sotto</p></div>
      </div>
      <div className="fx-guadagno-numeri">
        <div>
          <div className="fx-cella-nome">Margine</div>
          <div className={`fx-report-cifra${!loading && margine < 0 ? ' fx-grande--male' : ''}`} style={{ marginTop: 6 }}>{loading ? '…' : eur(margine)}</div>
        </div>
        <div><div className="fx-cella-nome"><i className="fx-pallino" style={{ background: 'var(--fx-nero)' }} />Fatturato</div><b>{loading ? '…' : eur(d?.ricavi || 0)}</b></div>
        <div><div className="fx-cella-nome"><i className="fx-pallino" style={{ background: 'var(--fx-arancio)' }} />Costi</div><b>{loading ? '…' : eur(d?.costi || 0)}</b></div>
        <div>
          <div className="fx-cella-nome">Media per spedizione</div>
          <b style={{ color: Number(d?.mediaSped) < 0 ? 'var(--fx-male)' : undefined }}>{loading ? '…' : eur(d?.mediaSped || 0)}</b>
          <small>{loading ? '' : `${intero(Number(d?.numSpedizioni || 0))} spedizioni`}</small>
        </div>
      </div>
      {/* Il costo per fornitore arriva solo a E&A MULTIEXPRESS (la rotta lo decide): l'unica eccezione permessa. */}
      {Array.isArray(d?.costiProvider) && d.costiProvider.length > 0 && (
        <div className="fx-guadagno-fornitori">
          {d.costiProvider.map((p: any) => (
            <div key={p.provider} className="fx-cella">
              <div className="fx-cella-nome">Costo {p.provider}</div>
              <div className="fx-cella-cifra" style={{ fontSize: 17, color: 'var(--fx-male)' }}>{eur(p.costo)}</div>
              <div className="fx-cella-quando" style={{ fontSize: 11, color: 'var(--fx-grigio)' }}>{intero(Number(p.n || 0))} spedizioni</div>
            </div>
          ))}
        </div>
      )}
      <div className="fx-pannello" style={{ height: 230 }}>
        {loading ? <div className="fx-vuoto">Carico il guadagno…</div> : !serie.length ? <div className="fx-vuoto">Nessun dato nel periodo</div> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--fx-filo)" strokeWidth={0.6} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E8E93' }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={{ fontSize: 10, fill: '#8E8E93' }} tickLine={false} axisLine={false} width={76} tickFormatter={(v: number) => '€ ' + intero(Number(v))} />
              <Tooltip formatter={(v: any, name: any) => [eur(Number(v)), name === 'ricavi' ? 'Fatturato' : name === 'costi' ? 'Costi' : 'Margine']} labelStyle={{ color: '#111', fontWeight: 600 }} contentStyle={{ borderRadius: '10px', border: '1px solid #ECECEC', fontSize: '12px', boxShadow: '0 6px 22px rgba(0,0,0,.06)' }} />
              <Line type="monotone" dataKey="ricavi" name="ricavi" stroke="var(--fx-nero)" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="costi" name="costi" stroke="var(--fx-arancio)" strokeWidth={2.2} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </section>
  )
}

export function IlTuoGuadagno({ ruolo }: { ruolo?: string }) {
  const [periodo, setPeriodo] = useState(meseCorrente)
  const titolare = ['master', 'admin'].includes(String(ruolo || '').toLowerCase())
  return <>
    <div className="fx-sezione fx-tutta">
      <div><h2>Il tuo guadagno</h2><p>Un periodo per tutte le voci</p></div>
      <DateRangePicker dal={periodo.dal} al={periodo.al} onChange={(dal, al) => setPeriodo({ dal, al })} />
    </div>
    <Totale dal={periodo.dal} al={periodo.al} />
    <Grafico dal={periodo.dal} al={periodo.al} />
    <section className="fx-scheda fx-striscia fx-tutta" aria-label="Il guadagno per voce">
      <div className="fx-striscia-righe fx-voci">
        {VOCI.map(r => <Voce key={r.endpoint} titolo={r.titolo} endpoint={r.endpoint} dal={periodo.dal} al={periodo.al} />)}
        {/* Stipendi, affitto, mezzi...: solo il titolare e i suoi admin (lib/costi-gestione). */}
        {titolare && <CostiGestione dal={periodo.dal} al={periodo.al} />}
      </div>
    </section>
  </>
}
