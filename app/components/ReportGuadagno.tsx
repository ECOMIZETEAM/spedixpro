'use client'
import { useEffect, useState } from 'react'

const PERIODI = [
  { v: 'giornaliero', l: 'Giorno' },
  { v: 'settimanale', l: 'Settimana' },
  { v: 'mensile', l: 'Mese' },
  { v: 'annuale', l: 'Anno' },
]

export default function ReportGuadagno({ titolo = 'Spedizioni', endpoint = '/api/reports/guadagno' }: { titolo?: string, endpoint?: string }) {
  const [periodo, setPeriodo] = useState('mensile')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(endpoint + '?periodo=' + periodo)
      .then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [periodo, endpoint])

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
        <select value={periodo} onChange={e => setPeriodo(e.target.value)}
          style={{ padding: '4px 7px', borderRadius: '6px', border: '1px solid #d1d5db', background: '#fff', color: '#1a1a1a', fontSize: '11px', fontWeight: 600, cursor: 'pointer', flexShrink: 0 }}>
          {PERIODI.map(p => <option key={p.v} value={p.v} style={{ color: '#1a1a1a' }}>{p.l}</option>)}
        </select>
      </div>

      <div style={{ fontSize: '24px', fontWeight: 800, color: colore, lineHeight: 1.05 }}>{loading ? '…' : eur(g)}</div>

      <div style={{ display: 'flex', gap: '14px', marginTop: '9px', fontSize: '11px', color: '#8a8a8a', flexWrap: 'wrap' }}>
        <span>Incassato <b style={{ color: '#1a1a1a' }}>{loading ? '…' : eur(d?.ricavi || 0)}</b></span>
        <span>Costo <b style={{ color: '#f97316' }}>{loading ? '…' : eur(d?.costi || 0)}</b></span>
      </div>
    </div>
  )
}
