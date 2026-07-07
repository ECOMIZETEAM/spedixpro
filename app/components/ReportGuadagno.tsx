'use client'
import { useEffect, useState } from 'react'

const PERIODI = [
  { v: 'giornaliero', l: 'Giornaliero' },
  { v: 'settimanale', l: 'Settimanale' },
  { v: 'mensile', l: 'Mensile' },
  { v: 'annuale', l: 'Annuale' },
]

export default function ReportGuadagno() {
  const [periodo, setPeriodo] = useState('mensile')
  const [d, setD] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch('/api/reports/guadagno?periodo=' + periodo)
      .then(r => r.json()).then(x => { setD(x); setLoading(false) }).catch(() => setLoading(false))
  }, [periodo])

  const eur = (x: number) => '€ ' + Number(x || 0).toLocaleString('it-IT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  const lbl = PERIODI.find(p => p.v === periodo)?.l.toLowerCase()

  return (
    <div style={{ background: '#1a1a1a', borderRadius: '8px', overflow: 'hidden', color: '#fff' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 18px', borderBottom: '1px solid rgba(255,255,255,0.08)' }}>
        <span style={{ fontSize: '13px', fontWeight: 700 }}>💰 Report Guadagno</span>
        <select value={periodo} onChange={e => setPeriodo(e.target.value)}
          style={{ padding: '6px 10px', borderRadius: '6px', border: '1px solid rgba(255,255,255,0.15)', background: '#0b1220', color: '#fff', fontSize: '12px', cursor: 'pointer' }}>
          {PERIODI.map(p => <option key={p.v} value={p.v} style={{ color: '#111' }}>{p.l}</option>)}
        </select>
      </div>
      <div style={{ padding: '18px', display: 'flex', alignItems: 'center', gap: '28px', flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '10px', textTransform: 'uppercase', letterSpacing: '.6px', color: '#999' }}>Guadagno {lbl}</div>
          <div style={{ fontSize: '30px', fontWeight: 800, color: '#22c55e', marginTop: '4px', lineHeight: 1 }}>{loading ? '…' : eur(d?.guadagno || 0)}</div>
        </div>
        <div style={{ display: 'flex', gap: '24px', fontSize: '12px' }}>
          <div>
            <div style={{ color: '#999' }}>Incassato spedizioni</div>
            <div style={{ fontWeight: 700, marginTop: '3px' }}>{loading ? '…' : eur(d?.ricavi || 0)}</div>
          </div>
          <div>
            <div style={{ color: '#999' }}>Costo spedizioni</div>
            <div style={{ fontWeight: 700, marginTop: '3px', color: '#f97316' }}>{loading ? '…' : eur(d?.costi || 0)}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
