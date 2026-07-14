'use client'
import { useEffect, useState } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import DateRangePicker from './DateRangePicker'

const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function meseCorrente(): { dal: string; al: string } {
  const oggi = new Date()
  const str = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dal: str(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), al: str(oggi) }
}

function fmtGiorno(g: string) {
  if (!g) return ''
  if (g.length === 7) { const [, m] = g.split('-'); return ['Gen','Feb','Mar','Apr','Mag','Giu','Lug','Ago','Set','Ott','Nov','Dic'][Number(m) - 1] || g }
  const [, m, d] = g.split('-'); return `${d}/${m}`
}

export default function GuadagnoAgente() {
  const [range, setRange] = useState(meseCorrente)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!range.dal || !range.al) return
    setLoading(true)
    fetch(`/api/agente/guadagno?dal=${range.dal}&al=${range.al}`)
      .then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [range.dal, range.al])

  const margine = Number(d?.guadagno || 0)
  const serie = (d?.serie || []).map((s: any) => ({ ...s, label: fmtGiorno(s.giorno) }))
  const coloreMargine = margine < 0 ? '#dc2626' : '#16a34a'

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '12px', padding: '16px 18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', marginBottom: '10px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 800, color: '#1a1a1a' }}>
          <span style={{ width: '26px', height: '26px', borderRadius: '7px', background: '#dcfce7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>💰</span>
          Il mio guadagno
        </span>
        <DateRangePicker dal={range.dal} al={range.al} onChange={(dal, al) => setRange({ dal, al })} />
      </div>

      {d?.senzaListino && (
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: '8px', padding: '10px 12px', fontSize: '12px', color: '#ea580c', marginBottom: '12px' }}>
          Nessun listino agente assegnato: il tuo referente deve assegnartene uno per calcolare il margine.
        </div>
      )}

      <div style={{ display: 'flex', gap: '22px', alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: '12px' }}>
        <div>
          <div style={{ fontSize: '11px', color: '#8a8a8a', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.4px' }}>Margine</div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: coloreMargine, lineHeight: 1.05 }}>{loading ? '…' : eur(margine)}</div>
        </div>
        <div style={{ display: 'flex', gap: '18px', paddingBottom: '5px' }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#8a8a8a', fontWeight: 600 }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#16a34a' }} /> Incassato dai clienti
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#16a34a' }}>{loading ? '…' : eur(d?.ricavi || 0)}</div>
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#8a8a8a', fontWeight: 600 }}>
              <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#dc2626' }} /> Il mio costo
            </div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: '#dc2626' }}>{eur(d?.costi || 0)}</div>
          </div>
          <div style={{ borderLeft: '1px solid #eee', paddingLeft: '18px' }}>
            <div style={{ fontSize: '11px', color: '#8a8a8a', fontWeight: 600 }}>Media / spedizione</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: Number(d?.mediaSped) < 0 ? '#dc2626' : '#16a34a' }}>{loading ? '…' : eur(d?.mediaSped || 0)}</div>
            <div style={{ fontSize: '10px', color: '#999' }}>{loading ? '' : `${Number(d?.numSpedizioni || 0).toLocaleString()} sped.`}</div>
          </div>
        </div>
      </div>

      <div style={{ width: '100%', height: '230px' }}>
        {loading ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' }}>Caricamento…</div>
        ) : !serie.length ? (
          <div style={{ height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#999', fontSize: '13px' }}>Nessun dato nel periodo</div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={serie} margin={{ top: 8, right: 12, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#8a8a8a' }} tickLine={false} axisLine={{ stroke: '#e8e8e8' }} minTickGap={16} />
              <YAxis tick={{ fontSize: 11, fill: '#8a8a8a' }} tickLine={false} axisLine={false} width={54} tickFormatter={(v: number) => '€' + v} />
              <Tooltip formatter={(v: any, name: any) => [eur(Number(v)), name === 'ricavi' ? 'Incassato' : name === 'costi' ? 'Mio costo' : 'Margine']} labelStyle={{ color: '#1a1a1a', fontWeight: 700 }} contentStyle={{ borderRadius: '8px', border: '1px solid #e8e8e8', fontSize: '12px' }} />
              <Line type="monotone" dataKey="ricavi" name="ricavi" stroke="#16a34a" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
              <Line type="monotone" dataKey="costi" name="costi" stroke="#dc2626" strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  )
}
