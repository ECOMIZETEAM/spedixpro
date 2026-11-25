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

// GUADAGNO TOTALE: la scheda nera, la cifra che riassume le voci.
function Totale({ dal, al }: { dal: string, al: string }) {
  const { d, loading } = useLettura(`${TOTALE}?dal=${dal}&al=${al}`)
  return (
    <section className="fx-scheda fx-report fx-report--nera">
      <div className="fx-testa"><h2>Guadagno totale</h2><span className="fx-chip fx-chip--vetro">tutte le voci</span></div>
      <div className="fx-report-cifra">{loading ? '…' : eur(Number(d?.guadagno || 0))}</div>
      <div className="fx-report-sotto">
        <span>Incassato <b>{loading ? '…' : eur(d?.ricavi || 0)}</b></span>
        <span>Costo <b>{loading ? '…' : eur(d?.costi || 0)}</b></span>
      </div>
      <Margine guadagno={Number(d?.guadagno || 0)} incassato={Number(d?.ricavi || 0)} pronto={!loading} />
      {/* Solo per il titolare: la rotta manda costiGestione soltanto a lui. */}
      {!loading && d?.costiGestione !== undefined && (
        <div className="fx-report-netto">
          <span>Costi di gestione <b style={{ color: '#FF8A80' }}>{eur(d.costiGestione)}</b></span>
          <span>Utile netto <b style={{ fontSize: 14, color: Number(d.utileNetto) < 0 ? '#FF8A80' : '#7EE2A0' }}>{eur(d.utileNetto)}</b></span>
        </div>
      )}
      <p className="fx-report-spiega">Spedizioni, rettifiche, rimborsi, resi, giacenze, commissioni, accessori, logistica e canone, senza contare
        due volte niente e senza i soldi che passano soltanto (ricariche, contrassegni). Accanto e sotto, il dettaglio per voce.</p>
    </section>
  )
}

// QUANTO RESTA di ogni euro incassato: il guadagno diviso l'incassato, con la barra divisa fra costo e guadagno. Sono
// le due cifre scritte sopra, nient'altro; senza incassato non c'e' una quota da mostrare.
function Margine({ guadagno, incassato, pronto }: { guadagno: number, incassato: number, pronto: boolean }) {
  if (!pronto || incassato <= 0) return null
  const quota = guadagno / incassato * 100
  const larga = Math.max(0, Math.min(100, quota))
  const pct = (n: number) => n.toLocaleString('it-IT', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%'
  return (
    <div className="fx-margine">
      <div className="fx-margine-testa"><span>Ti resta di ogni euro incassato</span><b style={{ color: quota < 0 ? '#FF8A80' : '#7EE2A0' }}>{pct(quota)}</b></div>
      <div className="fx-margine-barra" role="img" aria-label={`Guadagno ${pct(quota)} dell'incassato`}><i style={{ width: `${larga}%` }} /></div>
      <div className="fx-margine-legenda"><span><i className="fx-margine-costo" />costo {pct(100 - quota)}</span><span><i className="fx-margine-tuo" />guadagno {pct(quota)}</span></div>
    </div>
  )
}

// UNA VOCE della fila: guadagno, incassato e costo.
function Voce({ titolo, endpoint, dal, al }: { titolo: string, endpoint: string, dal: string, al: string }) {
  const { d, loading } = useLettura(`${endpoint}?dal=${dal}&al=${al}`)
  const g = Number(d?.guadagno || 0)
  return (
    <div className="fx-cella fx-voce">
      <div className="fx-cella-nome">{titolo}</div>
      <div className={`fx-cella-cifra${loading ? '' : g < 0 ? ' fx-grande--male' : ' fx-grande--bene'}${eur(g).length > 12 ? ' fx-cella-cifra--lunga' : ''}`}>{loading ? '…' : eur(g)}</div>
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
      <div className={`fx-cella-cifra${loading ? '' : ' fx-grande--male'}`}>{loading ? '…' : eur(d?.totale || 0)}</div>
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
    <section className="fx-scheda fx-largo">
      <div className="fx-testa">
        <div><h2>Guadagno spedizioni</h2><p className="fx-sotto">Rettifiche escluse: sono nella loro voce, qui sotto</p></div>
      </div>
      <div className="fx-guadagno-numeri">
        <div>
          <div className="fx-cella-nome">Margine</div>
          <div className={`fx-report-cifra${loading ? '' : margine < 0 ? ' fx-grande--male' : ' fx-grande--bene'}`} style={{ marginTop: 6 }}>{loading ? '…' : eur(margine)}</div>
        </div>
        <div><div className="fx-cella-nome"><i className="fx-pallino" style={{ background: 'var(--fx-bene)' }} />Fatturato</div><b>{loading ? '…' : eur(d?.ricavi || 0)}</b></div>
        <div><div className="fx-cella-nome"><i className="fx-pallino" style={{ background: 'var(--fx-male)' }} />Costi</div><b>{loading ? '…' : eur(d?.costi || 0)}</b></div>
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
      <div className="fx-pannello" style={{ height: 190 }}>
        {loading ? <div className="fx-vuoto">Carico il guadagno…</div> : !serie.length ? <div className="fx-vuoto">Nessun dato nel periodo</div> : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="var(--fx-filo)" strokeWidth={0.6} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#8E8E93' }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={{ fontSize: 10, fill: '#8E8E93' }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => '€ ' + intero(Number(v))} />
              <Tooltip formatter={(v: any, name: any) => [eur(Number(v)), name === 'ricavi' ? 'Fatturato' : name === 'costi' ? 'Costi' : 'Margine']} labelStyle={{ color: '#111', fontWeight: 600 }} contentStyle={{ borderRadius: '10px', border: '1px solid #ECECEC', fontSize: '12px', boxShadow: '0 6px 22px rgba(0,0,0,.06)' }} />
              <Line type="monotone" dataKey="ricavi" name="ricavi" stroke="#2E9B55" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="costi" name="costi" stroke="#D9474E" strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
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
