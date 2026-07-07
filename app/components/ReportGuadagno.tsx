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
    <div style={{ background: '#fff', borderRadius: '10px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '13px 18px', borderBottom: '1px solid #f0f0f0', gap: '12px', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', fontWeight: 700, color: '#1a1a1a' }}>
          <span style={{ width: '26px', height: '26px', borderRadius: '7px', background: '#dcfce7', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px' }}>💰</span>
          Report Guadagno
        </span>
        <select value={periodo} onChange={e => setPeriodo(e.target.value)}
          style={{ padding: '7px 12px', borderRadius: '7px', border: '1px solid #d1d5db', background: '#fff', color: '#1a1a1a', fontSize: '13px', fontWeight: 600, cursor: 'pointer' }}>
          {PERIODI.map(p => <option key={p.v} value={p.v} style={{ color: '#1a1a1a' }}>{p.l}</option>)}
        </select>
      </div>

      {/* Tiles */}
      <div style={{ padding: '18px', display: 'grid', gridTemplateColumns: '1.4fr 1fr 1fr', gap: '14px' }}>
        {/* Guadagno */}
        <div style={{ background: 'linear-gradient(135deg,#ecfdf5 0%,#f0fdf4 100%)', border: '1px solid #bbf7d0', borderRadius: '10px', padding: '16px 18px' }}>
          <div style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.6px', color: '#059669' }}>Guadagno {lbl}</div>
          <div style={{ fontSize: '32px', fontWeight: 800, color: '#16a34a', marginTop: '6px', lineHeight: 1 }}>{loading ? '…' : eur(d?.guadagno || 0)}</div>
        </div>

        {/* Incassato */}
        <div style={{ background: '#f9fafb', border: '1px solid #eef0f2', borderRadius: '10px', padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#eff6ff', color: '#2563eb', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>↑</span>
            <span style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: '#8a8a8a' }}>Incassato</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', marginTop: '8px', lineHeight: 1 }}>{loading ? '…' : eur(d?.ricavi || 0)}</div>
        </div>

        {/* Costo */}
        <div style={{ background: '#f9fafb', border: '1px solid #eef0f2', borderRadius: '10px', padding: '16px 18px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
            <span style={{ width: '24px', height: '24px', borderRadius: '6px', background: '#fff7ed', color: '#f97316', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px' }}>📦</span>
            <span style={{ fontSize: '10.5px', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', color: '#8a8a8a' }}>Costo spedizioni</span>
          </div>
          <div style={{ fontSize: '20px', fontWeight: 800, color: '#1a1a1a', marginTop: '8px', lineHeight: 1 }}>{loading ? '…' : eur(d?.costi || 0)}</div>
        </div>
      </div>
    </div>
  )
}
