'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { prendiAnticipata } from '@/lib/richieste-anticipate'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' } as Intl.NumberFormatOptions)

// default: mese corrente (dal 1° a oggi)
function meseCorrente(): { dal: string; al: string } {
  const oggi = new Date()
  const str = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dal: str(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), al: str(oggi) }
}

const urlGuadagno = (dal: string, al: string) => `/api/reports/guadagno?dal=${dal}&al=${al}`
// L'indirizzo della PRIMA richiesta (mese corrente): la home la anticipa prima di montare il grafico.
export const urlInizialeGuadagnoChart = () => { const r = meseCorrente(); return urlGuadagno(r.dal, r.al) }

function fmtGiorno(g: string) {
  if (!g) return ''
  if (g.length === 7) { // YYYY-MM
    const [, m] = g.split('-')
    return ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][Number(m) - 1] || g
  }
  const [, m, d] = g.split('-')
  return `${d}/${m}`
}

// Il periodo lo sceglie la sezione «Il tuo guadagno» della Dashboard nuova, uno per tutte le schede.
export default function GuadagnoChart({ dal, al }: { dal: string, al: string }) {
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!dal || !al) return
    let vivo = true
    setLoading(true)
    const url = urlGuadagno(dal, al)
    const risposta = prendiAnticipata(url) ?? fetch(url)
    risposta
      .then(r => r.json()).then(x => { if (vivo) { setD(x); setLoading(false) } }).catch(() => { if (vivo) setLoading(false) })
    return () => { vivo = false }
  }, [dal, al])

  const margine = Number(d?.guadagno || 0)
  const serie = (d?.serie || []).map((s: any) => ({ ...s, label: fmtGiorno(s.giorno) }))
  const coloreMargine = margine < 0 ? '#dc2626' : '#16a34a'

  // Nella Dashboard nuova (app/components/dashboard-finexy), col disegno delle altre schede: verde quello che entra,
  // rosso quello che esce, come prima.
  return (
    <section className="fx-scheda fx-largo">
      <div className="fx-testa">
        <div><h2>Guadagno spedizioni</h2><p className="fx-sotto">Rettifiche escluse: sono nella loro voce, qui sotto</p></div>
      </div>

      <div className="fx-guadagno-numeri">
        <div>
          <div className="fx-cella-nome">Margine</div>
          <div className={`fx-report-cifra${loading ? '' : coloreMargine === '#dc2626' ? ' fx-grande--male' : ' fx-grande--bene'}`} style={{ marginTop: 6 }}>{loading ? '…' : eur(margine)}</div>
        </div>
        <div><div className="fx-cella-nome"><i className="fx-pallino" style={{ background: 'var(--fx-bene)' }} />Fatturato</div><b>{loading ? '…' : eur(d?.ricavi || 0)}</b></div>
        <div><div className="fx-cella-nome"><i className="fx-pallino" style={{ background: 'var(--fx-male)' }} />Costi</div><b>{loading ? '…' : eur(d?.costi || 0)}</b></div>
        <div>
          <div className="fx-cella-nome">Media per spedizione</div>
          <b style={{ color: Number(d?.mediaSped) < 0 ? 'var(--fx-male)' : undefined }}>{loading ? '…' : eur(d?.mediaSped || 0)}</b>
          <small>{loading ? '' : `${Number(d?.numSpedizioni || 0).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} spedizioni`}</small>
        </div>
      </div>

      {Array.isArray(d?.costiProvider) && d.costiProvider.length > 0 && (
        <div className="fx-guadagno-fornitori">
          {d.costiProvider.map((p: any) => (
            <div key={p.provider} className="fx-cella">
              <div className="fx-cella-nome">Costo {p.provider}</div>
              <div className="fx-cella-cifra" style={{ fontSize: 17, color: 'var(--fx-male)' }}>{eur(p.costo)}</div>
              <div className="fx-cella-quando" style={{ fontSize: 11, color: 'var(--fx-grigio)' }}>{Number(p.n || 0).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} spedizioni</div>
            </div>
          ))}
        </div>
      )}

      <div className="fx-pannello" style={{ height: 190 }}>
        {loading ? (
          <div className="fx-vuoto">Carico il guadagno…</div>
        ) : !serie.length ? (
          <div className="fx-vuoto">Nessun dato nel periodo</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid stroke="#E9E9E9" strokeWidth={0.6} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6E6E73' }} tickLine={false} axisLine={false} minTickGap={16} />
              <YAxis tick={{ fontSize: 10, fill: '#6E6E73' }} tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => '€ ' + Number(v).toLocaleString('it-IT', { useGrouping: 'always' } as Intl.NumberFormatOptions)} />
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
