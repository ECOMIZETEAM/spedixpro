'use client'
import { useEffect, useState } from 'react'
import DateRangePicker from './DateRangePicker'

// Stesso calendario del Guadagno Spedizioni: prima c'era solo Giorno/Settimana/Mese/Anno "fino a
// oggi", e un mese chiuso (agosto) non si poteva guardare — quindi Guadagno e Rettifiche non si
// potevano confrontare sullo stesso periodo.
function meseCorrente(): { dal: string; al: string } {
  const oggi = new Date()
  const str = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return { dal: str(new Date(oggi.getFullYear(), oggi.getMonth(), 1)), al: str(oggi) }
}

export default function ReportGuadagno({ titolo = 'Spedizioni', endpoint = '/api/reports/guadagno' }: { titolo?: string, endpoint?: string }) {
  const [range, setRange] = useState(meseCorrente)
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!range.dal || !range.al) return
    setLoading(true)
    fetch(`${endpoint}?dal=${range.dal}&al=${range.al}`)
      .then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [range.dal, range.al, endpoint])

  const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const g = Number(d?.guadagno || 0)
  const colore = g < 0 ? '#dc2626' : '#16a34a'

  return (
    <div style={{ background: '#fff', border: '1px solid #e8e8e8', borderRadius: '10px', padding: '13px 15px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px', marginBottom: '10px' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 700, color: '#1a1a1a', minWidth: 0 }}>
          <span style={{ width: '22px', height: '22px', borderRadius: '6px', background: '#dcfce7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px', flexShrink: 0 }}>💰</span>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{titolo}</span>
        </span>
        <DateRangePicker dal={range.dal} al={range.al} onChange={(dal, al) => setRange({ dal, al })} />
      </div>

      <div style={{ fontSize: '24px', fontWeight: 800, color: colore, lineHeight: 1.05 }}>{loading ? '…' : eur(g)}</div>

      <div style={{ display: 'flex', gap: '14px', marginTop: '9px', fontSize: '11px', color: '#8a8a8a', flexWrap: 'wrap' }}>
        <span>Incassato <b style={{ color: '#1a1a1a' }}>{loading ? '…' : eur(d?.ricavi || 0)}</b></span>
        <span>Costo <b style={{ color: '#f97316' }}>{loading ? '…' : eur(d?.costi || 0)}</b></span>
      </div>
    </div>
  )
}
