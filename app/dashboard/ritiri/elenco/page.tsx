'use client'
import { useState, useEffect } from 'react'
import { useSearchParams } from 'next/navigation'

export default function ElencoRitiriPage() {
  const searchParams = useSearchParams()
  const success = searchParams.get('success')
  const [ritiri, setRitiri] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/ritiri/lista').then(r => r.json()).then(d => {
      setRitiri(Array.isArray(d) ? d : [])
      setLoading(false)
    }).catch(() => setLoading(false))
  }, [])

  const STATO_LABELS: Record<string, { label: string; bg: string; color: string }> = {
    richiesto: { label: 'Richiesto', bg: '#fff7ed', color: '#f97316' },
    confermato: { label: 'Confermato', bg: '#eff6ff', color: '#2563eb' },
    completato: { label: 'Completato', bg: '#f0fdf4', color: '#16a34a' },
    annullato: { label: 'Annullato', bg: '#fef2f2', color: '#dc2626' },
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '20px' }}>
        <div>
          <h1 style={{ fontSize: '20px', fontWeight: '700', color: '#1a1a1a', margin: 0 }}>Elenco Ritiri</h1>
          <p style={{ color: '#666', fontSize: '13px', marginTop: '4px' }}>{ritiri.length} ritiri totali</p>
        </div>
        <a href="/dashboard/ritiri/nuovo" style={{ background: '#f97316', color: '#fff', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>+ Nuovo Ritiro</a>
      </div>

      {success && (
        <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: '6px', padding: '10px 14px', marginBottom: '16px', fontSize: '13px', color: '#15803d' }}>
          ✓ Ritiro richiesto con successo! ID Pickup: <strong>{success}</strong>
        </div>
      )}

      <div style={{ background: '#fff', borderRadius: '8px', border: '1px solid #e8e8e8', overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#1a1a1a' }}>Caricamento...</div>
        ) : !ritiri.length ? (
          <div style={{ padding: '60px', textAlign: 'center', color: '#1a1a1a' }}>
            <div style={{ fontSize: '40px', marginBottom: '12px' }}>📦</div>
            <div style={{ fontSize: '14px', fontWeight: '500' }}>Nessun ritiro richiesto</div>
            <a href="/dashboard/ritiri/nuovo" style={{ display: 'inline-block', marginTop: '12px', background: '#f97316', color: '#fff', padding: '8px 18px', borderRadius: '6px', fontSize: '13px', fontWeight: '600', textDecoration: 'none' }}>Crea il primo</a>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
              <thead>
                <tr style={{ background: '#fafafa' }}>
                  {['ID Pickup', 'Mittente', 'Colli', 'Peso', 'Data Ritiro', 'Stato', 'Richiesto il'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '9px 14px', fontSize: '11px', fontWeight: '600', textTransform: 'uppercase', color: '#1a1a1a', borderBottom: '1px solid #f0f0f0', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {ritiri.map(r => {
                  const stato = STATO_LABELS[r.stato] || STATO_LABELS.richiesto
                  return (
                    <tr key={r.id} style={{ borderBottom: '1px solid #f5f5f5' }}>
                      <td style={{ padding: '10px 14px', fontWeight: '600', color: '#1a1a1a' }}>{r.pickup_id || '—'}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontWeight: '600', color: '#1a1a1a' }}>{r.mitt_nome}</div>
                        <div style={{ fontSize: '11px', color: '#999' }}>{r.mitt_citta} ({r.mitt_provincia})</div>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.colli}</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{r.peso_totale} kg</td>
                      <td style={{ padding: '10px 14px', color: '#1a1a1a' }}>{new Date(r.data_ritiro).toLocaleDateString('it-IT')} {r.orario_ritiro && `(${r.orario_ritiro})`}</td>
                      <td style={{ padding: '10px 14px' }}>
                        <span style={{ background: stato.bg, color: stato.color, padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: '600' }}>{stato.label}</span>
                      </td>
                      <td style={{ padding: '10px 14px', color: '#999', fontSize: '12px' }}>{new Date(r.created_at).toLocaleDateString('it-IT')}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
